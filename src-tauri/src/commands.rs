use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ssh::{self, ChannelCommand, SshConfig};
use crate::state::{AppState, ChannelId, HostConfirmResult, SessionId};
use crate::store::{Group, QuickCommand, Session};

const MAX_SESSION_CONFIG_BYTES: u64 = 8 * 1024 * 1024;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

// ============================================================
// 持久化:分组 / 会话 CRUD
// ============================================================

#[tauri::command]
pub fn groups_list(state: State<'_, AppState>) -> Result<Vec<Group>, String> {
    state.store()?.list_groups().map_err(err)
}

#[tauri::command]
pub fn group_upsert(state: State<'_, AppState>, group: Group) -> Result<Group, String> {
    state.store()?.upsert_group(group).map_err(err)
}

#[tauri::command]
pub fn group_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store()?.delete_group(&id).map_err(err)
}

#[tauri::command]
pub fn sessions_list(state: State<'_, AppState>) -> Result<Vec<Session>, String> {
    state.store()?.list_sessions().map_err(err)
}

/// upsert 会话时的前端入参。含明文凭据,后端加密后入库。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    #[serde(flatten)]
    pub session: Session,
    /// 明文密码,空串视为不更新
    #[serde(default)]
    pub password: String,
    /// 明文 passphrase,空串视为不更新
    #[serde(default)]
    pub passphrase: String,
}

#[tauri::command]
pub fn session_upsert(state: State<'_, AppState>, input: SessionInput) -> Result<Session, String> {
    let pwd_enc = if input.password.is_empty() {
        None
    } else {
        state.crypto.encrypt(&input.password).map_err(err)?
    };
    let pass_enc = if input.passphrase.is_empty() {
        None
    } else {
        state.crypto.encrypt(&input.passphrase).map_err(err)?
    };
    state
        .store()?
        .upsert_session(input.session, pwd_enc, pass_enc)
        .map_err(err)
}

#[tauri::command]
pub fn session_get_credentials(
    state: State<'_, AppState>,
    id: String,
) -> Result<CredentialsOut, String> {
    let creds = state
        .store()?
        .get_credentials(&id, &state.crypto)
        .map_err(err)?;
    Ok(CredentialsOut {
        password: creds.password,
        passphrase: creds.passphrase,
    })
}

/// 由 Rust 端打开文件选择器并读取会话配置，避免把任意本地读取命令暴露给 WebView。
#[tauri::command]
pub async fn session_import_file(app: AppHandle) -> Result<Option<String>, String> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("导入会话配置")
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("导入文件选择器异常结束: {e}"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("读取所选文件路径失败: {e}"))?;
    let size = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("读取会话配置文件信息失败: {e}"))?
        .len();
    if size > MAX_SESSION_CONFIG_BYTES {
        return Err("会话配置文件过大，最多允许 8 MB".to_string());
    }
    tokio::fs::read_to_string(&path)
        .await
        .map(Some)
        .map_err(|e| format!("读取会话配置文件失败: {e}"))
}

/// 保存路径同样由原生对话框产生，前端不能指定任意文件写入。
#[tauri::command]
pub async fn session_export_file(
    app: AppHandle,
    content: String,
) -> Result<Option<String>, String> {
    if content.len() as u64 > MAX_SESSION_CONFIG_BYTES {
        return Err("会话配置内容过大，最多允许 8 MB".to_string());
    }
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("导出会话配置")
            .set_file_name("kshell-sessions.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| format!("导出文件选择器异常结束: {e}"))?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("读取保存路径失败: {e}"))?;
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("写入会话配置文件失败: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialsOut {
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store()?.delete_session(&id).map_err(err)
}

// ============================================================
// 设置 & 快捷指令(原 localStorage 迁移至 SQLite)
// ============================================================

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.store()?.get_setting(&key).map_err(err)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state.store()?.set_setting(&key, &value).map_err(err)
}

#[tauri::command]
pub fn quick_commands_list(state: State<'_, AppState>) -> Result<Vec<QuickCommand>, String> {
    state.store()?.list_quick_commands().map_err(err)
}

#[tauri::command]
pub fn quick_command_upsert(
    state: State<'_, AppState>,
    item: QuickCommand,
) -> Result<QuickCommand, String> {
    state.store()?.upsert_quick_command(item).map_err(err)
}

#[tauri::command]
pub fn quick_command_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store()?.delete_quick_command(&id).map_err(err)
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    cfg: SshConfig,
) -> Result<SessionId, String> {
    let session = ssh::connect(app, cfg).await.map_err(err)?;
    let id: SessionId = Uuid::new_v4().to_string();
    state
        .sessions
        .insert(id.clone(), Arc::new(Mutex::new(session)));
    Ok(id)
}

