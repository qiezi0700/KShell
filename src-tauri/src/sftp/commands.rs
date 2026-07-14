//! SFTP 命令实现:list / mkdir / rm / rename / chmod / upload / download / preview。
//!
//! upload/download 在后台 tokio 任务中分块传输,通过 emit 事件推送进度。
//! 断点续传:调用方传 offset,后端 seek 到该位置继续。

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::state::{AppState, TransferControl};

use super::session;

/// 传输被用户取消时,do_upload/do_download 返回这个错误,
/// emit_done 据此把 cancelled 字段置 true,前端可区分展示为"已取消"。
const CANCEL_MSG: &str = "传输已取消";

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

/// 远端目录条目,序列化给前端
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: u32,
}

/// 本地目录条目(结构与 RemoteEntry 一致,前端可复用)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: u32,
}

/// 传输进度事件 payload
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub transferred: u64,
    pub total: u64,
    pub speed: f64,
}

/// 传输完成事件
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferDone {
    pub transfer_id: String,
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

const CHUNK_SIZE: usize = 256 * 1024;

// ============================================================
// SFTP 会话管理
// ============================================================

fn sftp_open_lock(state: &AppState, session_id: &str) -> Arc<Mutex<()>> {
    state
        .sftp_open_locks
        .entry(session_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

#[tauri::command]
pub async fn sftp_open(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let open_lock = sftp_open_lock(state.inner(), &session_id);
    let _open_guard = open_lock.lock().await;
    let ssh = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("SSH 会话不存在: {session_id}"))?
        .clone();
    let sftp_id = uuid::Uuid::new_v4().to_string();
    if let Some(handle) = state
        .shared_sftp_sessions
        .get(&session_id)
        .map(|entry| entry.value().clone())
    {
        state.sftp_sessions.insert(sftp_id.clone(), handle);
        return Ok(sftp_id);
    }
    let (ssh_handle, scheduler) = {
        let ssh = ssh.lock().await;
        (ssh.handle.clone(), ssh.scheduler.clone())
    };
    let handle = session::open_sftp(&ssh_handle, &scheduler, session_id.clone())
        .await
        .map_err(err)?;
    state
        .shared_sftp_sessions
        .insert(session_id, handle.clone());
    state.sftp_sessions.insert(sftp_id.clone(), handle);
    Ok(sftp_id)
}

#[tauri::command]
pub async fn sftp_close(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
) -> Result<(), String> {
    abort_transfers_for_sftp(&app, state.inner(), &sftp_id);
    let Some((_, lease)) = state.sftp_sessions.remove(&sftp_id) else {
        return Ok(());
    };
    let session_id = lease.ssh_session_id;
    let open_lock = sftp_open_lock(state.inner(), &session_id);
    let _open_guard = open_lock.lock().await;
    let has_other_lease = state
        .sftp_sessions
        .iter()
        .any(|entry| entry.value().ssh_session_id == session_id);
    if !has_other_lease {
        if let Some((_, shared)) = state.shared_sftp_sessions.remove(&session_id) {
            shared.session.close().await.map_err(err)?;
        }
    }
    Ok(())
}

// ============================================================
// 远端文件操作
// ============================================================

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let mut entries = Vec::new();
    // read_dir 返回同步 Iterator,但 await 在获取 ReadDir 本身
    let dir = sftp.read_dir(&path).await.map_err(err)?;
    for entry in dir {
        let name = entry.file_name();
        let meta = entry.metadata();
        entries.push(RemoteEntry {
            name,
            is_dir: meta.is_dir(),
            is_symlink: meta.is_symlink(),
            size: meta.len(),
            modified: format_datetime(meta.modified()),
            permissions: meta.permissions.unwrap_or(0),
        });
    }
    // 目录优先,再按名称排序
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.create_dir(&path).await.map_err(err)
}

/// 删除远端目录(递归)。SFTP 协议的 RMDIR 只能删空目录,
/// 这里自行遍历删掉所有文件与子目录,再从最深处向上删除。
/// 前端确认弹窗必须提示"及其全部内容",与本地保持一致。
#[tauri::command]
pub async fn sftp_rmdir(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    remove_remote_dir_recursive(&sftp, &path).await.map_err(err)
}

async fn remove_remote_dir_recursive(sftp: &SftpSession, root: &str) -> Result<()> {
    // 收集所有相对根目录的文件路径与子目录相对路径,再一次性执行删除
    let (files, dirs) = walk_remote_dir(sftp, root).await?;
    for (full, _rel, _) in files {
        sftp.remove_file(&full)
            .await
            .with_context(|| format!("删除远端文件失败: {full}"))?;
    }
    // 深度从大到小删空目录
    let mut dirs = dirs;
    dirs.sort_by_key(|path| std::cmp::Reverse(path.matches('/').count()));
    for rel in dirs {
        let full = format!("{}/{}", root.trim_end_matches('/'), rel);
        sftp.remove_dir(&full)
            .await
            .with_context(|| format!("删除远端目录失败: {full}"))?;
    }
    sftp.remove_dir(root)
        .await
        .with_context(|| format!("删除远端根目录失败: {root}"))?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_rm(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.remove_file(&path).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    sftp_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    if old_path != new_path && sftp.try_exists(&new_path).await.map_err(err)? {
        return Err(format!("远端目标已存在: {new_path}"));
    }
    sftp.rename(&old_path, &new_path).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let mut meta = sftp.metadata(&path).await.map_err(err)?;
    meta.permissions = Some(mode);
    sftp.set_metadata(&path, meta).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_stat(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<RemoteEntry, String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let meta = sftp.metadata(&path).await.map_err(err)?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(path);
    Ok(RemoteEntry {
        name,
        is_dir: meta.is_dir(),
        is_symlink: meta.is_symlink(),
        size: meta.len(),
        modified: format_datetime(meta.modified()),
        permissions: meta.permissions.unwrap_or(0),
    })
}

/// 读取小文件内容用于预览(限制 1MB)
#[tauri::command]
pub async fn sftp_read_file(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.read(&path).await.map_err(err)
}

/// 写入远端文件(保存编辑)
#[tauri::command]
pub async fn sftp_write_file(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let temp_path = remote_staging_path(&path, "tmp");
    let write_result = async {
        let mut file = sftp
            .create(&temp_path)
            .await
            .with_context(|| format!("创建远端临时文件失败: {temp_path}"))?;
        file.write_all(&content)
            .await
            .context("写入远端临时文件失败")?;
        file.flush().await.context("刷新远端临时文件失败")?;
        Ok::<_, anyhow::Error>(())
    }
    .await;

    if let Err(error) = write_result {
        let _ = sftp.remove_file(&temp_path).await;
        return Err(err(error));
    }
    if let Err(error) = commit_remote_temp(&sftp, &temp_path, &path).await {
        let _ = sftp.remove_file(&temp_path).await;
        return Err(err(error));
    }
    Ok(())
}

fn remote_staging_path(path: &str, label: &str) -> String {
    format!("{path}.kshell-{label}-{}", uuid::Uuid::new_v4())
}

async fn commit_remote_temp(sftp: &SftpSession, temp_path: &str, target_path: &str) -> Result<()> {
    let target_exists = sftp
        .try_exists(target_path)
        .await
        .with_context(|| format!("检查远端目标文件失败: {target_path}"))?;
    if !target_exists {
        return sftp
            .rename(temp_path, target_path)
            .await
            .with_context(|| format!("替换远端文件失败: {target_path}"));
    }

    let metadata = sftp
        .metadata(target_path)
        .await
        .with_context(|| format!("读取远端原文件信息失败: {target_path}"))?;
    if let Some(permissions) = metadata.permissions {
        let attributes = Metadata {
            permissions: Some(permissions),
            ..Metadata::default()
        };
        sftp.set_metadata(temp_path, attributes)
            .await
            .with_context(|| format!("保留远端文件权限失败: {target_path}"))?;
    }

    let backup_path = remote_staging_path(target_path, "bak");
    sftp.rename(target_path, &backup_path)
        .await
        .with_context(|| format!("备份远端原文件失败: {target_path}"))?;
    if let Err(replace_error) = sftp.rename(temp_path, target_path).await {
        let restore_result = sftp.rename(&backup_path, target_path).await;
        let _ = sftp.remove_file(temp_path).await;
        return match restore_result {
            Ok(()) => Err(anyhow::anyhow!("替换远端文件失败: {replace_error}")),
            Err(restore_error) => Err(anyhow::anyhow!(
                "替换远端文件失败: {replace_error}; 恢复原文件失败: {restore_error}; 原文件保留在 {backup_path}"
            )),
        };
    }

    if let Err(error) = sftp.remove_file(&backup_path).await {
        tracing::warn!(path = %backup_path, error = %error, "清理远端备份文件失败");
    }
    Ok(())
}

/// 复制远端文件(单文件,分块读写)
#[tauri::command]
pub async fn sftp_copy_file(
    state: State<'_, AppState>,
    sftp_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    copy_remote_file(&sftp, &old_path, &new_path)
        .await
        .map_err(err)
}

async fn copy_remote_file(sftp: &SftpSession, src: &str, dst: &str) -> Result<()> {
    let mut s = sftp
        .open(src)
        .await
        .with_context(|| format!("打开远端源文件失败: {src}"))?;
    let mut d = sftp
        .create(dst)
        .await
        .with_context(|| format!("创建远端目标文件失败: {dst}"))?;
    let mut buf = vec![0u8; 65536];
    loop {
        let n = s.read(&mut buf).await.context("读取远端源文件失败")?;
        if n == 0 {
            break;
        }
        d.write_all(&buf[..n])
            .await
            .context("写入远端目标文件失败")?;
    }
    d.flush().await.ok();
    Ok(())
}

/// 递归复制远端目录。SFTP 无服务端拷贝,只能"读→写"逐文件搬。
/// 走后台 tokio 任务,汇入统一传输面板,支持取消 + 聚合字节进度。
#[tauri::command]
pub async fn sftp_copy_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
    src_path: String,
    dst_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let task_cancel = cancel.clone();
    let app_clone = app.clone();
    let task_transfer_id = transfer_id.clone();
    let future = async move {
        do_copy_remote_dir(
            &sftp,
            &src_path,
            &dst_path,
            &app_clone,
            &task_transfer_id,
            &task_cancel,
        )
        .await
    };
    spawn_transfer(&app, state.inner(), &sftp_id, &transfer_id, cancel, future)
}

async fn do_copy_remote_dir(
    sftp: &SftpSession,
    src_path: &str,
    dst_path: &str,
    app: &AppHandle,
    transfer_id: &str,
    cancel: &AtomicBool,
) -> Result<()> {
    if sftp
        .try_exists(dst_path)
        .await
        .with_context(|| format!("检查远端目标目录失败: {dst_path}"))?
    {
        anyhow::bail!("远端目标目录已存在: {dst_path}");
    }

    // 1. 预扫描源目录
    let (files, mut dirs) = walk_remote_dir(sftp, src_path).await?;
    let total: u64 = files.iter().map(|f| f.2).sum();

    // 2. 建目标目录树
    sftp.create_dir(dst_path)
        .await
        .with_context(|| format!("创建远端目标目录失败: {dst_path}"))?;
    dirs.sort_by_key(|path| path.matches('/').count());
    for rel in &dirs {
        let full = format!("{}/{}", dst_path.trim_end_matches('/'), rel);
        let _ = sftp.create_dir(&full).await;
    }

    // 3. 逐文件复制,progress 事件按聚合字节
    let event = format!("sftp://transfer/{transfer_id}/progress");
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred: 0,
            total,
            speed: 0.0,
        },
    );
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes: u64 = 0;

    for (src_file, rel, _size) in files {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!(CANCEL_MSG));
        }
        let dst_file = format!("{}/{}", dst_path.trim_end_matches('/'), rel);
        let mut s = sftp
            .open(&src_file)
            .await
            .with_context(|| format!("打开远端源文件失败: {src_file}"))?;
        let mut d = sftp
            .create(&dst_file)
            .await
            .with_context(|| format!("创建远端目标文件失败: {dst_file}"))?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!(CANCEL_MSG));
            }
            let n = s.read(&mut buf).await.context("读取远端源文件失败")?;
            if n == 0 {
                break;
            }
            d.write_all(&buf[..n])
                .await
                .context("写入远端目标文件失败")?;
            transferred += n as u64;

            let now = std::time::Instant::now();
            if now.duration_since(last_emit).as_millis() >= 200 {
                let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
                let speed = ((transferred - last_bytes) as f64 / elapsed) / 1024.0;
                let _ = app.emit(
                    &event,
                    TransferProgress {
                        transfer_id: transfer_id.to_string(),
                        transferred,
                        total,
                        speed,
                    },
                );
                last_emit = now;
                last_bytes = transferred;
            }
        }
        d.flush().await.ok();
    }
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred,
            total,
            speed: 0.0,
        },
    );
    Ok(())
}

