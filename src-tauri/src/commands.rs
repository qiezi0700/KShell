use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ssh::{self, ChannelCommand, SshConfig};
use crate::state::{AppState, ChannelId, HostConfirmResult, SessionId};
use crate::store::{Group, QuickCommand, Session};

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
    let ssh_handle = {
        let session = session.lock().await;
        session.handle.clone()
    };
    let handle = ssh::channel::open_shell(
        &ssh_handle,
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
    let ssh_handle = {
        let session = session.lock().await;
        session.handle.clone()
    };
    let handle = ssh::channel::open_exec(
        &ssh_handle,
        app,
        ch_id.clone(),
        session_id.clone(),
        command,
        cols,
        rows,
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

fn validate_exec_stdin(stdin: &[u8]) -> Result<(), String> {
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

async fn execute_ssh_command(
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
    let ssh_handle = {
        let session = session.lock().await;
        session.handle.clone()
    };
    let mut channel = ssh_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开 exec channel 失败: {e}"))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("请求 exec 失败: {e}"))?;

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

    // 收集全部输出直到 EOF/Close；监控脚本输出较小，直接拼接
    let mut out = Vec::new();
    let mut exit_status = None;
    let wait_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data[..]),
                Some(ChannelMsg::ExtendedData { data, .. }) => out.extend_from_slice(&data[..]),
                Some(ChannelMsg::ExitStatus {
                    exit_status: status,
                }) => {
                    exit_status = Some(status);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
    };

    if let Some(ms) = timeout_ms {
        if tokio::time::timeout(Duration::from_millis(ms), wait_loop)
            .await
            .is_err()
        {
            let _ = channel.close().await;
            return Err(format!(
                "命令执行超时({ms}毫秒)，可能是远端 sudo 等待密码或网络卡住"
            ));
        }
    } else {
        wait_loop.await;
    }
    let _ = channel.close().await;
    finish_exec_result(out, exit_status)
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

    // SFTP 子会话持有独立 channel，必须在移除 SSH 主会话前显式关闭。
    let sftp_ids: Vec<_> = state
        .sftp_sessions
        .iter()
        .filter(|entry| entry.value().ssh_session_id == session_id)
        .map(|entry| entry.key().clone())
        .collect();
    for id in sftp_ids {
        crate::sftp::commands::abort_transfers_for_sftp(&app, state.inner(), &id);
        if let Some((_, handle)) = state.sftp_sessions.remove(&id) {
            let _ = handle.session.close().await;
        }
    }

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
    if let Some((_, session)) = state.sessions.remove(&session_id) {
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
    use super::{finish_exec_result, validate_exec_stdin, MAX_EXEC_STDIN_BYTES};

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
}