// ============================================================
// 主机公钥校验(M1.5)
// ============================================================

/// 前端收到 ssh://host-key/confirm 事件后,用户确认是否信任该主机。
/// accept=true 则 check_server_key 继续握手并写入 known_hosts;
/// sync_to_system=true 时同时追加到系统 ~/.ssh/known_hosts。
#[tauri::command]
pub async fn ssh_confirm_host(
    state: State<'_, AppState>,
    confirm_id: String,
    accept: bool,
    sync_to_system: bool,
) -> Result<(), String> {
    if let Some((_, tx)) = state.pending_host_confirms.remove(&confirm_id) {
        let _ = tx.send(HostConfirmResult {
            accepted: accept,
            sync_to_system,
        });
    }
    Ok(())
}

/// 公钥不匹配时,用户确认服务器确实换钥后,移除旧记录以便重新走首次确认流程。
#[tauri::command]
pub async fn ssh_remove_known_host(
    state: State<'_, AppState>,
    host: String,
    port: u16,
) -> Result<(), String> {
    let mut kh = state.known_hosts.write().await;
    kh.remove(&host, port).map_err(err)
}

/// 列出全部已知主机(app 库 + 系统 ~/.ssh/known_hosts 只读参考)。
/// 前端"管理已知主机"面板用
#[tauri::command]
pub async fn ssh_list_known_hosts(
    state: State<'_, AppState>,
) -> Result<Vec<ssh::known_hosts::KnownHostRecord>, String> {
    let kh = state.known_hosts.read().await;
    Ok(kh.list())
}

