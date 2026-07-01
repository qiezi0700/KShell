//! SSH 端口转发/隧道实现。
//!
//! 支持两类规则:
//! - 本地转发(LocalForward):本机监听端口,连接经 SSH 隧道转发到远端目标。
//! - 远程转发(RemoteForward):远端服务器监听端口,连接经 SSH 隧道转发到本机目标。
//!
//! russh 提供的核心 API:
//! - `channel_open_direct_tcpip` 用于本地转发的新连接。
//! - `tcpip_forward` / `cancel_tcpip_forward` 用于注册/注销远程转发。
//! - `ClientHandler::server_channel_open_forwarded_tcpip` 回调处理远程转发进来的连接。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use russh::client::Msg;
use russh::Channel;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::state::{AppState, SessionId, TunnelId};

/// 隧道类型
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TunnelKind {
    /// 本地转发:监听 local_addr:local_port,转发到 remote_host:remote_port
    Local {
        local_addr: String,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
    },
    /// 远程转发:服务端监听 bind_addr:bind_port,转发到 local_host:local_port
    Remote {
        bind_addr: String,
        bind_port: u16,
        local_host: String,
        local_port: u16,
    },
}

/// 隧道运行状态(序列化给前端)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelState {
    Active,
    Error(String),
    Closed,
}

/// 前端可见的隧道信息
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub id: TunnelId,
    pub session_id: SessionId,
    pub kind: TunnelKind,
    pub state: TunnelState,
}

/// 内部隧道记录
pub struct Tunnel {
    pub id: TunnelId,
    pub session_id: SessionId,
    pub kind: TunnelKind,
    pub state: TunnelState,
    /// 置位时监听循环或转发任务应退出
    pub cancel: Arc<AtomicBool>,
}

/// 存储在 AppState.tunnels 中的条目
pub struct TunnelEntry {
    pub tunnel: Arc<Mutex<Tunnel>>,
    /// 本地转发的监听任务句柄;远程转发无本地监听任务,为 None
    pub task_handle: Option<tokio::task::JoinHandle<()>>,
}

impl TunnelEntry {
    async fn set_state(&self, app: &AppHandle, state: TunnelState) {
        let mut t = self.tunnel.lock().await;
        t.state = state;
        let _ = app.emit(
            &format!("ssh://tunnel/{}/update", t.id),
            TunnelInfo {
                id: t.id.clone(),
                session_id: t.session_id.clone(),
                kind: t.kind.clone(),
                state: t.state.clone(),
            },
        );
    }
}

// ============================================================
// 前端命令
// ============================================================

