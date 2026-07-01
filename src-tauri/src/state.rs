use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::{Mutex, RwLock};

use crate::crypto::CryptoKey;
use crate::sftp::SftpHandle;
use crate::ssh::known_hosts::KnownHosts;
use crate::ssh::{ChannelHandle, SshSession};
use crate::store::Store;

pub type SessionId = String;
pub type ChannelId = String;

/// 全局运行时状态。
///
/// - `sessions` / `channels`:活跃 SSH 会话与 PTY 通道句柄
/// - `store`:持久化门面(会话/分组入 SQLite),None 表示尚未初始化(理论上不会发生)
/// - `known_hosts`:主机公钥信任库
/// - `pending_host_confirms`:check_server_key 等待用户确认首次连接的 oneshot 发送端
/// - `crypto`:凭据加密用的机器绑定 key
/// - `sftp_sessions`:SFTP 会话池,复用 SSH 连接
/// - `transfer_cancels`:进行中的传输任务对应的取消标志(前端调 sftp_cancel_transfer 时置位)
pub struct AppState {
    pub sessions: DashMap<SessionId, Arc<Mutex<SshSession>>>,
    pub channels: DashMap<ChannelId, ChannelHandle>,
    pub store: std::sync::OnceLock<Store>,
    pub known_hosts: Arc<RwLock<KnownHosts>>,
    pub pending_host_confirms: DashMap<String, tokio::sync::oneshot::Sender<bool>>,
    pub crypto: CryptoKey,
    pub sftp_sessions: DashMap<String, SftpHandle>,
    pub transfer_cancels: DashMap<String, Arc<AtomicBool>>,
}

impl AppState {
    pub fn new(known_hosts: KnownHosts, crypto: CryptoKey) -> Self {
        Self {
            sessions: DashMap::new(),
            channels: DashMap::new(),
            store: std::sync::OnceLock::new(),
            known_hosts: Arc::new(RwLock::new(known_hosts)),
            pending_host_confirms: DashMap::new(),
            crypto,
            sftp_sessions: DashMap::new(),
            transfer_cancels: DashMap::new(),
        }
    }

    /// 返回已初始化的 Store 引用;未初始化则返回错误字符串。
    pub fn store(&self) -> Result<&Store, String> {
        self.store
            .get()
            .ok_or_else(|| "存储层尚未初始化".to_string())
    }
}