/// 前端收到 ssh://ki-prompt 事件后,把用户填写的 answers 回传,继续 keyboard-interactive 认证。
#[tauri::command]
pub async fn ssh_ki_respond(
    state: State<'_, AppState>,
    prompt_id: String,
    responses: Vec<String>,
) -> Result<(), String> {
    if let Some((_, tx)) = state.pending_ki_prompts.remove(&prompt_id) {
        let _ = tx.send(responses);
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_open_shell(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: SessionId,
    cols: u32,
    rows: u32,
    channel_id: ChannelId,
) -> Result<ChannelId, String> {
    validate_channel_id(&state, &channel_id)?;
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    let ch_id = channel_id;
    let (ssh_handle, scheduler) = {
        let session = session.lock().await;
        (session.handle.clone(), session.scheduler.clone())
    };
    let handle = ssh::channel::open_shell(
        &ssh_handle,
        &scheduler,
        app,
        ch_id.clone(),
        session_id.clone(),
        cols,
        rows,
    )
    .await
    .map_err(err)?;
    state.channels.insert(ch_id.clone(), handle);
    start_channel(state.inner(), &ch_id)?;
    Ok(ch_id)
}

/// 在已有 SSH 会话上以 PTY 模式执行指定命令(交互式,如 docker exec -it),
/// 返回 channel id 供前端持续读写,命令结束后 channel 自动关闭。
#[tauri::command]
pub async fn ssh_open_exec(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: SessionId,
    command: String,
    cols: u32,
    rows: u32,
    channel_id: ChannelId,
) -> Result<ChannelId, String> {
    validate_channel_id(&state, &channel_id)?;
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    let ch_id = channel_id;
    let (ssh_handle, scheduler) = {
        let session = session.lock().await;
        (session.handle.clone(), session.scheduler.clone())
    };
    let handle = ssh::channel::open_exec(
        &ssh_handle,
        &scheduler,
        app,
        ch_id.clone(),
        session_id.clone(),
        ssh::channel::ExecChannelSpec {
            command,
            cols,
            rows,
        },
    )
    .await
    .map_err(err)?;
    state.channels.insert(ch_id.clone(), handle);
    start_channel(state.inner(), &ch_id)?;
    Ok(ch_id)
}

fn start_channel(state: &AppState, channel_id: &str) -> Result<(), String> {
    let channel = state
        .channels
        .get(channel_id)
        .ok_or_else(|| "通道初始化失败".to_string())?;
    if channel.tx.send(ChannelCommand::Start).is_err() {
        drop(channel);
        state.channels.remove(channel_id);
        return Err("通道启动失败".to_string());
    }
    Ok(())
}

fn validate_channel_id(state: &AppState, channel_id: &str) -> Result<(), String> {
    Uuid::parse_str(channel_id).map_err(|_| "通道 ID 格式无效".to_string())?;
    if state.channels.contains_key(channel_id) {
        return Err("通道 ID 已存在".to_string());
    }
    Ok(())
}

const MAX_EXEC_STDIN_BYTES: usize = 64 * 1024;
const MAX_EXEC_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

fn append_exec_output(out: &mut Vec<u8>, data: &[u8]) -> Result<(), String> {
    if data.len() > MAX_EXEC_OUTPUT_BYTES.saturating_sub(out.len()) {
        return Err(format!(
            "命令输出过大，最多允许 {MAX_EXEC_OUTPUT_BYTES} 字节，请缩小查询范围"
        ));
    }
    out.extend_from_slice(data);
    Ok(())
}

pub(crate) fn validate_exec_stdin(stdin: &[u8]) -> Result<(), String> {
    if stdin.len() > MAX_EXEC_STDIN_BYTES {
        return Err(format!(
            "命令标准输入过长，最多允许 {MAX_EXEC_STDIN_BYTES} 字节"
        ));
    }
    Ok(())
}

/// 在已有 SSH 会话上一次性执行命令(request_exec),收集 stdout+stderr 后关闭 channel。
/// 供 M4 监控采集与 M5 Docker 数据获取复用。
/// timeout_ms 为 None 时无超时(默认,兼容监控等长轮询场景);Docker 安装等
/// 可能卡住的命令应传超时(如 300_000),避免远端 sudo 提示或网络问题导致永久挂起。

#[tauri::command]
pub async fn ssh_exec(
    state: State<'_, AppState>,
    session_id: SessionId,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    execute_ssh_command(state.inner(), session_id, command, None, timeout_ms).await
}

#[tauri::command]
pub async fn ssh_exec_with_stdin(
    state: State<'_, AppState>,
    session_id: SessionId,
    command: String,
    stdin: Vec<u8>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    validate_exec_stdin(&stdin)?;
    execute_ssh_command(state.inner(), session_id, command, Some(stdin), timeout_ms).await
}

pub(crate) async fn execute_ssh_command(
    state: &AppState,
    session_id: SessionId,
    command: String,
    stdin: Option<Vec<u8>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    let (ssh_handle, scheduler) = {
        let session = session.lock().await;
        (session.handle.clone(), session.scheduler.clone())
    };
    let mut lease = scheduler
        .open_exec(&ssh_handle)
        .await
        .map_err(|e| format!("调度 exec channel 失败: {e:#}"))?;
    let (framed_command, exit_marker) = frame_exec_command(&command);
    lease
        .channel
        .exec(true, framed_command.as_bytes())
        .await
        .map_err(|e| format!("请求 exec 失败: {e}"))?;
    let channel = &mut lease.channel;

    if let Some(stdin) = stdin {
        if let Err(e) = channel.data(&stdin[..]).await {
            let _ = channel.close().await;
            return Err(format!("写入命令标准输入失败: {e}"));
        }
        if let Err(e) = channel.eof().await {
            let _ = channel.close().await;
            return Err(format!("关闭命令标准输入失败: {e}"));
        }
    }

    // 一次性命令必须限制累计输出，避免异常日志或 inspect 数据耗尽桌面端内存。
    let mut out = Vec::new();
    let mut exit_status = None;
    let wait_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => append_exec_output(&mut out, &data[..])?,
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    append_exec_output(&mut out, &data[..])?
                }
                Some(ChannelMsg::ExitStatus {
                    exit_status: status,
                }) => {
                    exit_status = Some(status);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
        Ok::<(), String>(())
    };

    let wait_result = if let Some(ms) = timeout_ms {
        match tokio::time::timeout(Duration::from_millis(ms), wait_loop).await {
            Ok(result) => result,
            Err(_) => {
                let _ = channel.close().await;
                return Err(format!(
                    "命令执行超时({ms}毫秒)，可能是远端 sudo 等待密码或网络卡住"
                ));
            }
        }
    } else {
        wait_loop.await
    };
    if let Err(error) = wait_result {
        let _ = channel.close().await;
        return Err(error);
    }
    let _ = channel.close().await;
    let (out, framed_exit_status) = extract_framed_exit_status(out, &exit_marker);
    finish_exec_result(out, framed_exit_status.or(exit_status))
}

fn frame_exec_command(command: &str) -> (String, String) {
    let marker = format!("__KSHELL_EXIT_{}__:", Uuid::new_v4().simple());
    let framed_command = format!(
        "(\n{command}\n)\n__kshell_exit_status=$?\nprintf '\\n{marker}%s\\n' \"$__kshell_exit_status\"\n"
    );
    (framed_command, marker)
}

fn extract_framed_exit_status(out: Vec<u8>, marker: &str) -> (Vec<u8>, Option<u32>) {
    let marker = marker.as_bytes();
    let Some(marker_start) = out
        .windows(marker.len())
        .rposition(|window| window == marker)
    else {
        return (out, None);
    };
    let status_start = marker_start + marker.len();
    let status_end = out[status_start..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map(|offset| status_start + offset)
        .unwrap_or(out.len());
    if status_end == status_start {
        return (out, None);
    }
    let Ok(status_text) = std::str::from_utf8(&out[status_start..status_end]) else {
        return (out, None);
    };
    let Ok(status) = status_text.parse::<u32>() else {
        return (out, None);
    };

    let marker_line_end = match out.get(status_end..) {
        Some([b'\r', b'\n', ..]) => status_end + 2,
        Some([b'\n', ..]) => status_end + 1,
        _ if status_end == out.len() => status_end,
        _ => return (out, None),
    };
    // 包装层会在标记前额外输出一个换行，只移除这一层，保留命令原本的结尾格式。
    let output_prefix_end =
        if out.get(marker_start.saturating_sub(2)..marker_start) == Some(b"\r\n") {
            marker_start - 2
        } else if out.get(marker_start.saturating_sub(1)..marker_start) == Some(b"\n") {
            marker_start - 1
        } else {
            marker_start
        };
    let mut cleaned = Vec::with_capacity(out.len() - (marker_line_end - output_prefix_end));
    cleaned.extend_from_slice(&out[..output_prefix_end]);
    cleaned.extend_from_slice(&out[marker_line_end..]);
    (cleaned, Some(status))
}

fn finish_exec_result(out: Vec<u8>, exit_status: Option<u32>) -> Result<String, String> {
    let output = String::from_utf8_lossy(&out).to_string();
    match exit_status {
        Some(0) => Ok(output),
        Some(code) => {
            let detail = output.trim();
            if detail.is_empty() {
                Err(format!("远端命令执行失败(exit {code})"))
            } else {
                Err(format!("远端命令执行失败(exit {code}):\n{detail}"))
            }
        }
        None => {
            let detail = output.trim();
            if detail.is_empty() {
                Err("远端命令未返回退出状态，无法确认是否执行成功".to_string())
            } else {
                Err(format!(
                    "远端命令未返回退出状态，无法确认是否执行成功:\n{detail}"
                ))
            }
        }
    }
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    channel_id: ChannelId,
    data: Vec<u8>,
) -> Result<(), String> {
    let ch = state
        .channels
        .get(&channel_id)
        .ok_or_else(|| format!("通道不存在: {channel_id}"))?;
    ch.tx
        .send(ChannelCommand::Data(data))
        .map_err(|_| "通道已关闭".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    channel_id: ChannelId,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let ch = state
        .channels
        .get(&channel_id)
        .ok_or_else(|| format!("通道不存在: {channel_id}"))?;
    ch.tx
        .send(ChannelCommand::Resize { cols, rows })
        .map_err(|_| "通道已关闭".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_close_channel(
    state: State<'_, AppState>,
    channel_id: ChannelId,
) -> Result<(), String> {
    if let Some((_, ch)) = state.channels.remove(&channel_id) {
        let _ = ch.tx.send(ChannelCommand::Close);
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), String> {
    // 先关闭该会话下的所有隧道,避免 session 移除后隧道回调无法路由
    crate::ssh::tunnel::tunnel_close_session(&app, &state, &session_id).await;

    // 与进行中的 SFTP 初始化串行，并先移除 SSH 主会话，阻止新的子资源进入。
    let sftp_open_lock = state
        .sftp_open_locks
        .get(&session_id)
        .map(|entry| entry.value().clone());
    let _sftp_open_guard = match sftp_open_lock.as_ref() {
        Some(lock) => Some(lock.lock().await),
        None => None,
    };
    let session = state
        .sessions
        .remove(&session_id)
        .map(|(_, session)| session);

    // 前端 sftp_id 是共享 subsystem 的租约，断开时先清租约，再只关闭底层会话一次。
    let sftp_ids: Vec<_> = state
        .sftp_sessions
        .iter()
        .filter(|entry| entry.value().ssh_session_id == session_id)
        .map(|entry| entry.key().clone())
        .collect();
    for id in sftp_ids {
        crate::sftp::commands::abort_transfers_for_sftp(&app, state.inner(), &id);
        crate::sftp::local_scope::remove_root(state.inner(), &id);
        state.sftp_sessions.remove(&id);
    }
    if let Some((_, shared)) = state.shared_sftp_sessions.remove(&session_id) {
        let _ = shared.session.close().await;
    }
    state.sftp_open_locks.remove(&session_id);

    // 关闭该会话下所有通道
    let ch_ids: Vec<_> = state
        .channels
        .iter()
        .filter(|e| e.value().session_id == session_id)
        .map(|e| e.key().clone())
        .collect();
    for id in ch_ids {
        if let Some((_, ch)) = state.channels.remove(&id) {
            let _ = ch.tx.send(ChannelCommand::Close);
        }
    }
    if let Some(session) = session {
        let ssh_handle = {
            let session = session.lock().await;
            session.handle.clone()
        };
        let _ = ssh_handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        append_exec_output, extract_framed_exit_status, finish_exec_result, frame_exec_command,
        validate_exec_stdin, MAX_EXEC_OUTPUT_BYTES, MAX_EXEC_STDIN_BYTES,
    };

    #[test]
    fn exec_stdin_rejects_oversized_input() {
        let input = vec![0; MAX_EXEC_STDIN_BYTES + 1];
        let error = validate_exec_stdin(&input).expect_err("超长标准输入必须被拒绝");
        assert!(error.contains("标准输入过长"));
    }

    #[test]
    fn exec_stdin_accepts_input_at_limit() {
        let input = vec![0; MAX_EXEC_STDIN_BYTES];
        validate_exec_stdin(&input).expect("边界长度的标准输入应被接受");
    }
    #[test]
    fn exec_output_rejects_data_beyond_limit() {
        let mut output = vec![0; MAX_EXEC_OUTPUT_BYTES];
        let error = append_exec_output(&mut output, &[1]).expect_err("超过上限的输出必须被拒绝");
        assert!(error.contains("命令输出过大"));
    }

    #[test]
    fn exec_output_accepts_data_at_limit() {
        let mut output = vec![0; MAX_EXEC_OUTPUT_BYTES - 1];
        append_exec_output(&mut output, &[1]).expect("边界长度的输出应被接受");
        assert_eq!(output.len(), MAX_EXEC_OUTPUT_BYTES);
    }
    #[test]
    fn exec_result_rejects_non_zero_status() {
        let error = finish_exec_result(b"permission denied\n".to_vec(), Some(1))
            .expect_err("非零退出码必须返回错误");
        assert!(error.contains("exit 1"));
        assert!(error.contains("permission denied"));
    }

    #[test]
    fn exec_result_accepts_zero_status() {
        assert_eq!(
            finish_exec_result(b"ok\n".to_vec(), Some(0)).expect("退出码 0 应成功"),
            "ok\n"
        );
    }

    #[test]
    fn exec_result_rejects_missing_status() {
        let error = finish_exec_result(b"legacy output\n".to_vec(), None)
            .expect_err("缺少退出状态时必须拒绝误判成功");
        assert!(error.contains("未返回退出状态"));
        assert!(error.contains("legacy output"));
    }

    #[test]
    fn framed_exec_recovers_status_when_ssh_status_is_missing() {
        let (_, marker) = frame_exec_command("printf ok");
        let framed = format!("ok\n{marker}0\n").into_bytes();
        let (output, status) = extract_framed_exit_status(framed, &marker);

        assert_eq!(status, Some(0));
        assert_eq!(output, b"ok");
        assert_eq!(
            finish_exec_result(output, status).expect("应用层退出码 0 应成功"),
            "ok"
        );
    }

    #[test]
    fn framed_exec_preserves_original_trailing_newline() {
        let (_, marker) = frame_exec_command("printf 'ok\\n'");
        let framed = format!("ok\n\n{marker}0\n").into_bytes();
        let (output, status) = extract_framed_exit_status(framed, &marker);

        assert_eq!(status, Some(0));
        assert_eq!(output, b"ok\n");
    }

    #[test]
    fn framed_exec_status_overrides_wrapper_ssh_status() {
        let (_, marker) = frame_exec_command("false");
        let framed = format!("denied\n{marker}7\n").into_bytes();
        let (output, framed_status) = extract_framed_exit_status(framed, &marker);
        let effective_status = framed_status.or(Some(0));
        let error = finish_exec_result(output, effective_status)
            .expect_err("应用层非零退出码不能被包装命令的退出码覆盖");

        assert!(error.contains("exit 7"));
        assert!(error.contains("denied"));
    }

    #[test]
    fn framed_exec_preserves_data_after_marker() {
        let (_, marker) = frame_exec_command("printf out");
        let framed = format!("out\n{marker}0\nlate stderr\n").into_bytes();
        let (output, status) = extract_framed_exit_status(framed, &marker);

        assert_eq!(status, Some(0));
        assert_eq!(output, b"outlate stderr\n");
    }
}
