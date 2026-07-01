use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ssh::{self, ChannelCommand, SshConfig, SshSession};
use crate::state::{AppState, ChannelId, SessionId};
use crate::store::{Group, Session};

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

// ============================================================
// 凭据保险箱(Stronghold)
// ============================================================

#[tauri::command]
pub async fn vault_set(
    app: AppHandle,
    password: String,
    key: String,
    value: String,
) -> Result<(), String> {
    crate::vault::set(&app, &password, &key, value).await.map_err(err)
}

#[tauri::command]
pub async fn vault_get(
    app: AppHandle,
    password: String,
    key: String,
) -> Result<Option<String>, String> {
    crate::vault::get(&app, &password, &key).await.map_err(err)
}

#[tauri::command]
pub async fn vault_delete(
    app: AppHandle,
    password: String,
    key: String,
) -> Result<(), String> {
    crate::vault::delete(&app, &password, &key).await.map_err(err)
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

#[tauri::command]
pub fn session_upsert(state: State<'_, AppState>, session: Session) -> Result<Session, String> {
    state.store()?.upsert_session(session).map_err(err)
}

#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store()?.delete_session(&id).map_err(err)
}

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    cfg: SshConfig,
) -> Result<SessionId, String> {
    let session = ssh::connect(cfg).await.map_err(err)?;
    let id: SessionId = Uuid::new_v4().to_string();
    state
        .sessions
        .insert(id.clone(), Arc::new(Mutex::new(session)));
    Ok(id)
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
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), String> {
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
        let mut guard = session.lock().await;
        let _ = guard
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }
    Ok(())
}
