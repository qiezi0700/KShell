//! 主机公钥信任库(known_hosts)。
//!
//! 应用自管,存 `app_data_dir/known_hosts.json`。不读写系统 `~/.ssh/known_hosts`。
//! 格式:`{ "host:port": { key, fingerprint, trustedAt } }`。

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use russh::keys::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostEntry {
    /// OpenSSH 格式公钥字符串,如 "ssh-ed25519 AAAAB3Nz..."
    pub key: String,
    /// SHA256 指纹,如 "SHA256:xxxxx",仅用于 UI 展示
    pub fingerprint: String,
    /// 信任时间,ISO8601
    pub trusted_at: String,
}

pub enum HostCheckResult {
    /// 公钥与已信任记录匹配
    Trusted,
    /// 首次连接,无记录
    New,
    /// 公钥与已信任记录不匹配(潜在中间人攻击)
    Mismatch { stored_fingerprint: String },
}

pub struct KnownHosts {
    path: PathBuf,
    entries: BTreeMap<String, HostEntry>,
}

impl KnownHosts {
    pub fn load(path: PathBuf) -> Result<Self> {
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("读取 known_hosts 失败: {}", path.display()))?;
            serde_json::from_str(&data).context("解析 known_hosts JSON 失败")?
        } else {
            BTreeMap::new()
        };
        Ok(Self { path, entries })
    }

    fn key_of(host: &str, port: u16) -> String {
        format!("{host}:{port}")
    }

    pub fn check(&self, host: &str, port: u16, pubkey: &PublicKey) -> HostCheckResult {
        let k = Self::key_of(host, port);
        match self.entries.get(&k) {
            None => HostCheckResult::New,
            Some(entry) if entry.key == pubkey.to_string() => HostCheckResult::Trusted,
            Some(entry) => HostCheckResult::Mismatch {
                stored_fingerprint: entry.fingerprint.clone(),
            },
        }
    }

    /// 信任该主机公钥并持久化。
    pub fn trust(&mut self, host: &str, port: u16, pubkey: &PublicKey) -> Result<()> {
        let k = Self::key_of(host, port);
        let fingerprint = pubkey.fingerprint(HashAlg::Sha256).to_string();
        self.entries.insert(
            k,
            HostEntry {
                key: pubkey.to_string(),
                fingerprint,
                trusted_at: chrono::Utc::now().to_rfc3339(),
            },
        );
        self.save()
    }

    /// 移除某主机的信任记录(用户发现 mismatch 后手动清除旧指纹用)。
    pub fn remove(&mut self, host: &str, port: u16) -> Result<()> {
        let k = Self::key_of(host, port);
        self.entries.remove(&k);
        self.save()
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建 known_hosts 目录失败: {}", parent.display()))?;
        }
        let data =
            serde_json::to_string_pretty(&self.entries).context("序列化 known_hosts 失败")?;
        std::fs::write(&self.path, data)
            .with_context(|| format!("写入 known_hosts 失败: {}", self.path.display()))?;
        Ok(())
    }
}
