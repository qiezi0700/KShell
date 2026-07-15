use std::path::{Component, Path, PathBuf};

use crate::state::AppState;

const MAX_LOCAL_PATH_CHARS: usize = 32_768;

fn validate_path_text(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("本地路径不能为空".to_string());
    }
    if path.len() > MAX_LOCAL_PATH_CHARS {
        return Err("本地路径过长".to_string());
    }
    if path.contains('\0') {
        return Err("本地路径包含非法字符".to_string());
    }
    Ok(())
}

fn validate_absolute_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("本地路径必须是绝对路径".to_string());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("本地路径不能包含上级目录跳转".to_string());
    }
    Ok(())
}

async fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let canonical = tokio::fs::canonicalize(path)
        .await
        .map_err(|e| format!("解析本地目录失败: {e}"))?;
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|e| format!("读取本地目录信息失败: {e}"))?;
    if !metadata.is_dir() {
        return Err("选择的本地路径不是目录".to_string());
    }
    Ok(canonical)
}

pub async fn default_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "无法确定本地家目录".to_string())?;
    canonical_directory(Path::new(&home)).await
}

pub fn display_path(path: &Path) -> String {
    let display = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = display.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(regular) = display.strip_prefix(r"\\?\") {
            return regular.to_string();
        }
    }
    display.to_string()
}

/// “此电脑”入口只允许用盘符根目录作为选择器初始位置，不能借此探测任意路径。
pub fn picker_root_suggestion(path: &str) -> Option<PathBuf> {
    validate_path_text(path).ok()?;
    let requested = Path::new(path);
    validate_absolute_path(requested).ok()?;

    #[cfg(windows)]
    {
        let mut components = requested.components();
        if matches!(components.next(), Some(Component::Prefix(_)))
            && matches!(components.next(), Some(Component::RootDir))
            && components.next().is_none()
        {
            return Some(requested.to_path_buf());
        }
        None
    }
    #[cfg(not(windows))]
    {
        (requested == Path::new("/")).then(|| requested.to_path_buf())
    }
}

pub async fn set_root(state: &AppState, sftp_id: &str, path: &Path) -> Result<String, String> {
    if !state.sftp_sessions.contains_key(sftp_id) {
        return Err("SFTP 会话不存在或已关闭".to_string());
    }
    let root = canonical_directory(path).await?;
    if !state.sftp_sessions.contains_key(sftp_id) {
        return Err("SFTP 会话已关闭，本地目录授权已取消".to_string());
    }
    let display = display_path(&root);
    state.local_sftp_roots.insert(sftp_id.to_string(), root);
    Ok(display)
}

pub fn remove_root(state: &AppState, sftp_id: &str) {
    state.local_sftp_roots.remove(sftp_id);
}

pub fn root(state: &AppState, sftp_id: &str) -> Result<PathBuf, String> {
    state
        .local_sftp_roots
        .get(sftp_id)
        .map(|entry| entry.value().clone())
        .ok_or_else(|| "本地目录授权已失效，请重新打开 SFTP 标签页".to_string())
}

fn ensure_under_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("拒绝访问未授权的本地路径，请先通过目录选择器授权".to_string())
    }
}

pub async fn authorize_existing(
    state: &AppState,
    sftp_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    validate_path_text(path)?;
    let requested = Path::new(path);
    validate_absolute_path(requested)?;
    let root = root(state, sftp_id)?;
    let canonical = tokio::fs::canonicalize(requested)
        .await
        .map_err(|e| format!("解析本地路径失败: {e}"))?;
    ensure_under_root(&root, &canonical)?;
    Ok(canonical)
}

pub async fn authorize_target(
    state: &AppState,
    sftp_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    validate_path_text(path)?;
    let requested = Path::new(path);
    validate_absolute_path(requested)?;
    let root = root(state, sftp_id)?;
    match tokio::fs::canonicalize(requested).await {
        Ok(canonical) => {
            ensure_under_root(&root, &canonical)?;
            return Ok(canonical);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("解析本地目标路径失败: {error}")),
    }

    let parent = requested
        .parent()
        .ok_or_else(|| "本地目标路径缺少父目录".to_string())?;
    let file_name = requested
        .file_name()
        .ok_or_else(|| "本地目标路径缺少文件名".to_string())?;
    let canonical_parent = tokio::fs::canonicalize(parent)
        .await
        .map_err(|e| format!("解析本地目标父目录失败: {e}"))?;
    ensure_under_root(&root, &canonical_parent)?;
    Ok(canonical_parent.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::{ensure_under_root, picker_root_suggestion, validate_absolute_path};
    use std::path::Path;

    #[test]
    fn rejects_parent_directory_components() {
        let path = if cfg!(windows) {
            Path::new(r"C:\Users\demo\..\secret")
        } else {
            Path::new("/home/demo/../secret")
        };
        assert!(validate_absolute_path(path).is_err());
    }

    #[test]
    fn rejects_paths_outside_authorized_root() {
        let (root, outside) = if cfg!(windows) {
            (Path::new(r"C:\Users\demo"), Path::new(r"C:\Windows"))
        } else {
            (Path::new("/home/demo"), Path::new("/etc"))
        };
        assert!(ensure_under_root(root, outside).is_err());
    }

    #[test]
    fn picker_suggestion_only_accepts_filesystem_roots() {
        let (root, nested) = if cfg!(windows) {
            (r"D:\", r"D:\secret")
        } else {
            ("/", "/home")
        };
        assert!(picker_root_suggestion(root).is_some());
        assert!(picker_root_suggestion(nested).is_none());
    }
}
