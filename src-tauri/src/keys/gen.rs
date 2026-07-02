//! 密钥对生成与序列化。
//!
//! 直接依赖 ssh-key crate(与 russh 0.61 同版本),用 rand 0.10 的 ThreadRng 做 RNG。
//! ssh-key 0.7 的 Algorithm::Rsa 没有 bits 字段(固定 4096),
//! 要支持自定义 bits 需用 RsaKeypair::random(rng, bits) 再转为 PrivateKey。

use std::path::Path;

use anyhow::{Context, Result};
// 重命名 ssh_key 的 EcdsaCurve 避免和本地定义冲突
use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey};
use ssh_key::EcdsaCurve as SshEcdsaCurve;

/// 前端传入的密钥算法选择
#[derive(Clone, Copy, Debug)]
pub enum GenAlgorithm {
    Ed25519,
    Rsa { bits: u32 },
    Ecdsa { curve: EcdsaCurve },
}

#[derive(Clone, Copy, Debug)]
pub enum EcdsaCurve {
    P256,
    P384,
    P521,
}

fn to_ssh_curve(c: EcdsaCurve) -> SshEcdsaCurve {
    match c {
        EcdsaCurve::P256 => SshEcdsaCurve::NistP256,
        EcdsaCurve::P384 => SshEcdsaCurve::NistP384,
        EcdsaCurve::P521 => SshEcdsaCurve::NistP521,
    }
}

impl GenAlgorithm {
    /// 返回用于存储和前端的简短标识
    pub fn as_str(self) -> &'static str {
        match self {
            GenAlgorithm::Ed25519 => "ed25519",
            GenAlgorithm::Rsa { bits } => match bits {
                2048 => "rsa-2048",
                3072 => "rsa-3072",
                4096 => "rsa-4096",
                _ => "rsa",
            },
            GenAlgorithm::Ecdsa { curve } => match curve {
                EcdsaCurve::P256 => "ecdsa-p256",
                EcdsaCurve::P384 => "ecdsa-p384",
                EcdsaCurve::P521 => "ecdsa-p521",
            },
        }
    }
}

/// 解析前端传入的算法字符串
pub fn parse_algorithm(s: &str) -> Result<GenAlgorithm> {
    match s {
        "ed25519" => Ok(GenAlgorithm::Ed25519),
        "rsa-2048" => Ok(GenAlgorithm::Rsa { bits: 2048 }),
        "rsa-3072" => Ok(GenAlgorithm::Rsa { bits: 3072 }),
        "rsa-4096" => Ok(GenAlgorithm::Rsa { bits: 4096 }),
        "ecdsa-p256" => Ok(GenAlgorithm::Ecdsa { curve: EcdsaCurve::P256 }),
        "ecdsa-p384" => Ok(GenAlgorithm::Ecdsa { curve: EcdsaCurve::P384 }),
        "ecdsa-p521" => Ok(GenAlgorithm::Ecdsa { curve: EcdsaCurve::P521 }),
        other => anyhow::bail!("不支持的密钥算法: {other}"),
    }
}

/// 生成密钥对并序列化为 OpenSSH PEM 写入指定路径。
/// 返回 (算法标识, SHA256 指纹, OpenSSH 公钥字符串)。
pub fn generate_keypair(
    algo: GenAlgorithm,
    path: &Path,
    comment: &str,
) -> Result<(String, String, String)> {
    let mut rng = rand::rng();
    let key = match algo {
        GenAlgorithm::Ed25519 => {
            PrivateKey::random(&mut rng, Algorithm::Ed25519)
                .map_err(|e| anyhow::anyhow!("生成 Ed25519 密钥失败: {e}"))?
        }
        GenAlgorithm::Ecdsa { curve } => {
            PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve: to_ssh_curve(curve) })
                .map_err(|e| anyhow::anyhow!("生成 ECDSA 密钥失败: {e}"))?
        }
        GenAlgorithm::Rsa { bits } => {
            // ssh-key 0.7 的 Algorithm::Rsa 不含 bits,需直接用 RsaKeypair 指定
            use ssh_key::private::RsaKeypair;
            let kp = RsaKeypair::random(&mut rng, bits as usize)
                .map_err(|e| anyhow::anyhow!("生成 RSA-{bits} 密钥失败: {e}"))?;
            PrivateKey::from(kp)
        }
    };

    // 序列化为 OpenSSH 格式写入文件
    let pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| anyhow::anyhow!("序列化私钥失败: {e}"))?;
    std::fs::write(path, pem.as_bytes())
        .with_context(|| format!("写入密钥文件失败: {}", path.display()))?;

    // 指纹
    let pubkey = key.public_key();
    let fingerprint = pubkey.fingerprint(HashAlg::Sha256).to_string();

    // OpenSSH 公钥字符串(可直接追加到 authorized_keys)
    let pubkey_openssh = pubkey
        .to_openssh()
        .map_err(|e| anyhow::anyhow!("序列化公钥失败: {e}"))?
        .trim()
        .to_string()
        + " "
        + comment;

    Ok((algo.as_str().to_string(), fingerprint, pubkey_openssh))
}

/// 从已有私钥文件加载,返回 (算法标识, SHA256 指纹, OpenSSH 公钥字符串)。
/// 用于导入外部密钥文件时提取元数据。
pub fn inspect_key(
    path: &str,
    passphrase: Option<&str>,
) -> Result<(String, String, String)> {
    let key = russh::keys::load_secret_key(path, passphrase)
        .map_err(|e| anyhow::anyhow!("加载私钥失败: {e}"))?;

    let pubkey = key.public_key();
    let fingerprint = pubkey.fingerprint(HashAlg::Sha256).to_string();

    let algo_str = match key.algorithm() {
        Algorithm::Ed25519 => "ed25519".to_string(),
        Algorithm::Rsa { .. } => "rsa".to_string(),
        Algorithm::Ecdsa { curve } => match curve {
            SshEcdsaCurve::NistP256 => "ecdsa-p256".to_string(),
            SshEcdsaCurve::NistP384 => "ecdsa-p384".to_string(),
            SshEcdsaCurve::NistP521 => "ecdsa-p521".to_string(),
        },
        other => format!("{other}"),
    };

    let pubkey_openssh = pubkey
        .to_openssh()
        .map_err(|e| anyhow::anyhow!("序列化公钥失败: {e}"))?
        .trim()
        .to_string();

    Ok((algo_str, fingerprint, pubkey_openssh))
}
