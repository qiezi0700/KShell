use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use russh::client::{Handle, Msg};
use russh::{Channel, ChannelOpenFailure};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use super::client::ClientHandler;

const EXEC_CONCURRENCY: usize = 2;
const CHANNEL_OPEN_RETRY_DELAYS_MS: [u64; 4] = [120, 300, 700, 1_500];

/// 单个 SSH 会话的 channel 调度器。
///
/// exec 命令限制并发，避免 Docker 轮询挤占监控与 SFTP；所有 channel 的创建
/// 统一串行化，兼容对并发 channel-open 支持不完整的 SSH 服务端。
pub struct ChannelScheduler {
    open_lock: Mutex<()>,
    exec_slots: Arc<Semaphore>,
}

pub struct ExecChannelLease {
    pub channel: Channel<Msg>,
    _permit: OwnedSemaphorePermit,
}

impl ChannelScheduler {
    pub fn new() -> Self {
        Self {
            open_lock: Mutex::new(()),
            exec_slots: Arc::new(Semaphore::new(EXEC_CONCURRENCY)),
        }
    }

    pub async fn open_interactive(&self, handle: &Handle<ClientHandler>) -> Result<Channel<Msg>> {
        let _open_guard = self.open_lock.lock().await;
        open_with_backpressure(handle).await
    }

    pub async fn open_exec(&self, handle: &Handle<ClientHandler>) -> Result<ExecChannelLease> {
        let permit = self
            .exec_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| anyhow!("SSH exec 调度器已关闭"))?;
        let channel = self.open_interactive(handle).await?;
        Ok(ExecChannelLease {
            channel,
            _permit: permit,
        })
    }
}

fn is_capacity_error(error: &russh::Error) -> bool {
    matches!(
        error,
        russh::Error::ChannelOpenFailure(
            ChannelOpenFailure::ResourceShortage | ChannelOpenFailure::AdministrativelyProhibited
        )
    )
}

async fn open_with_backpressure(handle: &Handle<ClientHandler>) -> Result<Channel<Msg>> {
    for (attempt, delay_ms) in CHANNEL_OPEN_RETRY_DELAYS_MS.iter().enumerate() {
        match handle.channel_open_session().await {
            Ok(channel) => return Ok(channel),
            Err(error) if is_capacity_error(&error) => {
                if attempt + 1 == CHANNEL_OPEN_RETRY_DELAYS_MS.len() {
                    return Err(error.into());
                }
                tokio::time::sleep(Duration::from_millis(*delay_ms)).await;
            }
            Err(error) => return Err(error.into()),
        }
    }
    unreachable!("channel 调度至少执行一次")
}

#[cfg(test)]
mod tests {
    use super::is_capacity_error;
    use russh::ChannelOpenFailure;

    #[test]
    fn capacity_errors_are_retryable() {
        assert!(is_capacity_error(&russh::Error::ChannelOpenFailure(
            ChannelOpenFailure::ResourceShortage,
        )));
        assert!(is_capacity_error(&russh::Error::ChannelOpenFailure(
            ChannelOpenFailure::AdministrativelyProhibited,
        )));
    }

    #[test]
    fn protocol_errors_are_not_retryable() {
        assert!(!is_capacity_error(&russh::Error::ChannelOpenFailure(
            ChannelOpenFailure::UnknownChannelType,
        )));
        assert!(!is_capacity_error(&russh::Error::Disconnect));
    }
}