/// 列出某 SSH 会话的所有隧道
#[tauri::command]
pub async fn tunnel_list(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<TunnelInfo>, String> {
    let mut out = Vec::new();
    for entry in state.tunnels.iter() {
        let t = entry.tunnel.lock().await;
        if t.session_id == session_id {
            out.push(TunnelInfo {
                id: t.id.clone(),
                session_id: t.session_id.clone(),
                kind: t.kind.clone(),
                state: t.state.clone(),
            });
        }
    }
    Ok(out)
}

/// 新增一条隧道并立即启动
#[tauri::command]
pub async fn tunnel_add(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    kind: TunnelKind,
) -> Result<TunnelId, String> {
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("会话不存在: {session_id}"))?
        .clone();

    let id = Uuid::new_v4().to_string();
    let tunnel = Arc::new(Mutex::new(Tunnel {
        id: id.clone(),
        session_id: session_id.clone(),
        kind: kind.clone(),
        state: TunnelState::Active,
        cancel: Arc::new(AtomicBool::new(false)),
    }));

    match kind {
        TunnelKind::Local {
            local_addr,
            local_port,
            remote_host,
            remote_port,
        } => {
            let listener = TcpListener::bind((local_addr.as_str(), local_port))
                .await
                .map_err(|e| format!("绑定本地端口失败: {e}"))?;
            // 端口为 0 时返回实际分配的端口
            let bound_port = listener
                .local_addr()
                .map(|a| a.port())
                .unwrap_or(local_port);
            {
                let mut t = tunnel.lock().await;
                t.kind = TunnelKind::Local {
                    local_addr,
                    local_port: bound_port,
                    remote_host: remote_host.clone(),
                    remote_port,
                };
            }

            let app_clone = app.clone();
            let cancel = tunnel.lock().await.cancel.clone();
            let id_for_task = id.clone();
            let handle = tokio::spawn(async move {
                let result = run_local_forward(
                    &session,
                    listener,
                    remote_host,
                    remote_port,
                    &app_clone,
                    &id_for_task,
                    &cancel,
                )
                .await;
                if let Some(entry) = app_clone.state::<AppState>().tunnels.get(&id_for_task) {
                    let state = match result {
                        Ok(()) => TunnelState::Closed,
                        Err(e) => TunnelState::Error(format!("{e:#}")),
                    };
                    entry.set_state(&app_clone, state).await;
                }
            });

            state.tunnels.insert(
                id.clone(),
                TunnelEntry {
                    tunnel,
                    task_handle: Some(handle),
                },
            );
            Ok(id)
        }
        TunnelKind::Remote {
            bind_addr,
            bind_port,
            local_host,
            local_port,
        } => {
            // 远程转发只需向服务端注册;实际连接在 ClientHandler 回调中处理
            let guard = session.lock().await;
            let actual_port = guard
                .handle
                .tcpip_forward(bind_addr.clone(), bind_port as u32)
                .await
                .map_err(|e| format!("注册远程转发失败: {e}"))?;
            drop(guard);

            // 端口为 0 时返回服务端实际分配的端口
            if bind_port == 0 {
                let mut t = tunnel.lock().await;
                t.kind = TunnelKind::Remote {
                    bind_addr,
                    bind_port: actual_port as u16,
                    local_host,
                    local_port,
                };
            }

            state.tunnels.insert(
                id.clone(),
                TunnelEntry {
                    tunnel,
                    task_handle: None,
                },
            );
            Ok(id)
        }
    }
}

/// 停止并删除一条隧道
#[tauri::command]
pub async fn tunnel_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    tunnel_id: String,
) -> Result<(), String> {
    stop_tunnel(&app, &state, &tunnel_id)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 关闭某会话的所有隧道(在 ssh_disconnect 前调用)
pub async fn tunnel_close_session(app: &AppHandle, state: &AppState, session_id: &str) {
    let ids: Vec<TunnelId> = state
        .tunnels
        .iter()
        .filter(|e| e.tunnel.blocking_lock().session_id == session_id)
        .map(|e| e.key().clone())
        .collect();
    for id in ids {
        let _ = stop_tunnel(app, state, &id).await;
    }
}

// ============================================================
// 内部实现
// ============================================================

/// 本地转发监听循环
async fn run_local_forward(
    session: &Arc<Mutex<crate::ssh::SshSession>>,
    listener: TcpListener,
    remote_host: String,
    remote_port: u16,
    app: &AppHandle,
    tunnel_id: &str,
    cancel: &AtomicBool,
) -> Result<()> {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        let (stream, local_addr) = tokio::select! {
            biased;
            _ = wait_cancel(cancel) => return Ok(()),
            r = listener.accept() => r.context("监听 accept 失败")?,
        };

        let session = session.clone();
        let remote_host = remote_host.clone();
        let app_clone = app.clone();
        let tunnel_id = tunnel_id.to_string();
        tokio::spawn(async move {
            let guard = session.lock().await;
            let channel = match guard
                .handle
                .channel_open_direct_tcpip(
                    remote_host.clone(),
                    remote_port as u32,
                    local_addr.ip().to_string(),
                    local_addr.port() as u32,
                )
                .await
            {
                Ok(ch) => ch,
                Err(e) => {
                    let _ = app_clone.emit(
                        &format!("ssh://tunnel/{}/error", tunnel_id),
                        format!("打开直连通道失败: {e}"),
                    );
                    return;
                }
            };
            drop(guard);
            if let Err(e) = pipe_channel_stream(channel, stream).await {
                let _ = app_clone.emit(
                    &format!("ssh://tunnel/{}/error", tunnel_id),
                    format!("转发连接异常: {e}"),
                );
            }
        });
    }
}

/// 等待取消标志置位
async fn wait_cancel(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
}