/// 获取远端家目录(canonicalize ".")
#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, sftp_id: String) -> Result<String, String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.canonicalize(".").await.map_err(err)
}

// ============================================================
// 本地文件操作(供前端双栏的本地栏使用)
// ============================================================

async fn run_local_io<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|e| format!("本地文件任务异常结束: {e}"))?
}

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<LocalEntry>, String> {
    run_local_io(move || local_list_blocking(path)).await
}

fn local_list_blocking(path: String) -> Result<Vec<LocalEntry>, String> {
    let mut entries = Vec::new();
    // 空路径:枚举所有盘符(此电脑级别)
    if path.is_empty() {
        for c in b'A'..=b'Z' {
            let root = format!("{}:\\", c as char);
            if std::fs::metadata(&root).is_ok() {
                entries.push(LocalEntry {
                    name: format!("{}:", c as char),
                    is_dir: true,
                    is_symlink: false,
                    size: 0,
                    modified: String::new(),
                    permissions: 0,
                });
            }
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        return Ok(entries);
    }
    let read = std::fs::read_dir(&path).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let meta = entry
            .metadata()
            .map_err(|e| format!("读取元数据失败: {e}"))?;
        let ft = entry
            .file_type()
            .map_err(|e| format!("读取类型失败: {e}"))?;
        #[cfg(unix)]
        let perms = {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode()
        };
        #[cfg(not(unix))]
        let perms = 0u32;
        entries.push(LocalEntry {
            name,
            is_dir: ft.is_dir(),
            is_symlink: ft.is_symlink(),
            size: meta.len(),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                        .map(|t| t.to_rfc3339())
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
            permissions: perms,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    run_local_io(move || std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {e}")))
        .await
}

/// 删除本地目录(递归)。前端确认弹窗必须提示"及其全部内容",避免误删。
#[tauri::command]
pub async fn local_rmdir(path: String) -> Result<(), String> {
    run_local_io(move || std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败: {e}")))
        .await
}

#[tauri::command]
pub async fn local_rm(path: String) -> Result<(), String> {
    run_local_io(move || std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {e}")))
        .await
}

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> Result<(), String> {
    run_local_io(move || {
        std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {e}"))
    })
    .await
}

/// 复制本地路径。文件走 std::fs::copy;目录递归复制。前端 paste 逻辑不用区分。
#[tauri::command]
pub async fn local_copy(old_path: String, new_path: String) -> Result<(), String> {
    run_local_io(move || local_copy_blocking(old_path, new_path)).await
}

fn local_copy_blocking(old_path: String, new_path: String) -> Result<(), String> {
    let src = std::path::Path::new(&old_path);
    let meta = std::fs::metadata(src).map_err(|e| format!("读取源信息失败: {e}"))?;
    if meta.is_dir() {
        copy_dir_recursive(src, std::path::Path::new(&new_path))
            .map_err(|e| format!("复制目录失败: {e}"))
    } else {
        std::fs::copy(&old_path, &new_path).map_err(|e| format!("复制文件失败: {e}"))?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else if ft.is_file() {
            std::fs::copy(&s, &d)?;
        }
        // symlink 暂不递归,忽略
    }
    Ok(())
}

/// 读取本地路径元数据(供前端在拖拽落地前区分文件/目录、获取大小)
#[tauri::command]
pub async fn local_stat(path: String) -> Result<LocalEntry, String> {
    run_local_io(move || local_stat_blocking(path)).await
}

fn local_stat_blocking(path: String) -> Result<LocalEntry, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取元数据失败: {e}"))?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    #[cfg(unix)]
    let perms = {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode()
    };
    #[cfg(not(unix))]
    let perms = 0u32;
    Ok(LocalEntry {
        name,
        is_dir: meta.is_dir(),
        is_symlink: meta.file_type().is_symlink(),
        size: meta.len(),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                    .map(|t| t.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default(),
        permissions: perms,
    })
}

/// 获取本地家目录
#[tauri::command]
pub fn local_home() -> Result<String, String> {
    if let Ok(h) = std::env::var("USERPROFILE") {
        return Ok(h);
    }
    if let Ok(h) = std::env::var("HOME") {
        return Ok(h);
    }
    Err("无法确定家目录".to_string())
}

/// 读取本地文件(预览用)
#[tauri::command]
pub async fn local_read_file(path: String) -> Result<Vec<u8>, String> {
    run_local_io(move || std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))).await
}

/// 写入本地文件(保存编辑)
#[tauri::command]
pub async fn local_write_file(path: String, content: Vec<u8>) -> Result<(), String> {
    run_local_io(move || std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}")))
        .await
}

// ============================================================
// 传输:上传 / 下载(带进度 + 断点续传)
// ============================================================

/// 上传:本地 → 远端。offset>0 时从远端文件的 offset 位置续写。
#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    offset: u64,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let total = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("读取本地文件信息失败: {e}"))?
        .len();
    if offset > total {
        return Err("续传偏移超过本地文件大小".to_string());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let task_cancel = cancel.clone();
    let app_clone = app.clone();
    let task_transfer_id = transfer_id.clone();
    let future = async move {
        let context = TransferContext {
            app: &app_clone,
            transfer_id: &task_transfer_id,
            cancel: &task_cancel,
            total,
        };
        do_upload(&sftp, &local_path, &remote_path, offset, &context).await
    };
    spawn_transfer(&app, state.inner(), &sftp_id, &transfer_id, cancel, future)
}

/// 下载:远端 → 本地。offset>0 时从远端文件 offset 位置续读,本地文件追加写。
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    offset: u64,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let meta = sftp.metadata(&remote_path).await.map_err(err)?;
    let total = meta.len();
    if offset > total {
        return Err("续传偏移超过远端文件大小".to_string());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let task_cancel = cancel.clone();
    let app_clone = app.clone();
    let task_transfer_id = transfer_id.clone();
    let future = async move {
        let context = TransferContext {
            app: &app_clone,
            transfer_id: &task_transfer_id,
            cancel: &task_cancel,
            total,
        };
        do_download(&sftp, &remote_path, &local_path, offset, &context).await
    };
    spawn_transfer(&app, state.inner(), &sftp_id, &transfer_id, cancel, future)
}

/// 取消进行中的传输:置位取消标志,do_upload/do_download 在下一次分块循环时返回。
#[tauri::command]
pub async fn sftp_cancel_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    if let Some(control) = state.transfers.get(&transfer_id) {
        control.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

// ============================================================
// 传输内部实现
// ============================================================

struct TransferContext<'a> {
    app: &'a AppHandle,
    transfer_id: &'a str,
    cancel: &'a AtomicBool,
    total: u64,
}

async fn do_upload(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    offset: u64,
    context: &TransferContext<'_>,
) -> Result<()> {
    if offset > 0 {
        let remote_size = sftp
            .metadata(remote_path)
            .await
            .context("读取远端文件信息失败")?
            .len();
        if remote_size != offset {
            anyhow::bail!("远端文件大小 {remote_size} 与续传偏移 {offset} 不一致,请重新上传");
        }
    }

    let temp_path = (offset == 0).then(|| remote_staging_path(remote_path, "upload"));
    let write_path = temp_path.as_deref().unwrap_or(remote_path);
    let write_result = async {
        let mut local = tokio::fs::File::open(local_path)
            .await
            .with_context(|| format!("打开本地文件失败: {local_path}"))?;
        if offset > 0 {
            local.seek(std::io::SeekFrom::Start(offset)).await?;
        }

        let mut remote = if offset > 0 {
            let mut file = sftp
                .open_with_flags(write_path, OpenFlags::WRITE)
                .await
                .context("打开远端文件失败")?;
            file.seek(std::io::SeekFrom::Start(offset)).await?;
            file
        } else {
            sftp.create(write_path)
                .await
                .context("创建远端临时文件失败")?
        };

        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut transferred = offset;
        let mut last_emit = std::time::Instant::now();
        let mut last_bytes = offset;
        let event = format!("sftp://transfer/{}/progress", context.transfer_id);

        loop {
            if context.cancel.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!(CANCEL_MSG));
            }
            let n = local.read(&mut buf).await.context("读取本地文件失败")?;
            if n == 0 {
                break;
            }
            remote
                .write_all(&buf[..n])
                .await
                .context("写入远端文件失败")?;
            transferred += n as u64;

            let now = std::time::Instant::now();
            if now.duration_since(last_emit).as_millis() >= 200 {
                let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
                let speed = ((transferred - last_bytes) as f64 / elapsed) / 1024.0;
                let _ = context.app.emit(
                    &event,
                    TransferProgress {
                        transfer_id: context.transfer_id.to_string(),
                        transferred,
                        total: context.total,
                        speed,
                    },
                );
                last_emit = now;
                last_bytes = transferred;
            }
        }
        remote.flush().await.context("刷新远端文件失败")?;
        Ok::<_, anyhow::Error>((transferred, event))
    }
    .await;

    let (transferred, event) = match write_result {
        Ok(result) => result,
        Err(error) => {
            if let Some(temp_path) = &temp_path {
                let _ = sftp.remove_file(temp_path).await;
            }
            return Err(error);
        }
    };

    if let Some(temp_path) = &temp_path {
        if let Err(error) = commit_remote_temp(sftp, temp_path, remote_path).await {
            let _ = sftp.remove_file(temp_path).await;
            return Err(error);
        }
    }

    let _ = context.app.emit(
        &event,
        TransferProgress {
            transfer_id: context.transfer_id.to_string(),
            transferred,
            total: context.total,
            speed: 0.0,
        },
    );
    Ok(())
}

async fn do_download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    offset: u64,
    context: &TransferContext<'_>,
) -> Result<()> {
    let mut remote = sftp.open(remote_path).await.context("打开远端文件失败")?;

    let mut local = if offset > 0 {
        tokio::fs::OpenOptions::new()
            .write(true)
            .append(true)
            .open(local_path)
            .await
            .with_context(|| format!("打开本地文件失败: {local_path}"))?
    } else {
        tokio::fs::File::create(local_path)
            .await
            .with_context(|| format!("创建本地文件失败: {local_path}"))?
    };

    if offset > 0 {
        remote.seek(std::io::SeekFrom::Start(offset)).await?;
    }

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred = offset;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = offset;
    let event = format!("sftp://transfer/{}/progress", context.transfer_id);

    loop {
        if context.cancel.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!(CANCEL_MSG));
        }
        let n = remote.read(&mut buf).await.context("读取远端文件失败")?;
        if n == 0 {
            break;
        }
        local
            .write_all(&buf[..n])
            .await
            .context("写入本地文件失败")?;
        transferred += n as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 200 {
            let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
            let speed = ((transferred - last_bytes) as f64 / elapsed) / 1024.0;
            let _ = context.app.emit(
                &event,
                TransferProgress {
                    transfer_id: context.transfer_id.to_string(),
                    transferred,
                    total: context.total,
                    speed,
                },
            );
            last_emit = now;
            last_bytes = transferred;
        }
    }
    local.flush().await.ok();
    let _ = context.app.emit(
        &event,
        TransferProgress {
            transfer_id: context.transfer_id.to_string(),
            transferred,
            total: context.total,
            speed: 0.0,
        },
    );
    Ok(())
}

