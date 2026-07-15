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
use tokio::net::TcpStream;
use uuid::Uuid;

const USER_INTERACTION_TIMEOUT: Duration = Duration::from_secs(120);

use crate::ssh::known_hosts::HostCheckResult;
use crate::state::{AppState, HostConfirmResult};

/// 公钥校验未通过时的错误标识,前端据此抑制冗余错误提示(host-key 弹框已自解释)
pub const HOST_KEY_REJECTED: &str = "主机公钥校验未通过,连接已拒绝";
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 15_000;

pub struct SshSession {
    pub handle: Arc<Handle<ClientHandler>>,
    pub scheduler: Arc<super::scheduler::ChannelScheduler>,
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
    /// keyboard-interactive:由服务器下发 prompt,无持久凭据
    KeyboardInteractive,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JumpConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub auth: AuthMethod,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
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
    #[serde(default)]
    pub jump: Option<JumpConfig>,
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
    confirm_rx: Option<tokio::sync::oneshot::Receiver<HostConfirmResult>>,
    /// 公钥被拒绝(mismatch 或用户拒绝)时置 true,供 connect 函数返回中文错误
    rejected: Arc<AtomicBool>,
    interaction_timed_out: Arc<AtomicBool>,
}

impl ClientHandler {
    fn new(
        app: AppHandle,
        host: String,
        port: u16,
    ) -> (
        Self,
        tokio::sync::oneshot::Sender<HostConfirmResult>,
        String,
        Arc<AtomicBool>,
        Arc<AtomicBool>,
    ) {
        let confirm_id = Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();
        let rejected = Arc::new(AtomicBool::new(false));
        let interaction_timed_out = Arc::new(AtomicBool::new(false));
        let handler = Self {
            app,
            host,
            port,
            confirm_id: confirm_id.clone(),
            confirm_rx: Some(rx),
            rejected: rejected.clone(),
            interaction_timed_out: interaction_timed_out.clone(),
        };
        (handler, tx, confirm_id, rejected, interaction_timed_out)
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
        let interaction_timed_out = self.interaction_timed_out.clone();
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

                    let result = match rx {
                        Some(rx) => {
                            match tokio::time::timeout(USER_INTERACTION_TIMEOUT, rx).await {
                                Ok(Ok(result)) => result,
                                Ok(Err(_)) => HostConfirmResult {
                                    accepted: false,
                                    sync_to_system: false,
                                },
                                Err(_) => {
                                    interaction_timed_out.store(true, Ordering::Relaxed);
                                    HostConfirmResult {
                                        accepted: false,
                                        sync_to_system: false,
                                    }
                                }
                            }
                        }
                        None => HostConfirmResult {
                            accepted: false,
                            sync_to_system: false,
                        },
                    };

                    if !result.accepted {
                        rejected.store(true, Ordering::Relaxed);
                    }

                    if result.accepted {
                        let state = app.state::<AppState>();
                        let mut kh = state.known_hosts.write().await;
                        if let Err(e) = kh.trust_with_sync(
                            &host,
                            port,
                            server_public_key,
                            result.sync_to_system,
                        ) {
                            let _ = app.emit("ssh://host-key/error", e.to_string());
                        }
                    }
                    Ok(result.accepted)
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
        // russh 0.62 起新增 channel handle 参数,隧道转发靠 channel 即够用,此处忽略
        _handle: russh::client::ChannelOpenHandle,
        _session: &mut russh::client::Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let app = self.app.clone();
        let app_for_tunnel = app.clone();
        let connected_address = connected_address.to_string();
        async move {
            let state = app.state::<AppState>();
            crate::ssh::tunnel::handle_remote_forwarded_connection(
                app_for_tunnel,
                state.inner(),
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

    if let Some(jump) = cfg.jump.as_ref() {
        // ProxyJump:先以非递归方式连跳板机,再在其上开 direct-tcpip 通道
        let jump_cfg = SshConfig {
            host: jump.host.clone(),
            port: jump.port,
            user: jump.user.clone(),
            auth: jump.auth.clone(),
            timeout_ms: jump.timeout_ms,
            jump: None,
        };
        let jump_session = connect_no_jump(app.clone(), config.clone(), jump_cfg).await?;
        let channel = tokio::time::timeout(
            connect_timeout(cfg.timeout_ms),
            jump_session.handle.channel_open_direct_tcpip(
                &cfg.host,
                cfg.port as u32,
                "127.0.0.1",
                0,
            ),
        )
        .await
        .map_err(|_| anyhow!("通过跳板机连接 {}:{} 超时", cfg.host, cfg.port))?
        .context("在跳板机上建立到目标主机的隧道失败")?;
        let stream = channel.into_stream();
        connect_stream_target(
            app, config, &cfg.host, cfg.port, &cfg.user, &cfg.auth, stream,
        )
        .await
    } else {
        connect_no_jump(app, config, cfg).await
    }
}

/// 不含 ProxyJump 的直连逻辑,供 connect 复用以避免 async 递归。
async fn connect_no_jump(
    app: AppHandle,
    config: Arc<client::Config>,
    cfg: SshConfig,
) -> Result<SshSession> {
    connect_direct(
        app,
        config,
        &cfg.host,
        cfg.port,
        &cfg.user,
        &cfg.auth,
        cfg.timeout_ms,
    )
    .await
}

/// 直接 TCP 连接目标主机。
async fn connect_direct(
    app: AppHandle,
    config: Arc<client::Config>,
    host: &str,
    port: u16,
    user: &str,
    auth: &AuthMethod,
    timeout_ms: Option<u64>,
) -> Result<SshSession> {
    let stream = tokio::time::timeout(
        connect_timeout(timeout_ms),
        TcpStream::connect((host, port)),
    )
    .await
    .map_err(|_| anyhow!("连接 {host}:{port} 超时"))?
    .with_context(|| format!("连接 {host}:{port} 失败"))?;
    let _ = stream.set_nodelay(true);

    let (handler, confirm_tx, confirm_id, rejected, interaction_timed_out) =
        ClientHandler::new(app.clone(), host.to_string(), port);
    app.state::<AppState>()
        .pending_host_confirms
        .insert(confirm_id.clone(), confirm_tx);

    let result = client::connect_stream(config, stream, handler).await;

    app.state::<AppState>()
        .pending_host_confirms
        .remove(&confirm_id);

    finish_connect(
        result,
        rejected,
        interaction_timed_out,
        ConnectContext {
            app,
            host,
            port,
            user,
            auth,
        },
    )
    .await
}

fn connect_timeout(timeout_ms: Option<u64>) -> Duration {
    Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_CONNECT_TIMEOUT_MS)
            .clamp(1_000, 120_000),
    )
}

/// 在已有 IO 流上(ProxyJump 隧道)连接目标主机。
async fn connect_stream_target<S>(
    app: AppHandle,
    config: Arc<client::Config>,
    host: &str,
    port: u16,
    user: &str,
    auth: &AuthMethod,
    stream: S,
) -> Result<SshSession>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (handler, confirm_tx, confirm_id, rejected, interaction_timed_out) =
        ClientHandler::new(app.clone(), host.to_string(), port);
    app.state::<AppState>()
        .pending_host_confirms
        .insert(confirm_id.clone(), confirm_tx);

