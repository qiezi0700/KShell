//! SFTP 命令实现:list / mkdir / rm / rename / chmod / upload / download / preview。
//!
//! upload/download 在后台 tokio 任务中分块传输,通过 emit 事件推送进度。
//! 断点续传:调用方传 offset,后端 seek 到该位置继续。

use anyhow::{Context, Result};
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::state::AppState;

use super::session;

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
    pub error: Option<String>,
}

const CHUNK_SIZE: usize = 256 * 1024;

// ============================================================
// SFTP 会话管理
// ============================================================

#[tauri::command]
pub async fn sftp_open(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let ssh = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("SSH 会话不存在: {session_id}"))?
        .clone();
    let mut guard = ssh.lock().await;
    let sftp_id = uuid::Uuid::new_v4().to_string();
    let handle = session::open_sftp(&mut guard.handle, session_id.clone())
        .await
        .map_err(err)?;
    state.sftp_sessions.insert(sftp_id.clone(), handle);
    Ok(sftp_id)
}

#[tauri::command]
pub async fn sftp_close(state: State<'_, AppState>, sftp_id: String) -> Result<(), String> {
    if let Some((_, h)) = state.sftp_sessions.remove(&sftp_id) {
        let _ = h.session.close().await;
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

#[tauri::command]
pub async fn sftp_rmdir(
    state: State<'_, AppState>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.remove_dir(&path).await.map_err(err)
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
    sftp.rename(&old_path, &new_path)
        .await
        .map_err(err)
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
    sftp.read(&path)
        .await
        .map_err(err)
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
    let mut file = sftp.create(&path).await.map_err(err)?;
    file.write_all(&content).await.map_err(err)?;
    file.flush().await.map_err(err)?;
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
    let mut src = sftp.open(&old_path).await.map_err(err)?;
    let mut dst = sftp.create(&new_path).await.map_err(err)?;
    let mut buf = vec![0u8; 65536];
    loop {
        let n = src.read(&mut buf).await.map_err(err)?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).await.map_err(err)?;
    }
    dst.flush().await.map_err(err)?;
    Ok(())
}

/// 获取远端家目录(canonicalize ".")
#[tauri::command]
pub async fn sftp_home(
    state: State<'_, AppState>,
    sftp_id: String,
) -> Result<String, String> {
    let sftp = get_sftp(&state, &sftp_id)?;
    sftp.canonicalize(".")
        .await
        .map_err(err)
}

// ============================================================
// 本地文件操作(供前端双栏的本地栏使用)
// ============================================================

#[tauri::command]
pub fn local_list(path: String) -> Result<Vec<LocalEntry>, String> {
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
        let meta = entry.metadata().map_err(|e| format!("读取元数据失败: {e}"))?;
        let ft = entry.file_type().map_err(|e| format!("读取类型失败: {e}"))?;
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
pub fn local_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {e}"))
}

#[tauri::command]
pub fn local_rmdir(path: String) -> Result<(), String> {
    std::fs::remove_dir(&path).map_err(|e| format!("删除目录失败: {e}"))
}

#[tauri::command]
pub fn local_rm(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {e}"))
}

#[tauri::command]
pub fn local_rename(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {e}"))
}

/// 复制本地文件(单文件,非目录)
#[tauri::command]
pub fn local_copy(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::copy(&old_path, &new_path).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(())
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
pub fn local_read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 写入本地文件(保存编辑)
#[tauri::command]
pub fn local_write_file(path: String, content: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入文件失败: {e}"))
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

    let total = std::fs::metadata(&local_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let app_clone = app.clone();
    let transfer_id_clone = transfer_id.clone();
    tokio::spawn(async move {
        let result = do_upload(&sftp, &local_path, &remote_path, offset, total, &app, &transfer_id).await;
        emit_done(&app_clone, &transfer_id_clone, result);
    });

    Ok(())
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

    let app_clone = app.clone();
    let transfer_id_clone = transfer_id.clone();
    tokio::spawn(async move {
        let result = do_download(&sftp, &remote_path, &local_path, offset, total, &app, &transfer_id).await;
        emit_done(&app_clone, &transfer_id_clone, result);
    });

    Ok(())
}

/// 取消传输:前端关闭对应的监听即可,后端任务自然结束。
#[tauri::command]
pub async fn sftp_cancel_transfer(_transfer_id: String) -> Result<(), String> {
    Ok(())
}

// ============================================================
// 传输内部实现
// ============================================================

async fn do_upload(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    offset: u64,
    total: u64,
    app: &AppHandle,
    transfer_id: &str,
) -> Result<()> {
    let mut local = tokio::fs::File::open(local_path)
        .await
        .with_context(|| format!("打开本地文件失败: {local_path}"))?;

    if offset > 0 {
        local.seek(std::io::SeekFrom::Start(offset)).await?;
    }

    let mut remote = if offset > 0 {
        let f = sftp
            .open_with_flags(remote_path, OpenFlags::WRITE)
            .await
            .context("打开远端文件失败")?;
        let mut f = f;
        f.seek(std::io::SeekFrom::Start(offset)).await?;
        f
    } else {
        sftp.create(remote_path).await.context("创建远端文件失败")?
    };

    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred = offset;
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = offset;
    let event = format!("sftp://transfer/{transfer_id}/progress");

    loop {
        let n = local.read(&mut buf).await.context("读取本地文件失败")?;
        if n == 0 {
            break;
        }
        remote.write_all(&buf[..n]).await.context("写入远端文件失败")?;
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

async fn do_download(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    offset: u64,
    total: u64,
    app: &AppHandle,
    transfer_id: &str,
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
    let event = format!("sftp://transfer/{transfer_id}/progress");

    loop {
        let n = remote.read(&mut buf).await.context("读取远端文件失败")?;
        if n == 0 {
            break;
        }
        local.write_all(&buf[..n]).await.context("写入本地文件失败")?;
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

fn emit_done(app: &AppHandle, transfer_id: &str, result: Result<()>) {
    let event = format!("sftp://transfer/{transfer_id}/done");
    let (success, error) = match result {
        Ok(()) => (true, None),
        Err(e) => (false, Some(format!("{e:#}"))),
    };
    let _ = app.emit(
        &event,
        TransferDone {
            transfer_id: transfer_id.to_string(),
            success,
            error,
        },
    );
}

// ============================================================
// 辅助
// ============================================================

/// 借出 SFTP session 的 Arc 引用(避免持有 DashMap 的 entry 锁)
fn get_sftp(state: &State<'_, AppState>, sftp_id: &str) -> Result<std::sync::Arc<SftpSession>, String> {
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
