//! store 层的数据结构。与前端 TypeScript 类型一一对应。

use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// 认证方式枚举。与前端 AuthMethod.kind 对齐(snake_case)。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    Password,
    PrivateKey,
    /// 走本机 SSH agent(OpenSSH agent / Pageant),不落任何凭据
    Agent,
    /// keyboard-interactive:连接时由服务器动态下发 prompt,不落凭据
    KeyboardInteractive,
}

impl AuthKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthKind::Password => "password",
            AuthKind::PrivateKey => "private_key",
            AuthKind::Agent => "agent",
            AuthKind::KeyboardInteractive => "keyboard_interactive",
        }
    }
    pub fn parse(s: &str) -> anyhow::Result<Self> {
        match s {
            "password" => Ok(AuthKind::Password),
            "private_key" => Ok(AuthKind::PrivateKey),
            "agent" => Ok(AuthKind::Agent),
            "keyboard_interactive" => Ok(AuthKind::KeyboardInteractive),
            other => anyhow::bail!("未知认证方式: {other}"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// 空串代表"待插入",upsert 时后端补 uuid。
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

impl Group {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub group_id: Option<String>,
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: i64,
    pub username: String,
    pub auth_kind: AuthKind,
    /// 仅私钥认证时使用(key_path 本身不敏感,存 SQLite)
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub sort: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    // ProxyJump 配置(凭据不存库,连接时按需输入)
    #[serde(default)]
    pub jump_host: Option<String>,
    #[serde(default = "default_port")]
    pub jump_port: i64,
    #[serde(default)]
    pub jump_username: Option<String>,
    #[serde(default)]
    pub jump_auth_kind: Option<AuthKind>,
    #[serde(default)]
    pub jump_key_path: Option<String>,
}

fn default_port() -> i64 {
    22
}

impl Session {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let auth_str: String = row.get(6)?;
        let auth_kind = AuthKind::parse(&auth_str).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    e.to_string(),
                )),
            )
        })?;
        let jump_auth_str: Option<String> = row.get(14)?;
        let jump_auth_kind = jump_auth_str
            .as_deref()
            .map(AuthKind::parse)
            .transpose()
            .map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    14,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        e.to_string(),
                    )),
                )
            })?;
        Ok(Self {
            id: row.get(0)?,
            group_id: row.get(1)?,
            name: row.get(2)?,
            host: row.get(3)?,
            port: row.get(4)?,
            username: row.get(5)?,
            auth_kind,
            key_path: row.get(7)?,
            sort: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            jump_host: row.get(11)?,
            jump_port: row.get(12)?,
            jump_username: row.get(13)?,
            jump_auth_kind,
            jump_key_path: row.get(15)?,
        })
    }
}

/// 当前时间戳,ISO8601 UTC。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// SSH 密钥库中的密钥元数据(不含私钥内容,私钥文件单独存储)
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// 空串代表"待插入",upsert 时后端补 uuid
    #[serde(default)]
    pub id: String,
    pub name: String,
    /// 算法标识:ed25519 / rsa-{bits} / ecdsa-{curve}
    pub algorithm: String,
    /// SHA256 指纹
    pub fingerprint: String,
    /// 私钥文件绝对路径(app_data_dir/keys/{id}.pem)
    pub key_path: String,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

impl SshKey {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            algorithm: row.get(2)?,
            fingerprint: row.get(3)?,
            key_path: row.get(4)?,
            comment: row.get(5)?,
            created_at: row.get(6)?,
        })
    }
}