    let result = client::connect_stream(config, stream, handler).await;

    app.state::<AppState>()
        .pending_host_confirms
        .remove(&confirm_id);

    finish_connect(
        result,
        rejected,
        interaction_timed_out,
        ConnectContext {
            app,
            host,
            port,
            user,
            auth,
        },
    )
    .await
}

struct ConnectContext<'a> {
    app: AppHandle,
    host: &'a str,
    port: u16,
    user: &'a str,
    auth: &'a AuthMethod,
}

/// 连接结果到手后的共同处理:检查 known_hosts 拒绝、认证。
async fn finish_connect(
    connect_result: Result<Handle<ClientHandler>, russh::Error>,
    rejected: Arc<AtomicBool>,
    interaction_timed_out: Arc<AtomicBool>,
    context: ConnectContext<'_>,
) -> Result<SshSession> {
    let ConnectContext {
        app,
        host,
        port,
        user,
        auth,
    } = context;

    if interaction_timed_out.load(Ordering::Relaxed) {
        return Err(anyhow!("等待主机指纹确认超时,连接已取消"));
    }
    if rejected.load(Ordering::Relaxed) {
        return Err(anyhow!(HOST_KEY_REJECTED));
    }

    let mut handle = connect_result.with_context(|| format!("连接 {}:{} 失败", host, port))?;

    let authed = authenticate(app, &mut handle, user, auth).await?;

    if !authed {
        return Err(anyhow!("认证被拒绝"));
    }

    Ok(SshSession {
        handle: Arc::new(handle),
        scheduler: Arc::new(super::scheduler::ChannelScheduler::new()),
    })
}
async fn authenticate(
    app: AppHandle,
    handle: &mut Handle<ClientHandler>,
    user: &str,
    auth: &AuthMethod,
) -> Result<bool> {
    match auth {
        AuthMethod::Password { password } => Ok(handle
            .authenticate_password(user, password)
            .await
            .context("密码认证失败")?
            .success()),
        AuthMethod::PrivateKey { path, passphrase } => {
            let key = russh::keys::load_secret_key(path, passphrase.as_deref())
                .with_context(|| format!("加载私钥失败: {path}"))?;
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            Ok(handle
                .authenticate_publickey(user, key)
                .await
                .context("公钥认证失败")?
                .success())
        }
        AuthMethod::Agent => authenticate_via_agent(handle, user).await,
        AuthMethod::KeyboardInteractive => {
            authenticate_keyboard_interactive(app, handle, user).await
        }
    }
}

