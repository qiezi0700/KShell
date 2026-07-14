//! 公钥部署:通过已建立的 SSH 会话执行命令,把公钥追加到远端 ~/.ssh/authorized_keys。
//!
//! 复用 ssh_exec,无需新增 SSH 连接。命令做 mkdir + 追加 + chmod + 去重,
//! 兼容 authorized_keys 不存在或 .ssh 目录不存在的情况。
//!
//! 去重用 grep:已存在相同公钥则跳过追加,避免重复条目。

use anyhow::{anyhow, Result};
use russh::ChannelMsg;
use tauri::State;

use crate::state::AppState;

/// 把公钥部署到指定 SSH 会话对应远端主机的 ~/.ssh/authorized_keys。
/// 返回部署结果消息(成功 / 已存在 / 失败)。
pub async fn deploy_public_key(
    state: &State<'_, AppState>,
    session_id: &str,
    public_key: &str,
) -> Result<String> {
    let session = state
        .sessions
        .get(session_id)
        .ok_or_else(|| anyhow!("会话不存在: {session_id}"))?
        .clone();

    // 公钥字符串可能含特殊字符,用单引号包裹避免 shell 解释
    // authorized_keys 格式:algo base64 comment
    let escaped = public_key.replace('\'', "'\\''");

    // 创建 .ssh 目录(不存在时),追加公钥(去重),设置权限
    let cmd = format!(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && \
         touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
         if grep -qF '{escaped}' ~/.ssh/authorized_keys 2>/dev/null; then \
             echo 'KEY_EXISTS'; \
         else \
             echo '{escaped}' >> ~/.ssh/authorized_keys && echo 'KEY_ADDED'; \
         fi"
    );

    let (ssh_handle, scheduler) = {
        let session = session.lock().await;
        (session.handle.clone(), session.scheduler.clone())
    };
    let mut lease = scheduler
        .open_exec(&ssh_handle)
        .await
        .map_err(|e| anyhow!("调度 exec channel 失败: {e:#}"))?;
    lease
        .channel
        .exec(true, cmd.as_bytes())
        .await
        .map_err(|e| anyhow!("执行部署命令失败: {e}"))?;
    let channel = &mut lease.channel;

    let mut out = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data[..]),
            Some(ChannelMsg::ExtendedData { data, .. }) => out.extend_from_slice(&data[..]),
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
            Some(_) => {}
        }
    }

    let output = String::from_utf8_lossy(&out).trim().to_string();
    if output.contains("KEY_ADDED") {
        Ok("公钥已追加到远端 authorized_keys".to_string())
    } else if output.contains("KEY_EXISTS") {
        Ok("公钥已存在,无需重复部署".to_string())
    } else {
        Err(anyhow!("部署公钥失败,远端输出: {output}"))
    }
}
