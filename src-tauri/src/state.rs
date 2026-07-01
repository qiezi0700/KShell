use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::Mutex;

use crate::ssh::{ChannelHandle, SshSession};
use crate::store::Store;

pub type SessionId = String;
pub type ChannelId = String;

/// 全局运行时状态。
///
/// - `sessions` / `channels`:活跃 SSH 会话与 PTY 通道句柄
/// - `store`:持久化门面(会话/分组入 SQLite),None 表示尚未初始化(理论上不会发生)
pub struct AppState {
    pub sessions: DashMap<SessionId, Arc<Mutex<SshSession>>>,
    pub channels: DashMap<ChannelId, ChannelHandle>,
    pub store: std::sync::OnceLock<Store>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            channels: DashMap::new(),
            store: std::sync::OnceLock::new(),
        }
    }

    /// 返回已初始化的 Store 引用;未初始化则返回错误字符串。
    pub fn store(&self) -> Result<&Store, String> {
        self.store
            .get()
            .ok_or_else(|| "存储层尚未初始化".to_string())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
