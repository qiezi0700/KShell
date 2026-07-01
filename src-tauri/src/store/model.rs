//! store 层的数据结构。与前端 TypeScript 类型一一对应。

use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// 认证方式枚举。与前端 AuthMethod.kind 对齐(snake_case)。
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    Password,
    PrivateKey,
}

impl AuthKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthKind::Password => "password",
            AuthKind::PrivateKey => "private_key",
        }
    }
    pub fn parse(s: &str) -> anyhow::Result<Self> {
        match s {
            "password" => Ok(AuthKind::Password),
            "private_key" => Ok(AuthKind::PrivateKey),
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
        })
    }
}

/// 当前时间戳,ISO8601 UTC。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