/// 传输结束统一收尾:摘掉任务控制项,并且只发送一次 done 事件。
fn finish_transfer(app: &AppHandle, transfer_id: &str, result: Result<()>) {
    let Some((_, control)) = app.state::<AppState>().transfers.remove(transfer_id) else {
        return;
    };
    if control.completed.swap(true, Ordering::AcqRel) {
        return;
    }
    emit_done(app, transfer_id, result);
}

fn emit_done(app: &AppHandle, transfer_id: &str, result: Result<()>) {
    let event = format!("sftp://transfer/{transfer_id}/done");
    let (success, cancelled, error) = match result {
        Ok(()) => (true, false, None),
        Err(e) => {
            let msg = format!("{e:#}");
            let is_cancel = msg.contains(CANCEL_MSG);
            (false, is_cancel, Some(msg))
        }
    };
    let _ = app.emit(
        &event,
        TransferDone {
            transfer_id: transfer_id.to_string(),
            success,
            cancelled,
            error,
        },
    );
}

fn spawn_transfer<F>(
    app: &AppHandle,
    state: &AppState,
    sftp_id: &str,
    transfer_id: &str,
    cancel: Arc<AtomicBool>,
    future: F,
) -> Result<(), String>
where
    F: Future<Output = Result<()>> + Send + 'static,
{
    let completed = Arc::new(AtomicBool::new(false));
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();
    let task_app = app.clone();
    let task_transfer_id = transfer_id.to_string();
    let task = tokio::spawn(async move {
        if start_rx.await.is_err() {
            return;
        }
        let result = future.await;
        finish_transfer(&task_app, &task_transfer_id, result);
    });
    let control = TransferControl {
        sftp_id: sftp_id.to_string(),
        cancel,
        abort_handle: task.abort_handle(),
        completed,
    };

    match state.transfers.entry(transfer_id.to_string()) {
        dashmap::mapref::entry::Entry::Vacant(entry) => {
            entry.insert(control);
        }
        dashmap::mapref::entry::Entry::Occupied(_) => {
            task.abort();
            return Err(format!("传输任务已存在: {transfer_id}"));
        }
    }
    let _ = start_tx.send(());
    Ok(())
}

