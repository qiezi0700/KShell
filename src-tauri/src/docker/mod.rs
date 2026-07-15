use tauri::State;

use crate::state::{AppState, SessionId};

const MAX_DOCKER_ARGUMENTS: usize = 4096;
const MAX_DOCKER_ARGUMENT_BYTES: usize = 1024 * 1024;

fn shell_quote(argument: &str) -> String {
    format!("'{}'", argument.replace('\'', "'\\''"))
}

fn build_command(arguments: &[String]) -> Result<String, String> {
    if arguments.is_empty() {
        return Err("Docker 命令参数不能为空".to_string());
    }
    if arguments.len() > MAX_DOCKER_ARGUMENTS {
        return Err(format!(
            "Docker 命令参数过多，最多允许 {MAX_DOCKER_ARGUMENTS} 项"
        ));
    }
    let total_bytes = arguments.iter().try_fold(0usize, |total, argument| {
        if argument.contains('\0') {
            return Err("Docker 命令参数包含非法字符".to_string());
        }
        total
            .checked_add(argument.len())
            .ok_or_else(|| "Docker 命令参数过长".to_string())
    })?;
    if total_bytes > MAX_DOCKER_ARGUMENT_BYTES {
        return Err(format!(
            "Docker 命令参数过长，最多允许 {MAX_DOCKER_ARGUMENT_BYTES} 字节"
        ));
    }

    let quoted = arguments
        .iter()
        .map(|argument| shell_quote(argument))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!(
        "export PATH=\"$PATH:/usr/local/bin:/usr/bin:/snap/bin\"; docker {quoted}"
    ))
}

/// Docker 可执行文件和参数边界由 Rust 固定，前端只能提交参数数组。
#[tauri::command]
pub async fn docker_exec(
    state: State<'_, AppState>,
    session_id: SessionId,
    arguments: Vec<String>,
    stdin: Option<Vec<u8>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    if let Some(stdin) = stdin.as_deref() {
        crate::commands::validate_exec_stdin(stdin)?;
    }
    let command = build_command(&arguments)?;
    crate::commands::execute_ssh_command(state.inner(), session_id, command, stdin, timeout_ms)
        .await
}

#[cfg(test)]
mod tests {
    use super::build_command;

    #[test]
    fn arguments_are_shell_quoted_as_data() {
        let command = build_command(&[
            "run".to_string(),
            "--name".to_string(),
            "demo; touch /tmp/pwned".to_string(),
        ])
        .expect("参数应成功编码");
        assert!(command.contains("'demo; touch /tmp/pwned'"));
        assert!(!command.contains("--name demo;"));
    }

    #[test]
    fn rejects_nul_bytes() {
        let error = build_command(&["inspect".to_string(), "bad\0id".to_string()])
            .expect_err("NUL 字符必须被拒绝");
        assert!(error.contains("非法字符"));
    }
}
