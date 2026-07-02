use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use russh::client::{self, Handle, Msg};
use russh::keys::agent::client::AgentClient;
use russh::keys::agent::AgentIdentity;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::ssh::known_hosts::HostCheckResult;
use crate::state::AppState;

/// 公钥校验未通过时的错误标识,前端据此抑制冗余错误提示(host-key 弹框已自解释)
pub const HOST_KEY_REJECTED: &str = "主机公钥校验未通过,连接已拒绝";

pub struct SshSession {
    pub handle: Handle<ClientHandler>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMethod {
    Password {
        password: String,
    },
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
    /// 走本机 SSH agent,由 agent 保管所有私钥;无字段
    Agent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_port() -> u16 {
    22
}

/// SSH 客户端回调处理器。持有 AppHandle 以便在 check_server_key 中
/// 查询 known_hosts、向前端 emit 确认请求并等待用户响应。
pub struct ClientHandler {
    app: AppHandle,
    host: String,
    port: u16,
    confirm_id: String,
    /// 前端确认后通过 ssh_confirm_host 命令把结果发到这个 oneshot
    confirm_rx: Option<tokio::sync::oneshot::Receiver<bool>>,
    /// 公钥被拒绝(mismatch 或用户拒绝)时置 true,供 connect 函数返回中文错误
    rejected: Arc<AtomicBool>,
}

impl ClientHandler {
    fn new(
        app: AppHandle,
        host: String,
        port: u16,
    ) -> (
        Self,
        tokio::sync::oneshot::Sender<bool>,
        String,
        Arc<AtomicBool>,
    ) {
        let confirm_id = Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        let rejected = Arc::new(AtomicBool::new(false));
        let handler = Self {
            app,
            host,
            port,
            confirm_id: confirm_id.clone(),
            confirm_rx: Some(rx),
            rejected: rejected.clone(),
        };
        (handler, tx, confirm_id, rejected)
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    // russh 0.52 起 Handler trait 改用 impl Future,不能再用 async_trait 宏
    #[allow(clippy::manual_async_fn)]
    fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> {
        let app = self.app.clone();
        let host = self.host.clone();
        let port = self.port;
        let confirm_id = self.confirm_id.clone();
        let rejected = self.rejected.clone();
        let rx = self.confirm_rx.take();

        async move {
            // 先取读锁查 known_hosts,查完立即释放以便后续可取写锁
            let result = {
                let state = app.state::<AppState>();
                let kh = state.known_hosts.read().await;
                kh.check(&host, port, server_public_key)
            };

            match result {
                HostCheckResult::Trusted => Ok(true),

                HostCheckResult::Mismatch { stored_fingerprint } => {
                    // 公钥不匹配:直接拒绝,不允许用户覆盖
                    rejected.store(true, Ordering::Relaxed);
                    let actual_fp = server_public_key.fingerprint(HashAlg::Sha256).to_string();
                    let _ = app.emit(
                        "ssh://host-key/mismatch",
                        serde_json::json!({
                            "host": host,
                            "port": port,
                            "expectedFingerprint": stored_fingerprint,
                            "actualFingerprint": actual_fp,
                        }),
                    );
                    Ok(false)
                }

                HostCheckResult::New => {
                    // 首次连接:emit 确认请求,等待前端 ssh_confirm_host 回传
                    let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
                    let key_type = server_public_key.algorithm().as_str().to_string();
                    let _ = app.emit(
                        "ssh://host-key/confirm",
                        serde_json::json!({
                            "confirmId": confirm_id,
                            "host": host,
                            "port": port,
                            "fingerprint": fingerprint,
                            "keyType": key_type,
                        }),
                    );

                    let accepted = match rx {
                        Some(rx) => rx.await.unwrap_or(false),
                        None => false,
                    };

                    if !accepted {
                        rejected.store(true, Ordering::Relaxed);
                    }

                    if accepted {
                        let state = app.state::<AppState>();
                        let mut kh = state.known_hosts.write().await;
                        if let Err(e) = kh.trust(&host, port, server_public_key) {
                            let _ = app.emit("ssh://host-key/error", e.to_string());
                        }
                    }
                    Ok(accepted)
                }
            }
        }
    }

    /// 远程端口转发:服务端收到外部连接后开 channel 回调到这里。
    /// 按 (connected_address, connected_port) 路由到对应规则并连接本地目标。
    #[allow(clippy::manual_async_fn)]
    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut russh::client::Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let app = self.app.clone();
        let app_for_tunnel = app.clone();
        let connected_address = connected_address.to_string();
        async move {
            let state = app.state::<AppState>();
            crate::ssh::tunnel::handle_remote_forwarded_connection(
                app_for_tunnel,
                &*state,
                channel,
                &connected_address,
                connected_port,
            )
            .await;
            Ok(())
        }
    }
}

pub async fn connect(app: AppHandle, cfg: SshConfig) -> Result<SshSession> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60 * 30)),
        ..Default::default()
    });

    let addr = (cfg.host.as_str(), cfg.port);

    // 创建 oneshot 通道,tx 存入 AppState 供前端 ssh_confirm_host 取用
    let (handler, confirm_tx, confirm_id, rejected) =
        ClientHandler::new(app.clone(), cfg.host.clone(), cfg.port);
    app.state::<AppState>()
        .pending_host_confirms
        .insert(confirm_id.clone(), confirm_tx);

    let connect_result = client::connect(config, addr, handler).await;

    // 连接握手完成(或因公钥拒绝而提前返回)后清理 pending
    app.state::<AppState>()
        .pending_host_confirms
        .remove(&confirm_id);

    // 公钥校验未通过:返回中文错误,前端据此抑制冗余提示
    if rejected.load(Ordering::Relaxed) {
        return Err(anyhow!(HOST_KEY_REJECTED));
    }

    let mut handle =
        connect_result.with_context(|| format!("连接 {}:{} 失败", cfg.host, cfg.port))?;

    let authed = match &cfg.auth {
        AuthMethod::Password { password } => handle
            .authenticate_password(&cfg.user, password)
            .await
            .context("密码认证失败")?
            .success(),
        AuthMethod::PrivateKey { path, passphrase } => {
            let key = russh::keys::load_secret_key(path, passphrase.as_deref())
                .with_context(|| format!("加载私钥失败: {path}"))?;
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            handle
                .authenticate_publickey(&cfg.user, key)
                .await
                .context("公钥认证失败")?
                .success()
        }
        AuthMethod::Agent => authenticate_via_agent(&mut handle, &cfg.user).await?,
    };

    if !authed {
        return Err(anyhow!("认证被拒绝"));
    }

    Ok(SshSession { handle })
}