/// 依次尝试 SSH_AUTH_SOCK / OpenSSH 命名管道 / Pageant,拿到一个可用的 agent 客户端。
/// 全部失败时返回中文错误,引导用户启动 agent。
async fn connect_local_agent(
) -> Result<AgentClient<Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin>>> {
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

/// keyboard-interactive 认证。服务器可能连续下发多轮 prompt,每轮都通过
/// `ssh://ki-prompt/{id}` 事件抛给前端,并等待 `ssh_ki_respond` 回传答案。
async fn authenticate_keyboard_interactive(
    app: AppHandle,
    handle: &mut Handle<ClientHandler>,
    user: &str,
) -> Result<bool> {
    use russh::client::KeyboardInteractiveAuthResponse;

    let mut response = handle
        .authenticate_keyboard_interactive_start(user, None::<String>)
        .await
        .context("发起 keyboard-interactive 认证失败")?;

    loop {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                if prompts.is_empty() {
                    // 服务器可能发空请求继续流程,直接回空响应
                    response = handle
                        .authenticate_keyboard_interactive_respond(Vec::new())
                        .await
                        .context("keyboard-interactive 空响应失败")?;
                    continue;
                }

                let prompt_id = Uuid::new_v4().to_string();
                let (tx, rx) = tokio::sync::oneshot::channel::<Vec<String>>();
                app.state::<AppState>()
                    .pending_ki_prompts
                    .insert(prompt_id.clone(), tx);

                let payload = serde_json::json!({
                    "promptId": prompt_id,
                    "name": name,
                    "instructions": instructions,
                    "prompts": prompts.iter().map(|p| serde_json::json!({
                        "prompt": p.prompt,
                        "echo": p.echo,
                    })).collect::<Vec<_>>(),
                });
                let _ = app.emit("ssh://ki-prompt", payload);

                let answers = match tokio::time::timeout(USER_INTERACTION_TIMEOUT, rx).await {
                    Ok(Ok(v)) => v,
                    Ok(Err(_)) => {
                        app.state::<AppState>()
                            .pending_ki_prompts
                            .remove(&prompt_id);
                        return Err(anyhow!("keyboard-interactive 交互已取消"));
                    }
                    Err(_) => {
                        app.state::<AppState>()
                            .pending_ki_prompts
                            .remove(&prompt_id);
                        return Err(anyhow!("keyboard-interactive 等待用户输入超时"));
                    }
                };
                app.state::<AppState>()
                    .pending_ki_prompts
                    .remove(&prompt_id);

                if answers.len() != prompts.len() {
                    return Err(anyhow!("keyboard-interactive 答案数量与 prompt 不匹配"));
                }
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .context("keyboard-interactive 响应失败")?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::connect_timeout;

    #[test]
    fn connect_timeout_uses_default_and_bounds() {
        assert_eq!(connect_timeout(None), Duration::from_millis(15_000));
        assert_eq!(connect_timeout(Some(10)), Duration::from_millis(1_000));
        assert_eq!(
            connect_timeout(Some(300_000)),
            Duration::from_millis(120_000)
        );
    }
}