pub(crate) fn abort_transfers_for_sftp(app: &AppHandle, state: &AppState, sftp_id: &str) {
    let transfer_ids: Vec<_> = state
        .transfers
        .iter()
        .filter(|entry| entry.sftp_id == sftp_id)
        .map(|entry| entry.key().clone())
        .collect();

    for transfer_id in transfer_ids {
        let Some((_, control)) = state.transfers.remove(&transfer_id) else {
            continue;
        };
        control.cancel.store(true, Ordering::Release);
        if control.completed.swap(true, Ordering::AcqRel) {
            continue;
        }
        control.abort_handle.abort();
        emit_done(app, &transfer_id, Err(anyhow::anyhow!(CANCEL_MSG)));
    }
}

// ============================================================
// 辅助
// ============================================================

/// 借出 SFTP session 的 Arc 引用(避免持有 DashMap 的 entry 锁)
fn get_sftp(
    state: &State<'_, AppState>,
    sftp_id: &str,
) -> Result<std::sync::Arc<SftpSession>, String> {
    state
        .sftp_sessions
        .get(sftp_id)
        .map(|e| e.session.clone())
        .ok_or_else(|| format!("SFTP 会话不存在: {sftp_id}"))
}

fn format_datetime(t: std::io::Result<std::time::SystemTime>) -> String {
    t.ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono::DateTime::<chrono::Utc>::from_timestamp(d.as_secs() as i64, 0)
                .map(|t| t.to_rfc3339())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

#[allow(dead_code)]
fn _unused(_m: Metadata) {}

// ============================================================
// 目录递归传输(上传 / 下载)
// ============================================================

/// 上传本地目录到远端。走后台 tokio 任务,支持取消,聚合字节进度。
#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
    local_dir: String,
    remote_dir: String,
    transfer_id: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let task_cancel = cancel.clone();
    let app_clone = app.clone();
    let task_transfer_id = transfer_id.clone();
    let future = async move {
        do_upload_dir(
            &sftp,
            &local_dir,
            &remote_dir,
            &app_clone,
            &task_transfer_id,
            &task_cancel,
        )
        .await
    };
    spawn_transfer(&app, state.inner(), &sftp_id, &transfer_id, cancel, future)
}

