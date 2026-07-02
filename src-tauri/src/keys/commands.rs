//! 密钥库 Tauri 命令:列表/生成/导入/删除/重命名/部署公钥。

use std::path::PathBuf;

use anyhow::Context;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::keys::deploy::deploy_public_key;
use crate::keys::gen::{generate_keypair, inspect_key, parse_algorithm};
use crate::state::AppState;
use crate::store::SshKey;

fn err<E: std::fmt::Display>(e: E) -> String {
    format!("{e:#}")
}

/// 密钥库列表
#[tauri::command]
pub fn ssh_keys_list(state: State<'_, AppState>) -> Result<Vec<SshKey>, String> {
    state.store()?.list_ssh_keys().map_err(err)
}

/// 生成新密钥对
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyInput {
    pub name: String,
    /// ed25519 / rsa-2048 / rsa-3072 / rsa-4096 / ecdsa-p256 / ecdsa-p384 / ecdsa-p521
    pub algorithm: String,
    /// 可选注释(通常用邮箱)
    #[serde(default)]
    pub comment: Option<String>,
    /// 可选 passphrase,加密后存库
    #[serde(default)]
    pub passphrase: Option<String>,
}

#[tauri::command]
pub async fn ssh_key_generate(
    app: AppHandle,
    state: State<'_, AppState>,
    input: GenerateKeyInput,
) -> Result<SshKey, String> {
    let algo = parse_algorithm(&input.algorithm).map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let comment = input.comment.unwrap_or_default();

    // 密钥文件路径:app_data_dir/keys/{id}.pem
    let keys_dir = keys_dir(&app).map_err(err)?;
    let key_path = keys_dir.join(format!("{id}.pem"));

    let (algo_str, fingerprint, _pubkey) =
        generate_keypair(algo, &key_path, &comment).map_err(err)?;

    // passphrase 加密存储
    let passphrase_enc = match &input.passphrase {
        Some(p) if !p.is_empty() => {
            let crypto = &state.crypto;
            crypto.encrypt(p).map_err(err)?
        }
        _ => None,
    };

    let key = SshKey {
        id: id.clone(),
        name: input.name,
        algorithm: algo_str,
        fingerprint,
        key_path: key_path.to_string_lossy().to_string(),
        comment: if comment.is_empty() { None } else { Some(comment) },
        created_at: crate::store::model::now_iso(),
    };

    state.store()?.insert_ssh_key(key.clone()).map_err(err)?;

    // passphrase 单独存(密钥文件旁的 .pass 文件)
    if let Some(enc) = passphrase_enc {
        let pass_path = keys_dir.join(format!("{id}.pass"));
        std::fs::write(&pass_path, enc).map_err(|e| format!("写入 passphrase 文件失败: {e}"))?;
    }

    Ok(key)
}

/// 导入已有私钥文件(复制到密钥库目录,提取元数据)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportKeyInput {
    pub name: String,
    /// 外部私钥文件路径
    pub source_path: String,
    #[serde(default)]
    pub passphrase: Option<String>,
}

#[tauri::command]
pub async fn ssh_key_import(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ImportKeyInput,
) -> Result<SshKey, String> {
    let pass = input.passphrase.as_deref().filter(|p| !p.is_empty());
    let (algo_str, fingerprint, _pubkey) =
        inspect_key(&input.source_path, pass).map_err(err)?;

    let id = Uuid::new_v4().to_string();
    let keys_dir = keys_dir(&app).map_err(err)?;
    let dest_path = keys_dir.join(format!("{id}.pem"));

    // 复制私钥文件到密钥库
    std::fs::copy(&input.source_path, &dest_path)
        .map_err(|e| format!("复制密钥文件失败: {e}"))?;

    let key = SshKey {
        id: id.clone(),
        name: input.name,
        algorithm: algo_str,
        fingerprint,
        key_path: dest_path.to_string_lossy().to_string(),
        comment: None,
        created_at: crate::store::model::now_iso(),
    };

    state.store()?.insert_ssh_key(key.clone()).map_err(err)?;

    if let Some(p) = &input.passphrase {
        if !p.is_empty() {
            let enc = state.crypto.encrypt(p).map_err(err)?;
            if let Some(enc) = enc {
                let pass_path = keys_dir.join(format!("{id}.pass"));
                std::fs::write(&pass_path, enc)
                    .map_err(|e| format!("写入 passphrase 文件失败: {e}"))?;
            }
        }
    }

    Ok(key)
}

