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
) -> Result<ChannelId, String> {
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    let ch_id: ChannelId = Uuid::new_v4().to_string();
    let mut guard = session.lock().await;
    let handle = ssh::channel::open_shell(
        &mut guard.handle,
        app,
        ch_id.clone(),
        session_id.clone(),
        cols,
        rows,
    )
    .await
    .map_err(err)?;
    drop(guard);
    state.channels.insert(ch_id.clone(), handle);
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
) -> Result<ChannelId, String> {
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    let ch_id: ChannelId = Uuid::new_v4().to_string();
    let mut guard = session.lock().await;
    let handle = ssh::channel::open_exec(
        &mut guard.handle,
        app,
        ch_id.clone(),
        session_id.clone(),
        command,
        cols,
        rows,
    )
    .await
    .map_err(err)?;
    drop(guard);
    state.channels.insert(ch_id.clone(), handle);
    Ok(ch_id)
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
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();
    // 只在开 channel 时持锁,exec/wait 期间释放,避免阻塞同会话的终端写入/SFTP
    let mut channel = {
        let guard = session.lock().await;
        guard
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("打开 exec channel 失败: {e}"))?
    };
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("请求 exec 失败: {e}"))?;

    // 收集全部输出直到 EOF/Close;监控脚本输出较小,直接拼接
    let mut out = Vec::new();
    let wait_loop = async {
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data[..]),
                Some(ChannelMsg::ExtendedData { data, .. }) => out.extend_from_slice(&data[..]),
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
            return Err(format!("命令执行超时({ms}毫秒),可能是远端 sudo 等待密码或网络卡住"));
        }
    } else {
        wait_loop.await;
    }
    let _ = channel.close().await;
    Ok(String::from_utf8_lossy(&out).to_string())
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
        let guard = session.lock().await;
        let _ = guard
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }
    Ok(())
}
