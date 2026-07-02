//! 机器绑定加密:用 app_data_dir 下的随机 key 文件做 AES-256-GCM。
//!
//! 威胁模型:防止数据库文件被单独复制后泄露明文密码。
//! key 文件不在数据库,换电脑/重装系统后无法解密,需重新输入凭据。
//!
//! 存储格式:base64( nonce(12B) || ciphertext )

use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;

/// 32 字节 AES-256 key
pub struct CryptoKey(Box<[u8; 32]>);

impl CryptoKey {
    pub fn load_or_create(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建 key 目录失败: {}", parent.display()))?;
        }
        if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("读取 key 文件失败: {}", path.display()))?;
            let raw = B64
                .decode(data.trim())
                .context("解析 key 文件失败,可能已损坏")?;
            if raw.len() != 32 {
                anyhow::bail!("key 文件长度异常: {} (应为 32)", raw.len());
            }
            let mut key = Box::new([0u8; 32]);
            key.copy_from_slice(&raw);
            return Ok(Self(key));
        }
        // 首次生成
        let mut key = Box::new([0u8; 32]);
        rand::rng().fill_bytes(&mut *key);
        std::fs::write(&path, B64.encode(*key))
            .with_context(|| format!("写入 key 文件失败: {}", path.display()))?;
        Ok(Self(key))
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
            .map_err(|_| anyhow::anyhow!("解密失败:可能 key 文件已变更或数据损坏"))?;
        Ok(Some(
            String::from_utf8(pt).context("解密后 UTF-8 转换失败")?,
        ))
    }
}
