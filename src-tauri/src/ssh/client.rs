use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use russh::client::{self, Handle};
use russh::keys::{PrivateKeyWithHashAlg, PublicKey};
use serde::{Deserialize, Serialize};

pub struct SshSession {
    pub handle: Handle<ClientHandler>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthMethod {
    Password { password: String },
    PrivateKey { path: String, passphrase: Option<String> },
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

fn default_port() -> u16 { 22 }

pub struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    // MVP: 接受所有服务器公钥。后续接 known_hosts 校验。
    fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        async move { Ok(true) }
    }
}

pub async fn connect(cfg: SshConfig) -> Result<SshSession> {
    let mut config = client::Config::default();
    config.inactivity_timeout = Some(Duration::from_secs(60 * 30));
    let config = Arc::new(config);

    let addr = (cfg.host.as_str(), cfg.port);
    let mut handle = client::connect(config, addr, ClientHandler)
        .await
        .with_context(|| format!("连接 {}:{} 失败", cfg.host, cfg.port))?;

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
    };

    if !authed {
        return Err(anyhow!("认证被拒绝"));
    }

    Ok(SshSession { handle })
}
