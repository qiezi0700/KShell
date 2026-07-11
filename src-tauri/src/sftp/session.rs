//! SFTP 会话管理。

use std::sync::Arc;

use anyhow::{Context, Result};
use russh_sftp::client::SftpSession;

use crate::state::SessionId;

/// 一个 SFTP 会话句柄。持有 russh_sftp 的高级会话对象。
/// 用 Arc<Mutex> 包裹因为 SftpSession 的方法都是 &self,但跨 await 需要Sync。
pub struct SftpHandle {
    pub session: Arc<SftpSession>,
    /// 关联的 SSH 会话 id,用于断开 SSH 时批量清理 SFTP 子会话。
    pub ssh_session_id: SessionId,
}

/// 在已有 SSH 会话上打开 SFTP subsystem channel 并初始化 SftpSession。
pub async fn open_sftp(
    ssh_handle: &russh::client::Handle<crate::ssh::client::ClientHandler>,
    ssh_session_id: SessionId,
) -> Result<SftpHandle> {
    let channel = ssh_handle
        .channel_open_session()
        .await
        .context("打开 SFTP channel 失败")?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .context("请求 SFTP subsystem 失败")?;

    // russh 的 Channel<Msg> 实现了 AsyncRead + AsyncWrite,可直接喂给 SftpSession
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .context("初始化 SFTP 会话失败")?;

    Ok(SftpHandle {
        session: Arc::new(sftp),
        ssh_session_id,
    })
}
