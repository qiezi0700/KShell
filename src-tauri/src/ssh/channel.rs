use anyhow::Result;
use russh::client::Msg;
use russh::{Channel, ChannelMsg};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use crate::state::{ChannelId, SessionId};

pub enum ChannelCommand {
    Data(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct ChannelHandle {
    pub tx: UnboundedSender<ChannelCommand>,
    pub session_id: SessionId,
}

/// 事件驱动的 channel 循环:
/// - 从 SSH 收到数据 → emit 到前端
/// - 从前端(通过 rx)收到 stdin/resize → 写回 SSH
pub async fn run_channel(
    mut channel: Channel<Msg>,
    mut rx: UnboundedReceiver<ChannelCommand>,
    app: AppHandle,
    id: ChannelId,
) {
    let event_data = format!("ssh://{id}/data");
    let event_exit = format!("ssh://{id}/exit");
    let event_error = format!("ssh://{id}/error");

    loop {
        tokio::select! {
            biased;
            cmd = rx.recv() => {
                match cmd {
                    Some(ChannelCommand::Data(bytes)) => {
                        if let Err(e) = channel.data(&bytes[..]).await {
                            let _ = app.emit(&event_error, format!("write: {e}"));
                            break;
                        }
                    }
                    Some(ChannelCommand::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(ChannelCommand::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let _ = app.emit(&event_data, data.to_vec());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = app.emit(&event_data, data.to_vec());
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        let _ = app.emit(&event_exit, exit_status);
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        break;
                    }
                    Some(_) => {}
                    None => break,
                }
            }
        }
    }

    let _ = app.emit(&event_exit, serde_json::Value::Null);
}

/// 打开一个交互式 shell channel 并 spawn 事件循环任务。
pub async fn open_shell(
    session_handle: &mut russh::client::Handle<super::client::ClientHandler>,
    app: AppHandle,
    id: ChannelId,
    session_id: SessionId,
    cols: u32,
    rows: u32,
) -> Result<ChannelHandle> {
    let channel = session_handle.channel_open_session().await?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.request_shell(false).await?;

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(run_channel(channel, rx, app, id));

    Ok(ChannelHandle { tx, session_id })
}

/// 在 PTY 上执行指定命令(如 `docker exec -it <c> sh`),命令退出后 channel 自动收尾。
/// 与 open_shell 的区别:用 `channel.exec` 代替 `request_shell`,前端复用同一套数据事件。
pub async fn open_exec(
    session_handle: &mut russh::client::Handle<super::client::ClientHandler>,
    app: AppHandle,
    id: ChannelId,
    session_id: SessionId,
    command: String,
    cols: u32,
    rows: u32,
) -> Result<ChannelHandle> {
    let channel = session_handle.channel_open_session().await?;
    // PTY 必须先于 exec 申请,否则远端不会分配终端,-it 的 t 不生效
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.exec(true, command.as_bytes()).await?;

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(run_channel(channel, rx, app, id));

    Ok(ChannelHandle { tx, session_id })
}