/// 删除密钥(同时删除私钥文件和 passphrase 文件)
#[tauri::command]
pub fn ssh_key_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let key = state.store()?.get_ssh_key(&id).map_err(err)?;

    // 删除私钥文件
    let path = PathBuf::from(&key.key_path);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除密钥文件失败: {e}"))?;
    }

    // 删除 passphrase 文件(如存在)
    if let Some(parent) = path.parent() {
        let pass_path = parent.join(format!("{id}.pass"));
        if pass_path.exists() {
            std::fs::remove_file(&pass_path).ok();
        }
    }

    state.store()?.delete_ssh_key(&id).map_err(err)
}

/// 重命名密钥
#[tauri::command]
pub fn ssh_key_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    state.store()?.update_ssh_key_name(&id, &name).map_err(err)
}

/// 获取密钥的 OpenSSH 公钥字符串(用于展示和部署)
#[tauri::command]
pub async fn ssh_key_public_key(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let key = state.store()?.get_ssh_key(&id).map_err(err)?;

    // 尝试读取 passphrase(如有加密存储)
    let pass_path = PathBuf::from(&key.key_path)
        .with_extension("pass");
    let passphrase = if pass_path.exists() {
        let enc = std::fs::read_to_string(&pass_path).map_err(|e| format!("读取 passphrase 失败: {e}"))?;
        state.crypto.decrypt(Some(enc.as_str())).map_err(err)?
    } else {
        None
    };

    let (_algo, _fp, pubkey) =
        inspect_key(&key.key_path, passphrase.as_deref()).map_err(err)?;
    Ok(pubkey)
}

/// 部署公钥到远端服务器(通过已有 SSH 会话)
#[tauri::command]
pub async fn ssh_key_deploy(
    state: State<'_, AppState>,
    session_id: String,
    key_id: String,
) -> Result<String, String> {
    let key = state.store()?.get_ssh_key(&key_id).map_err(err)?;

    // 读取公钥
    let pass_path = PathBuf::from(&key.key_path)
        .with_extension("pass");
    let passphrase = if pass_path.exists() {
        let enc = std::fs::read_to_string(&pass_path).map_err(|e| format!("读取 passphrase 失败: {e}"))?;
        state.crypto.decrypt(Some(enc.as_str())).map_err(err)?
    } else {
        None
    };

    let (_algo, _fp, pubkey) =
        inspect_key(&key.key_path, passphrase.as_deref()).map_err(err)?;

    deploy_public_key(&state, &session_id, &pubkey)
        .await
        .map_err(err)
}

/// 获取密钥的 passphrase(解密后返回,供私钥认证时使用)
#[tauri::command]
pub fn ssh_key_passphrase(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<String>, String> {
    let key = state.store()?.get_ssh_key(&id).map_err(err)?;
    let pass_path = PathBuf::from(&key.key_path)
        .with_extension("pass");
    if !pass_path.exists() {
        return Ok(None);
    }
    let enc = std::fs::read_to_string(&pass_path).map_err(|e| format!("读取 passphrase 失败: {e}"))?;
    state.crypto.decrypt(Some(enc.as_str())).map_err(err)
}

fn keys_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("无法定位 app_data_dir")?;
    let keys_dir = dir.join("keys");
    std::fs::create_dir_all(&keys_dir)
        .with_context(|| format!("创建密钥库目录失败: {}", keys_dir.display()))?;
    Ok(keys_dir)
}
