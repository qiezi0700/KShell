//! Stronghold 凭据保险箱。
//!
//! 用 tauri-plugin-stronghold 把 password / passphrase 加密存在快照文件里。
//! key 约定为 `session:{session_id}:password` 或 `session:{session_id}:passphrase`。
//!
//! 策略:
//! - 主密码由用户输入,不持久化到磁盘
//! - 每次 vault 操作都带主密码,后端打开 snapshot 后读写并保存
//! - 主密码错误返回可读错误,前端提示重试

use std::path::PathBuf;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::{
    ClientPath, KeyProvider, Snapshot,
};

const VAULT_PATH: &str = "stronghold/kshell.hold";
const STORE_NAME: &str = "kshell_credentials";

fn client_path() -> ClientPath {
    ClientPath::from([0])
}
fn vault_file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("无法定位 app_data_dir")?;
    std::fs::create_dir_all(&dir).context("创建 app_data_dir 失败")?;
    Ok(dir.join(VAULT_PATH))
}

fn key_provider(password: &str) -> Result<KeyProvider> {
    KeyProvider::try_from(password.to_owned().into_bytes())
        .context("主密码格式无效")
}

async fn with_vault<T, F>(app: &AppHandle, password: &str, f: F) -> Result<T>
where
    F: FnOnce(&tauri_plugin_stronghold::stronghold::Store) -> Result<T>,
{
    let path = vault_file(app)?;
    let kp = key_provider(password)?;

    let snapshot = if path.exists() {
        Snapshot::load(&path, kp).context("加载保险箱失败,主密码可能错误")?
    } else {
        Snapshot::create(&path, kp).context("创建保险箱失败")?
    };

    let client = snapshot
        .load_client(client_path())
        .context("加载保险箱客户端失败")?;
    let store = client.store(STORE_NAME).context("打开凭据存储失败")?;
    let result = f(&store)?;

    snapshot.write().await.context("写入保险箱失败")?;
    Ok(result)
}

pub async fn set(app: &AppHandle, password: &str, key: &str, value: String) -> Result<()> {
    with_vault(app, password, |store| {
        store.insert(key.as_bytes().to_vec(), value.into_bytes())?;
        Ok(())
    })
    .await
}

pub async fn get(app: &AppHandle, password: &str, key: &str) -> Result<Option<String>> {
    with_vault(app, password, |store| {
        let bytes = store.get(key.as_bytes().to_vec())?;
        let s = bytes
            .map(|b| String::from_utf8(b).unwrap_or_default())
            .filter(|s| !s.is_empty());
        Ok(s)
    })
    .await
}

pub async fn delete(app: &AppHandle, password: &str, key: &str) -> Result<()> {
    with_vault(app, password, |store| {
        store.remove(key.as_bytes().to_vec())?;
        Ok(())
    })
    .await
}