/// 下载远端目录到本地。走后台 tokio 任务,支持取消,聚合字节进度。
#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    state: State<'_, AppState>,
    sftp_id: String,
    remote_dir: String,
    local_dir: String,
    transfer_id: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let task_cancel = cancel.clone();
    let app_clone = app.clone();
    let task_transfer_id = transfer_id.clone();
    let future = async move {
        do_download_dir(
            &sftp,
            &remote_dir,
            &local_dir,
            &app_clone,
            &task_transfer_id,
            &task_cancel,
        )
        .await
    };
    spawn_transfer(&app, state.inner(), &sftp_id, &transfer_id, cancel, future)
}

async fn do_upload_dir(
    sftp: &SftpSession,
    local_dir: &str,
    remote_dir: &str,
    app: &AppHandle,
    transfer_id: &str,
    cancel: &AtomicBool,
) -> Result<()> {
    // 1. 预扫描本地
    let root = std::path::PathBuf::from(local_dir);
    let local_dir_label = local_dir.to_string();
    let (files, dirs, total) = tokio::task::spawn_blocking(move || {
        let mut files: Vec<(std::path::PathBuf, String, u64)> = Vec::new();
        let mut dirs: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        scan_local_dir(&root, &root, &mut files, &mut dirs)
            .with_context(|| format!("扫描本地目录失败: {local_dir_label}"))?;
        let total = files.iter().map(|file| file.2).sum();
        Ok::<_, anyhow::Error>((files, dirs, total))
    })
    .await
    .context("本地目录扫描任务异常结束")??;

    // 2. 建远端目录树(remote_dir 本身可能已存在,忽略错误)
    let _ = sftp.create_dir(remote_dir).await;
    // BTreeSet 按字典序,通常浅目录在前;深目录 create 时父目录已建
    for rel in &dirs {
        let full = format!("{}/{}", remote_dir.trim_end_matches('/'), rel);
        let _ = sftp.create_dir(&full).await;
    }

    // 3. 逐文件上传,progress 事件按聚合字节
    let event = format!("sftp://transfer/{transfer_id}/progress");
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred: 0,
            total,
            speed: 0.0,
        },
    );
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes: u64 = 0;

    for (lp, rel, _size) in files {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!(CANCEL_MSG));
        }
        let rp = format!("{}/{}", remote_dir.trim_end_matches('/'), rel);
        let mut local = tokio::fs::File::open(&lp)
            .await
            .with_context(|| format!("打开本地文件失败: {}", lp.display()))?;
        let mut remote = sftp
            .create(&rp)
            .await
            .with_context(|| format!("创建远端文件失败: {rp}"))?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!(CANCEL_MSG));
            }
            let n = local.read(&mut buf).await.context("读取本地文件失败")?;
            if n == 0 {
                break;
            }
            remote
                .write_all(&buf[..n])
                .await
                .context("写入远端文件失败")?;
            transferred += n as u64;

            let now = std::time::Instant::now();
            if now.duration_since(last_emit).as_millis() >= 200 {
                let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
                let speed = ((transferred - last_bytes) as f64 / elapsed) / 1024.0;
                let _ = app.emit(
                    &event,
                    TransferProgress {
                        transfer_id: transfer_id.to_string(),
                        transferred,
                        total,
                        speed,
                    },
                );
                last_emit = now;
                last_bytes = transferred;
            }
        }
        remote.flush().await.ok();
    }
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred,
            total,
            speed: 0.0,
        },
    );
    Ok(())
}