/// 依次尝试 SSH_AUTH_SOCK / OpenSSH 命名管道 / Pageant,拿到一个可用的 agent 客户端。
/// 全部失败时返回中文错误,引导用户启动 agent。
async fn connect_local_agent() -> Result<AgentClient<Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin>>>
{
    #[cfg(unix)]
    {
        AgentClient::connect_env()
            .await
            .map(|c| c.dynamic())
            .map_err(|e| anyhow!("SSH agent 未运行或 SSH_AUTH_SOCK 未设置: {e}"))
    }
    #[cfg(windows)]
    {
        // Windows OpenSSH 默认命名管道;russh 在 Windows 上不提供 connect_env
        const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

        if let Ok(c) = AgentClient::connect_named_pipe(OPENSSH_PIPE).await {
            return Ok(c.dynamic());
        }
        if let Ok(c) = AgentClient::connect_pageant().await {
            return Ok(c.dynamic());
        }
        Err(anyhow!(
            "未检测到可用的 SSH agent(OpenSSH agent / Pageant 均未运行)"
        ))
    }
}

/// 从 agent 拉取所有身份并逐个尝试公钥认证。返回是否有任一密钥认证成功。
async fn authenticate_via_agent(handle: &mut Handle<ClientHandler>, user: &str) -> Result<bool> {
    let mut agent = connect_local_agent().await?;
    let identities = agent
        .request_identities()
        .await
        .context("向 SSH agent 请求密钥列表失败")?;

    if identities.is_empty() {
        return Err(anyhow!("SSH agent 中没有可用密钥,请先 ssh-add"));
    }

    for id in identities {
        // 仅处理普通公钥,证书类身份暂不支持
        let AgentIdentity::PublicKey { key, .. } = id else {
            continue;
        };
        // RSA 必须显式指定 Sha256,否则走遗留 ssh-rsa(SHA1),多数现代服务器已拒绝
        let hash_alg = if key.algorithm().as_str() == "ssh-rsa" {
            Some(HashAlg::Sha256)
        } else {
            None
        };
        let res = handle
            .authenticate_publickey_with(user, key, hash_alg, &mut agent)
            .await
            .context("agent 公钥认证过程失败")?;
        if res.success() {
            return Ok(true);
        }
    }
    Ok(false)
}