/// 处理远程转发进来的连接。由 ClientHandler 回调调用。
/// 按 (connected_port, connected_address) 查找规则,连接本地目标后双向 pipe。
pub async fn handle_remote_forwarded_connection(
    app: AppHandle,
    state: &AppState,
    channel: Channel<Msg>,
    connected_address: &str,
    connected_port: u32,
) {
    let matched = find_remote_tunnel(state, connected_address, connected_port).await;
    let Some((local_host, local_port)) = matched else {
        let _ = channel.close().await;
        return;
    };

    let app_clone = app.clone();
    tokio::spawn(async move {
        let stream = match TcpStream::connect((local_host.as_str(), local_port)).await {
            Ok(s) => s,
            Err(e) => {
                let _ = app_clone.emit(
                    "ssh://tunnel/error",
                    format!("连接本地目标 {local_host}:{local_port} 失败: {e}"),
                );
                let _ = channel.close().await;
                return;
            }
        };
        if let Err(e) = pipe_channel_stream(channel, stream).await {
            let _ = app_clone.emit("ssh://tunnel/error", format!("远程转发连接异常: {e}"));
        }
    });
}

/// 查找与远程转发连接匹配的规则。
/// 先精确匹配 (bind_addr, bind_port),再按端口通配匹配 (0.0.0.0 / * 等)。
async fn find_remote_tunnel(
    state: &AppState,
    connected_address: &str,
    connected_port: u32,
) -> Option<(String, u16)> {
    let port = connected_port as u16;
    // 精确匹配
    for entry in state.tunnels.iter() {
        let t = entry.tunnel.lock().await;
        if let TunnelKind::Remote {
            bind_addr,
            bind_port,
            local_host,
            local_port,
        } = &t.kind
        {
            if *bind_port == port && addr_matches(bind_addr, connected_address) {
                return Some((local_host.clone(), *local_port));
            }
        }
    }
    // 端口通配匹配(常用于 bind_addr 为 0.0.0.0 或空)
    for entry in state.tunnels.iter() {
        let t = entry.tunnel.lock().await;
        if let TunnelKind::Remote {
            bind_port,
            local_host,
            local_port,
            ..
        } = &t.kind
        {
            if *bind_port == port {
                return Some((local_host.clone(), *local_port));
            }
        }
    }
    None
}

fn addr_matches(rule: &str, actual: &str) -> bool {
    let rule = rule.trim();
    let actual = actual.trim();
    rule == actual || rule == "*" || rule == "0.0.0.0" || rule.is_empty()
}

/// 停止一条隧道:置取消标志、取消远程转发、等待本地监听任务结束、从 state 移除。
async fn stop_tunnel(app: &AppHandle, state: &AppState, tunnel_id: &str) -> Result<()> {
    let Some((_, mut entry)) = state.tunnels.remove(tunnel_id) else {
        return Ok(());
    };

    {
        let t = entry.tunnel.lock().await;
        t.cancel.store(true, Ordering::Relaxed);
    }

    // 远程转发需要通知服务端取消监听
    {
        let t = entry.tunnel.lock().await;
        if let TunnelKind::Remote { bind_addr, bind_port, .. } = &t.kind {
            let session = state
                .sessions
                .get(&t.session_id)
                .context("会话已不存在")?
                .clone();
            let guard = session.lock().await;
            let _ = guard
                .handle
                .cancel_tcpip_forward(bind_addr.clone(), *bind_port as u32)
                .await;
        }
    }

    // 停止本地监听任务。用 take() 避免部分移动导致后续无法使用 entry
    let handle = entry.task_handle.take();
    if let Some(h) = handle {
        let _ = tokio::time::timeout(tokio::time::Duration::from_secs(2), h).await;
    }

    entry.set_state(app, TunnelState::Closed).await;
    Ok(())
}

/// 把 SSH Channel 与 TcpStream 双向 pipe。
/// 利用 Channel::into_stream() 转成 AsyncRead + AsyncWrite,再用 tokio::io::copy_bidirectional。
async fn pipe_channel_stream(channel: Channel<Msg>, stream: TcpStream) -> Result<()> {
    let mut local = stream;
    let mut remote = channel.into_stream();

    // copy_bidirectional 在任一端 EOF 时返回 Ok;结束后关闭两端。
    let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await?;
    // 确保发送 EOF,避免远端挂起
    let _ = local.shutdown().await;
    let _ = remote.shutdown().await;
    Ok(())
}