async fn do_download_dir(
    sftp: &SftpSession,
    remote_dir: &str,
    local_dir: &str,
    app: &AppHandle,
    transfer_id: &str,
    cancel: &AtomicBool,
) -> Result<()> {
    // 1. 预扫描远端
    let (files, dirs) = walk_remote_dir(sftp, remote_dir).await?;
    let total: u64 = files.iter().map(|f| f.2).sum();

    // 2. 建本地目录树
    tokio::fs::create_dir_all(local_dir)
        .await
        .with_context(|| format!("创建本地目录失败: {local_dir}"))?;
    let mut dirs = dirs;
    dirs.sort_by_key(|path| path.matches('/').count());
    for rel in &dirs {
        let full =
            std::path::Path::new(local_dir).join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        tokio::fs::create_dir_all(&full)
            .await
            .with_context(|| format!("创建本地子目录失败: {}", full.display()))?;
    }

    // 3. 逐文件下载
    let event = format!("sftp://transfer/{transfer_id}/progress");
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred: 0,
            total,
            speed: 0.0,
        },
    );
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes: u64 = 0;

    for (remote_path, rel, _size) in files {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow::anyhow!(CANCEL_MSG));
        }
        let local_path =
            std::path::Path::new(local_dir).join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let mut remote = sftp
            .open(&remote_path)
            .await
            .with_context(|| format!("打开远端文件失败: {remote_path}"))?;
        let mut local = tokio::fs::File::create(&local_path)
            .await
            .with_context(|| format!("创建本地文件失败: {}", local_path.display()))?;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow::anyhow!(CANCEL_MSG));
            }
            let n = remote.read(&mut buf).await.context("读取远端文件失败")?;
            if n == 0 {
                break;
            }
            local
                .write_all(&buf[..n])
                .await
                .context("写入本地文件失败")?;
            transferred += n as u64;
            let now = std::time::Instant::now();
            if now.duration_since(last_emit).as_millis() >= 200 {
                let elapsed = now.duration_since(last_emit).as_secs_f64().max(0.001);
                let speed = ((transferred - last_bytes) as f64 / elapsed) / 1024.0;
                let _ = app.emit(
                    &event,
                    TransferProgress {
                        transfer_id: transfer_id.to_string(),
                        transferred,
                        total,
                        speed,
                    },
                );
                last_emit = now;
                last_bytes = transferred;
            }
        }
        local.flush().await.ok();
    }
    let _ = app.emit(
        &event,
        TransferProgress {
            transfer_id: transfer_id.to_string(),
            transferred,
            total,
            speed: 0.0,
        },
    );
    Ok(())
}

