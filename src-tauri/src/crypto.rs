//! 凭据加密:KEK 存 OS keychain(Windows Credential Manager / macOS Keychain /
//! Linux Secret Service),DEK 用 AES-256-GCM。
//!
//! 威胁模型:防止数据库文件 + AppData 目录被整体拷走后泄露明文密码。
//! KEK 不落盘,换机器 / 换系统账号后自然无法解密,符合"机器绑定"预期。
//!
//! 老版本兼容:首次启动时若 keychain 为空且存在 key.bin,自动迁移到 keychain
//! 并将 key.bin 重命名为 key.bin.migrated(下一版删除迁移逻辑时一并清理)。
//!
//! 降级:keychain 访问失败(如 Linux 无 Secret Service 常驻)时回落到 key.bin,
//! 保证应用仍可启动,只是安全性等同旧版。
//!
//! 存储格式:base64( nonce(12B) || ciphertext )

use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use keyring::Entry;
use rand::Rng;

/// OS keychain 里的 service / account 命名。改动会导致所有用户丢失现有凭据,慎改。
const KEYRING_SERVICE: &str = "com.kshell.credentials";
const KEYRING_ACCOUNT: &str = "master-key";

/// 32 字节 AES-256 key
pub struct CryptoKey(Box<[u8; 32]>);

impl CryptoKey {
    /// 按 keychain → key.bin 迁移 → 新建 的顺序加载 KEK。
    /// `legacy_path` 是老版本的 key.bin 位置,用于一次性迁移和降级回落。
    pub fn load_or_create(legacy_path: PathBuf) -> Result<Self> {
        match load_from_keychain() {
            Ok(Some(key)) => Ok(Self(key)),
            Ok(None) => {
                // keychain 为空:优先迁移 key.bin,否则新建
                if legacy_path.exists() {
                    let key = read_key_file(&legacy_path)?;
                    if let Err(e) = save_to_keychain(&key) {
                        // 写 keychain 失败:回落到 key.bin,保留原文件
                        tracing::warn!(error = %e, "写入 keychain 失败,继续沿用 key.bin");
                        return Ok(Self(key));
                    }
                    // 迁移成功:重命名旧文件作为回退凭证
                    let migrated = legacy_path.with_extension("bin.migrated");
                    if let Err(e) = std::fs::rename(&legacy_path, &migrated) {
                        tracing::warn!(error = %e, "重命名 key.bin 为 .migrated 失败,不影响运行");
                    }
                    Ok(Self(key))
                } else {
                    let key = generate_key();
                    if let Err(e) = save_to_keychain(&key) {
                        // keychain 不可用:降级写 key.bin
                        tracing::warn!(error = %e, "写入 keychain 失败,降级写入 key.bin");
                        write_key_file(&legacy_path, &key)?;
                    }
                    Ok(Self(key))
                }
            }
            Err(e) => {
                // keychain 读失败(如 Linux 无 Secret Service):走老路径
                tracing::warn!(error = %e, "读取 keychain 失败,降级使用 key.bin");
                let key = if legacy_path.exists() {
                    read_key_file(&legacy_path)?
                } else {
                    let k = generate_key();
                    write_key_file(&legacy_path, &k)?;
                    k
                };
                Ok(Self(key))
            }
        }
    }

    /// 加密明文,返回 base64 字符串。空串返回 None。
    pub fn encrypt(&self, plain: &str) -> Result<Option<String>> {
        if plain.is_empty() {
            return Ok(None);
        }
        let key = Key::<Aes256Gcm>::from_slice(&*self.0);
        let cipher = Aes256Gcm::new(key);

        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ct = cipher
            .encrypt(nonce, plain.as_bytes())
            .map_err(|_| anyhow::anyhow!("AES 加密失败"))?;
        let mut out = Vec::with_capacity(12 + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(Some(B64.encode(out)))
    }

    /// 解密 base64 字符串,返回明文。None 表示无密文。
    pub fn decrypt(&self, stored: Option<&str>) -> Result<Option<String>> {
        let s = match stored {
            None | Some("") => return Ok(None),
            Some(s) => s,
        };
        let raw = B64.decode(s).context("解密失败:base64 解码错误")?;
        if raw.len() < 12 {
            anyhow::bail!("解密失败:密文过短");
        }
        let (nonce_bytes, ct) = raw.split_at(12);
        let key = Key::<Aes256Gcm>::from_slice(&*self.0);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(nonce_bytes);
        let pt = cipher
            .decrypt(nonce, ct)
            .map_err(|_| anyhow::anyhow!("解密失败:KEK 已变更或数据损坏"))?;
        Ok(Some(
            String::from_utf8(pt).context("解密后 UTF-8 转换失败")?,
        ))
    }
}

fn generate_key() -> Box<[u8; 32]> {
    let mut key = Box::new([0u8; 32]);
    rand::rng().fill_bytes(&mut *key);
    key
}

/// 尝试从 keychain 读 KEK。返回 Ok(None) 表示 keychain 可用但没有条目;
/// Err 表示 keychain 本身访问失败(需要降级)。
fn load_from_keychain() -> Result<Option<Box<[u8; 32]>>> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).context("初始化 keyring entry 失败")?;
    match entry.get_password() {
        Ok(s) => {
            let raw = B64.decode(s.trim()).context("keychain 中 KEK 解码失败")?;
            if raw.len() != 32 {
                anyhow::bail!("keychain 中 KEK 长度异常: {} (应为 32)", raw.len());
            }
            let mut key = Box::new([0u8; 32]);
            key.copy_from_slice(&raw);
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow::anyhow!(e).context("读取 keychain 失败")),
    }
}

fn save_to_keychain(key: &[u8; 32]) -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).context("初始化 keyring entry 失败")?;
    entry
        .set_password(&B64.encode(key))
        .map_err(|e| anyhow::anyhow!(e).context("写入 keychain 失败"))
}

fn read_key_file(path: &Path) -> Result<Box<[u8; 32]>> {
    let data = std::fs::read_to_string(path)
        .with_context(|| format!("读取 key 文件失败: {}", path.display()))?;
    let raw = B64
        .decode(data.trim())
        .context("解析 key 文件失败,可能已损坏")?;
    if raw.len() != 32 {
        anyhow::bail!("key 文件长度异常: {} (应为 32)", raw.len());
    }
    let mut key = Box::new([0u8; 32]);
    key.copy_from_slice(&raw);
    Ok(key)
}

fn write_key_file(path: &Path, key: &[u8; 32]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("创建 key 目录失败: {}", parent.display()))?;
    }
    std::fs::write(path, B64.encode(key))
        .with_context(|| format!("写入 key 文件失败: {}", path.display()))
}
