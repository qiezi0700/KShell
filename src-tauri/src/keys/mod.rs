//! SSH 密钥库:生成密钥对、导入密钥、部署公钥到远端服务器。
//!
//! 密钥文件存储在 app_data_dir/keys/{id}.pem,元数据(名称/算法/指纹)入 SQLite。
//! passphrase 可选,加密后存 ssh_keys.passphrase_encrypted(复用机器绑定 AES-256-GCM)。
//!
//! 密钥生成依赖 ssh_key crate(经 russh::keys re-export),支持 ED25519 / RSA / ECDSA。
//! 部署公钥复用已有 SSH 会话的 ssh_exec,把公钥追加到远端 ~/.ssh/authorized_keys。

pub mod commands;
pub mod deploy;
pub mod gen;

pub use commands::*;