/// 递归扫描本地目录:收集所有文件(绝对路径、相对根的 posix 路径、大小)与子目录相对路径
fn scan_local_dir(
    root: &std::path::Path,
    cur: &std::path::Path,
    files: &mut Vec<(std::path::PathBuf, String, u64)>,
    dirs: &mut std::collections::BTreeSet<String>,
) -> Result<()> {
    for entry in
        std::fs::read_dir(cur).with_context(|| format!("读取目录失败: {}", cur.display()))?
    {
        let entry = entry.context("读取条目失败")?;
        let ft = entry.file_type().context("读取类型失败")?;
        let path = entry.path();
        if ft.is_dir() {
            let rel = path
                .strip_prefix(root)
                .context("计算本地子目录相对路径失败")?
                .to_string_lossy()
                .replace('\\', "/");
            dirs.insert(rel);
            scan_local_dir(root, &path, files, dirs)?;
        } else if ft.is_file() {
            let meta = entry.metadata().context("读取元数据失败")?;
            let rel = path
                .strip_prefix(root)
                .context("计算本地文件相对路径失败")?
                .to_string_lossy()
                .replace('\\', "/");
            files.push((path, rel, meta.len()));
        }
        // symlink 暂不递归
    }
    Ok(())
}

/// 迭代式(避免 async 递归)扫描远端目录:返回 (文件列表, 子目录相对路径列表)
/// 文件列表元素:(完整远端路径, 相对根 posix 路径, 大小)
async fn walk_remote_dir(
    sftp: &SftpSession,
    root: &str,
) -> Result<(Vec<(String, String, u64)>, Vec<String>)> {
    let mut files: Vec<(String, String, u64)> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();
    let mut stack: Vec<String> = vec![String::new()]; // 相对根的路径,空串表示根本身
    while let Some(rel) = stack.pop() {
        let cur = if rel.is_empty() {
            root.to_string()
        } else {
            format!("{}/{}", root.trim_end_matches('/'), rel)
        };
        let entries = sftp
            .read_dir(&cur)
            .await
            .with_context(|| format!("读取远端目录失败: {cur}"))?;
        for e in entries {
            let name = e.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = e.metadata();
            let sub_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel, name)
            };
            let full = format!("{}/{}", cur.trim_end_matches('/'), name);
            // symlink 不递归:有些 SFTP 服务器 follow symlink 后 is_dir 返回 true,
            // 递归进去会误删 symlink 目标内容甚至死循环(指向上级目录)。
            // symlink 当文件处理,remove_file 删的是 symlink 本身而非目标。
            if meta.is_symlink() {
                files.push((full, sub_rel, 0));
            } else if meta.is_dir() {
                dirs.push(sub_rel.clone());
                stack.push(sub_rel);
            } else {
                files.push((full, sub_rel, meta.len()));
            }
        }
    }
    Ok((files, dirs))
}

#[cfg(test)]
mod tests {
    use super::remote_staging_path;

    #[test]
    fn staging_path_stays_next_to_target_and_is_unique() {
        let first = remote_staging_path("/etc/ssh/sshd_config", "tmp");
        let second = remote_staging_path("/etc/ssh/sshd_config", "tmp");

        assert!(first.starts_with("/etc/ssh/sshd_config.kshell-tmp-"));
        assert!(second.starts_with("/etc/ssh/sshd_config.kshell-tmp-"));
        assert_ne!(first, second);
    }
}
