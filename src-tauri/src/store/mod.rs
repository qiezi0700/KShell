//! 持久化存储:groups / sessions
//!
//! 单连接 + std::sync::Mutex 封装。桌面端并发压力很小,SQLite 单文件足够。
//! 使用 rusqlite bundled 特性,避免用户机器缺 libsqlite3。
//!
//! M2.2 起,password / passphrase 不再存 SQLite,改走 Stronghold vault。

pub mod model;

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};

pub use model::{AuthKind, Group, Session};

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
        let store = Self { conn: Mutex::new(conn) };
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
                updated_at   TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);
            "#,
        )
        .context("执行数据库迁移失败")?;

        // M2.2 迁移:删除旧表中的 password / passphrase 列。
        // SQLite 不支持 DROP COLUMN 标准语法,重建表。
        let cols: Vec<String> = conn
            .pragma_query_map(None, "table_info(sessions)", |row| row.get::<_, String>(1))?
            .collect::<Result<_, _>>()?;
        if cols.contains(&"password".to_string()) || cols.contains(&"passphrase".to_string()) {
            conn.execute_batch(
                r#"
                CREATE TABLE sessions_new (
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
                    updated_at   TEXT NOT NULL
                );
                INSERT INTO sessions_new(id, group_id, name, host, port, username, auth_kind,
                                         key_path, sort, created_at, updated_at)
                SELECT id, group_id, name, host, port, username, auth_kind,
                       key_path, sort, created_at, updated_at
                FROM sessions;
                DROP TABLE sessions;
                ALTER TABLE sessions_new RENAME TO sessions;
                CREATE INDEX idx_sessions_group ON sessions(group_id);
                "#,
            )
            .context("删除旧凭据列失败")?;
        }

        // 记录当前 schema 版本(占位,未来加字段时按版本增量迁移)
        conn.execute(
            "INSERT OR IGNORE INTO schema_version(version) VALUES(?1)",
            params![2i64],
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
                params![g.id, g.name, g.parent_id, g.sort, g.created_at, g.updated_at],
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
                    sort, created_at, updated_at
             FROM sessions ORDER BY sort, name",
        )?;
        let rows = stmt.query_map([], Session::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn upsert_session(&self, mut s: Session) -> Result<Session> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        let now = model::now_iso();
        if s.id.is_empty() {
            s.id = uuid::Uuid::new_v4().to_string();
            s.created_at = now.clone();
            s.updated_at = now.clone();
            conn.execute(
                "INSERT INTO sessions(id, group_id, name, host, port, username, auth_kind,
                                      key_path, sort, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    s.id, s.group_id, s.name, s.host, s.port, s.username,
                    s.auth_kind.as_str(), s.key_path, s.sort, s.created_at, s.updated_at,
                ],
            )?;
        } else {
            s.updated_at = now;
            let affected = conn.execute(
                "UPDATE sessions SET group_id=?2, name=?3, host=?4, port=?5, username=?6,
                                     auth_kind=?7, key_path=?8, sort=?9, updated_at=?10
                 WHERE id=?1",
                params![
                    s.id, s.group_id, s.name, s.host, s.port, s.username,
                    s.auth_kind.as_str(), s.key_path, s.sort, s.updated_at,
                ],
            )?;
            if affected == 0 {
                anyhow::bail!("会话不存在: {}", s.id);
            }
        }
        Ok(s)
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("store mutex poisoned");
        conn.execute("DELETE FROM sessions WHERE id=?1", params![id])?;
        Ok(())
    }
}
