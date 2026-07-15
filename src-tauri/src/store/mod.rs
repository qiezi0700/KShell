//! 持久化存储:groups / sessions
//!
//! 单连接 + std::sync::Mutex 封装。桌面端并发压力很小,SQLite 单文件足够。
//! 使用 rusqlite bundled 特性,避免用户机器缺 libsqlite3。
//!
//! password / passphrase 用机器绑定 AES-256-GCM 加密后存表,key 文件在 app_data_dir。

pub mod model;

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

use crate::crypto::CryptoKey;
pub use model::{Group, QuickCommand, Session, SshKey};

/// 存储门面,持有 SQLite 连接。
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// 在指定文件路径打开(或新建)数据库并执行迁移。
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建数据目录失败: {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("打开数据库失败: {}", path.display()))?;
        // 开 WAL,桌面端多次读写体验更平滑
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON").ok();
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS groups (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                parent_id  TEXT REFERENCES groups(id) ON DELETE CASCADE,
                sort       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                group_id     TEXT REFERENCES groups(id) ON DELETE SET NULL,
                name         TEXT NOT NULL,
                host         TEXT NOT NULL,
                port         INTEGER NOT NULL DEFAULT 22,
                username     TEXT NOT NULL,
                auth_kind    TEXT NOT NULL,
                key_path     TEXT,
                sort         INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                jump_host    TEXT,
                jump_port    INTEGER NOT NULL DEFAULT 22,
                jump_username TEXT,
                jump_auth_kind TEXT,
                jump_key_path TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);
            "#,
        )
        .context("执行数据库迁移失败")?;

        // v3:加 password_encrypted / passphrase_encrypted 列(机器绑定加密存储)
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        if !cols.contains(&"password_encrypted".to_string()) {
            conn.execute_batch("ALTER TABLE sessions ADD COLUMN password_encrypted TEXT")
                .context("添加 password_encrypted 列失败")?;
        }
        if !cols.contains(&"passphrase_encrypted".to_string()) {
            conn.execute_batch("ALTER TABLE sessions ADD COLUMN passphrase_encrypted TEXT")
                .context("添加 passphrase_encrypted 列失败")?;
        }

        // v4:SSH 密钥库表
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                algorithm     TEXT NOT NULL,
                fingerprint   TEXT NOT NULL,
                key_path      TEXT NOT NULL,
                comment       TEXT,
                passphrase_encrypted TEXT,
                created_at    TEXT NOT NULL
            );
            "#,
        )
        .context("创建 ssh_keys 表失败")?;

        // v5:ProxyJump 配置列
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        for col in [
            "jump_host",
            "jump_port",
            "jump_username",
            "jump_auth_kind",
            "jump_key_path",
        ] {
            if !cols.contains(&col.to_string()) {
                let sql = match col {
                    "jump_port" => {
                        "ALTER TABLE sessions ADD COLUMN jump_port INTEGER NOT NULL DEFAULT 22"
                    }
                    _ => &format!("ALTER TABLE sessions ADD COLUMN {col} TEXT"),
                };
                conn.execute_batch(sql)
                    .with_context(|| format!("添加 sessions.{col} 列失败"))?;
            }
        }

        // v6:通用设置 KV 表(settings)+ 快捷指令表(quick_commands)
        // 原 localStorage 中的 preferences / sidebar-width / 布局数值迁到 settings;
        // 快捷指令从 localStorage 迁到 quick_commands 独立表,便于 CRUD 与后续扩展。
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quick_commands (
                id          TEXT PRIMARY KEY,
                label       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                command     TEXT NOT NULL,
                sort        INTEGER NOT NULL DEFAULT 0,
                builtin     INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .context("创建 settings / quick_commands 表失败")?;

        // seed 内置快捷指令(仅首次建库时写入,后续升级不覆盖用户改动)
        let builtin_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM quick_commands WHERE builtin=1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if builtin_count == 0 {
            let builtins: &[(&str, &str, &str, &str)] = &[
                ("kshell-builtin-ls", "ls", "", "ls"),
                ("kshell-builtin-lsl", "ls -la", "", "ls -la"),
                ("kshell-builtin-cdup", "cd ..", "", "cd .."),
                ("kshell-builtin-cdhome", "cd ~", "", "cd ~"),
                ("kshell-builtin-pwd", "pwd", "", "pwd"),
            ];
            for (i, (id, label, desc, cmd)) in builtins.iter().enumerate() {
                conn.execute(
                    "INSERT INTO quick_commands(id, label, description, command, sort, builtin)
                     VALUES(?1, ?2, ?3, ?4, ?5, 1)",
                    params![id, label, desc, cmd, i as i64],
                )
                .context("写入内置快捷指令失败")?;
            }
        }

        // 记录当前 schema 版本
        conn.execute(
            "INSERT OR IGNORE INTO schema_version(version) VALUES(?1)",
            params![6i64],
        )
        .ok();
        Ok(())
    }

    // ---- Group ----

    pub fn list_groups(&self) -> Result<Vec<Group>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, parent_id, sort, created_at, updated_at
             FROM groups ORDER BY sort, name",
        )?;
        let rows = stmt.query_map([], Group::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// upsert:id 为空则新建,否则按 id 更新。
    pub fn upsert_group(&self, mut g: Group) -> Result<Group> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let now = model::now_iso();
        if g.id.is_empty() {
            g.id = uuid::Uuid::new_v4().to_string();
            g.created_at = now.clone();
            g.updated_at = now.clone();
            conn.execute(
                "INSERT INTO groups(id, name, parent_id, sort, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    g.id,
                    g.name,
                    g.parent_id,
                    g.sort,
                    g.created_at,
                    g.updated_at
                ],
            )?;
        } else {
            g.updated_at = now;
            let affected = conn.execute(
                "UPDATE groups SET name=?2, parent_id=?3, sort=?4, updated_at=?5 WHERE id=?1",
                params![g.id, g.name, g.parent_id, g.sort, g.updated_at],
            )?;
            if affected == 0 {
                anyhow::bail!("分组不存在: {}", g.id);
            }
        }
        Ok(g)
    }

    pub fn delete_group(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM groups WHERE id=?1", params![id])?;
        Ok(())
    }

    // ---- Session ----

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, group_id, name, host, port, username, auth_kind, key_path,
                    sort, created_at, updated_at,
                    jump_host, jump_port, jump_username, jump_auth_kind, jump_key_path
             FROM sessions ORDER BY sort, name",
        )?;
        let rows = stmt.query_map([], Session::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// upsert:id 为空则新建,否则按 id 更新。
    /// password / passphrase 由调用方通过 crypto 加密后传入密文。
    pub fn upsert_session(
        &self,
        mut s: Session,
        password_encrypted: Option<String>,
        passphrase_encrypted: Option<String>,
    ) -> Result<Session> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let now = model::now_iso();
        if s.id.is_empty() {
            s.id = uuid::Uuid::new_v4().to_string();
            s.created_at = now.clone();
            s.updated_at = now.clone();
            conn.execute(
                "INSERT INTO sessions(id, group_id, name, host, port, username, auth_kind,
                                      key_path, sort, created_at, updated_at,
                                      password_encrypted, passphrase_encrypted,
                                      jump_host, jump_port, jump_username, jump_auth_kind, jump_key_path)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    s.id,
                    s.group_id,
                    s.name,
                    s.host,
                    s.port,
                    s.username,
                    s.auth_kind.as_str(),
                    s.key_path,
                    s.sort,
                    s.created_at,
                    s.updated_at,
                    password_encrypted,
                    passphrase_encrypted,
                    s.jump_host,
                    s.jump_port,
                    s.jump_username,
                    s.jump_auth_kind.as_ref().map(|a| a.as_str()),
                    s.jump_key_path,
                ],
            )?;
        } else {
            s.updated_at = now;
            let affected = conn.execute(
                "UPDATE sessions SET group_id=?2, name=?3, host=?4, port=?5, username=?6,
                                     auth_kind=?7, key_path=?8, sort=?9, updated_at=?10,
                                     password_encrypted=?11, passphrase_encrypted=?12,
                                     jump_host=?13, jump_port=?14, jump_username=?15,
                                     jump_auth_kind=?16, jump_key_path=?17
                 WHERE id=?1",
                params![
                    s.id,
                    s.group_id,
                    s.name,
                    s.host,
                    s.port,
                    s.username,
                    s.auth_kind.as_str(),
                    s.key_path,
                    s.sort,
                    s.updated_at,
                    password_encrypted,
                    passphrase_encrypted,
                    s.jump_host,
                    s.jump_port,
                    s.jump_username,
                    s.jump_auth_kind.as_ref().map(|a| a.as_str()),
                    s.jump_key_path,
                ],
            )?;
            if affected == 0 {
                anyhow::bail!("会话不存在: {}", s.id);
            }
        }
        Ok(s)
    }

    /// 读取某会话的解密后凭据。无密文返回 None。
    pub fn get_credentials(&self, id: &str, crypto: &CryptoKey) -> Result<Credentials> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let (pwd_enc, pass_enc): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT password_encrypted, passphrase_encrypted FROM sessions WHERE id=?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    anyhow::anyhow!("会话不存在: {id}")
                }
                other => anyhow::Error::from(other),
            })?;
        Ok(Credentials {
            password: crypto.decrypt(pwd_enc.as_deref())?,
            passphrase: crypto.decrypt(pass_enc.as_deref())?,
        })
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM sessions WHERE id=?1", params![id])?;
        Ok(())
    }

    // ---- SshKey ----

    pub fn list_ssh_keys(&self) -> Result<Vec<SshKey>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, algorithm, fingerprint, key_path, comment, created_at
             FROM ssh_keys ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], SshKey::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn insert_ssh_key(&self, key: SshKey) -> Result<SshKey> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO ssh_keys(id, name, algorithm, fingerprint, key_path, comment, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                key.id,
                key.name,
                key.algorithm,
                key.fingerprint,
                key.key_path,
                key.comment,
                key.created_at,
            ],
        )?;
        Ok(key)
    }

    pub fn update_ssh_key_name(&self, id: &str, name: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let affected =
            conn.execute("UPDATE ssh_keys SET name=?2 WHERE id=?1", params![id, name])?;
        if affected == 0 {
            anyhow::bail!("密钥不存在: {id}");
        }
        Ok(())
    }

    pub fn delete_ssh_key(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM ssh_keys WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn get_ssh_key(&self, id: &str) -> Result<SshKey> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let key = conn.query_row(
            "SELECT id, name, algorithm, fingerprint, key_path, comment, created_at
             FROM ssh_keys WHERE id=?1",
            params![id],
            SshKey::from_row,
        )?;
        Ok(key)
    }

    // ---- Settings(KV) ----

    /// 读取一个设置项;不存在返回 None。
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(anyhow::Error::from(e)),
        }
    }

    /// 写入一个设置项(已存在则覆盖)。
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )
        .with_context(|| format!("写入设置项失败: {key}"))?;
        Ok(())
    }

    // ---- QuickCommand ----

    pub fn list_quick_commands(&self) -> Result<Vec<QuickCommand>> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, label, description, command, sort, builtin
             FROM quick_commands ORDER BY sort, id",
        )?;
        let rows = stmt.query_map([], QuickCommand::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// upsert 快捷指令。id 为空则新建,否则按 id 更新。
    /// 内置项(builtin=1)禁止修改,只允许用户自定义项(builtin=0)走 upsert。
    pub fn upsert_quick_command(&self, mut q: QuickCommand) -> Result<QuickCommand> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        if q.id.is_empty() {
            q.id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO quick_commands(id, label, description, command, sort, builtin)
                 VALUES(?1, ?2, ?3, ?4, ?5, 0)",
                params![q.id, q.label, q.description, q.command, q.sort],
            )
            .context("新增快捷指令失败")?;
        } else {
            let affected = conn
                .execute(
                    "UPDATE quick_commands SET label=?2, description=?3, command=?4, sort=?5
                 WHERE id=?1 AND builtin=0",
                    params![q.id, q.label, q.description, q.command, q.sort],
                )
                .context("更新快捷指令失败")?;
            if affected == 0 {
                anyhow::bail!("快捷指令不存在或为内置项: {}", q.id);
            }
        }
        Ok(q)
    }

    /// 删除快捷指令;内置项不可删。
    pub fn delete_quick_command(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let affected = conn
            .execute(
                "DELETE FROM quick_commands WHERE id=?1 AND builtin=0",
                params![id],
            )
            .context("删除快捷指令失败")?;
        if affected == 0 {
            anyhow::bail!("快捷指令不存在或为内置项: {id}");
        }
        Ok(())
    }
}

/// 解密后的会话凭据
pub struct Credentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
}
