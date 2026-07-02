//! 主机公钥信任库(known_hosts)。
//!
//! 应用自管的可写库存 `app_data_dir/known_hosts.json`;启动时额外读取系统
//! `~/.ssh/known_hosts` 作为**只读参考层**(用户在系统里已信任过的主机 KShell 也认)。
//! 用户偏好后,`trust_with_sync` 可在接受新主机时把同一条记录追加到系统
//! `~/.ssh/known_hosts`,让系统 SSH 客户端(OpenSSH、Git 等)也能识别。
//!
//! - check 顺序:先查 app 库,未命中再查系统层;任一命中即算 Trusted
//! - trust 默认只写 app JSON;`sync_to_system=true` 时额外追加到系统文件
//! - 系统层支持明文 hostspec、`[host]:port`、逗号列表、`|1|salt|hash` HMAC-SHA1
//!   哈希主机名;`@cert-authority` / `@revoked` 标记条目暂不处理并输出 debug 日志
//! - 追加到系统文件前会检查同 host:port 是否已存在;key 相同则跳过,
//!   key 不同则报错(避免覆盖潜在的 MITM 记录)

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use russh::keys::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostEntry {
    /// OpenSSH 格式公钥字符串,如 "ssh-ed25519 AAAAB3Nz..."
    pub key: String,
    /// SHA256 指纹,如 "SHA256:xxxxx",仅用于 UI 展示
    pub fingerprint: String,
    /// 信任时间,ISO8601
    pub trusted_at: String,
}

pub enum HostCheckResult {
    /// 公钥与已信任记录匹配
    Trusted,
    /// 首次连接,无记录
    New,
    /// 公钥与已信任记录不匹配(潜在中间人攻击)
    Mismatch { stored_fingerprint: String },
}

/// 从系统 known_hosts 解析出的单条条目。每行可能对应多个 host(逗号分隔),
/// 或一个哈希主机名(仅能通过 HMAC 匹配)。
#[derive(Debug)]
struct SystemEntry {
    matcher: HostMatcher,
    /// 完整的 "keytype base64" 字符串,用于 PublicKey.to_string() 比对
    key: String,
}

#[derive(Debug)]
enum HostMatcher {
    /// 明文 hostspec 列表,元素是标准化后的 `host` 或 `[host]:port`
    Plain(Vec<String>),
    /// HMAC-SHA1 哈希主机名(OpenSSH `HashKnownHosts yes` 默认格式)
    Hashed { salt: Vec<u8>, hash: Vec<u8> },
}

pub struct KnownHosts {
    path: PathBuf,
    system_path: Option<PathBuf>,
    entries: BTreeMap<String, HostEntry>,
    system: Vec<SystemEntry>,
}

impl KnownHosts {
    /// 加载 app 库;`system_path` 传 `Some` 时额外尝试读取系统 known_hosts。
    /// 系统层解析失败不阻断启动,只是这部分主机认不到而已。
    pub fn load(path: PathBuf, system_path: Option<PathBuf>) -> Result<Self> {
        let entries = if path.exists() {
            let data = std::fs::read_to_string(&path)
                .with_context(|| format!("读取 known_hosts 失败: {}", path.display()))?;
            serde_json::from_str(&data).context("解析 known_hosts JSON 失败")?
        } else {
            BTreeMap::new()
        };

        let system = match system_path.as_deref().filter(|p| p.exists()) {
            Some(p) => load_system_entries(p).unwrap_or_else(|e| {
                tracing::warn!(error = %e, "读取系统 known_hosts 失败,已忽略");
                Vec::new()
            }),
            None => Vec::new(),
        };

        Ok(Self {
            path,
            system_path,
            entries,
            system,
        })
    }

    fn key_of(host: &str, port: u16) -> String {
        format!("{host}:{port}")
    }

    pub fn check(&self, host: &str, port: u16, pubkey: &PublicKey) -> HostCheckResult {
        // 1. 优先查 app 库
        let k = Self::key_of(host, port);
        match self.entries.get(&k) {
            None => {}
            Some(entry) if entry.key == pubkey.to_string() => return HostCheckResult::Trusted,
            Some(entry) => {
                return HostCheckResult::Mismatch {
                    stored_fingerprint: entry.fingerprint.clone(),
                }
            }
        }

        // 2. 回落到系统层。系统层视为"多条独立记录",匹配到 host + 同 key 即通过;
        //    host 命中但 key 不同视为 Mismatch(仍是潜在 MITM 信号)
        let mut mismatch_key: Option<String> = None;
        let pk_str = pubkey.to_string();
        for entry in &self.system {
            if !entry.matcher.matches(host, port) {
                continue;
            }
            if entry.key == pk_str {
                return HostCheckResult::Trusted;
            }
            if mismatch_key.is_none() {
                // 用 system 中记录的公钥反算 SHA256 指纹(用于 UI 提示"你已经信任过别的 key")
                mismatch_key = Some(fingerprint_of_openssh_key(&entry.key).unwrap_or_default());
            }
        }
        if let Some(fp) = mismatch_key {
            return HostCheckResult::Mismatch {
                stored_fingerprint: fp,
            };
        }
        HostCheckResult::New
    }

    /// 信任该主机公钥并持久化;`sync_to_system=true` 时额外追加到系统
    /// `~/.ssh/known_hosts`。
    pub fn trust_with_sync(
        &mut self,
        host: &str,
        port: u16,
        pubkey: &PublicKey,
        sync_to_system: bool,
    ) -> Result<()> {
        let k = Self::key_of(host, port);
        let fingerprint = pubkey.fingerprint(HashAlg::Sha256).to_string();
        self.entries.insert(
            k,
            HostEntry {
                key: pubkey.to_string(),
                fingerprint,
                trusted_at: chrono::Utc::now().to_rfc3339(),
            },
        );
        self.save()?;

        if sync_to_system {
            if let Some(system_path) = self.system_path.as_ref() {
                if let Err(e) = append_system_known_hosts(system_path, host, port, pubkey) {
                    tracing::warn!(error = %e, "同步写入系统 known_hosts 失败");
                }
            } else {
                tracing::warn!("未获取到系统 known_hosts 路径,无法同步");
            }
        }
        Ok(())
    }

    /// 移除某主机的信任记录(用户发现 mismatch 后手动清除旧指纹用)。
    /// 仅从 app 库移除,系统 known_hosts 不动。
    pub fn remove(&mut self, host: &str, port: u16) -> Result<()> {
        let k = Self::key_of(host, port);
        self.entries.remove(&k);
        self.save()
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("创建 known_hosts 目录失败: {}", parent.display()))?;
        }
        let data =
            serde_json::to_string_pretty(&self.entries).context("序列化 known_hosts 失败")?;
        std::fs::write(&self.path, data)
            .with_context(|| format!("写入 known_hosts 失败: {}", self.path.display()))?;
        Ok(())
    }
}

/// 把公钥以 OpenSSH 格式追加到系统 known_hosts。
/// 写入前检查同 host:port 是否已有记录:相同则跳过,不同则报错,避免覆盖。
fn append_system_known_hosts(path: &Path, host: &str, port: u16, pubkey: &PublicKey) -> Result<()> {
    let pk_str = pubkey.to_string();
    let line = format!("[{host}]:{port} {pk_str}\n");

    // 确保 ~/.ssh 目录存在
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("创建系统 known_hosts 目录失败: {}", parent.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }

    // 已存在同 host:port 记录时,相同 key 跳过,不同 key 报错
    if path.exists() {
        let entries = load_system_entries(path)?;
        for entry in entries {
            if entry.matcher.matches(host, port) {
                if entry.key == pk_str {
                    return Ok(());
                }
                anyhow::bail!("系统 known_hosts 中已存在该主机的其他公钥,未写入");
            }
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("打开系统 known_hosts 失败: {}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }

    use std::io::Write;
    file.write_all(line.as_bytes())
        .with_context(|| format!("写入系统 known_hosts 失败: {}", path.display()))?;
    Ok(())
}

impl HostMatcher {
    fn matches(&self, host: &str, port: u16) -> bool {
        match self {
            HostMatcher::Plain(patterns) => {
                let plain_key = host.to_string();
                let bracketed = format!("[{host}]:{port}");
                patterns
                    .iter()
                    .any(|p| p.eq_ignore_ascii_case(&plain_key) || p == &bracketed)
            }
            HostMatcher::Hashed { salt, hash } => {
                // OpenSSH: HMAC-SHA1(key=salt, msg=hostname) == hash
                let Ok(mut mac) = HmacSha1::new_from_slice(salt) else {
                    return false;
                };
                mac.update(host.as_bytes());
                mac.verify_slice(hash).is_ok()
            }
        }
    }
}

fn load_system_entries(path: &Path) -> Result<Vec<SystemEntry>> {
    let data = std::fs::read_to_string(path)
        .with_context(|| format!("读取系统 known_hosts 失败: {}", path.display()))?;
    let mut out = Vec::new();
    for (lineno, raw) in data.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        match parse_line(line) {
            Ok(Some(entry)) => out.push(entry),
            Ok(None) => {}
            Err(e) => tracing::debug!(line = lineno + 1, error = %e, "跳过 known_hosts 行"),
        }
    }
    Ok(out)
}

fn parse_line(line: &str) -> Result<Option<SystemEntry>> {
    // 跳过 @cert-authority / @revoked:证书 CA 场景不在当前实现范围内
    let line = if let Some(rest) = line.strip_prefix('@') {
        // 形如 "@cert-authority hostspec keytype key"
        let mut it = rest.splitn(2, char::is_whitespace);
        let marker = it.next().unwrap_or("");
        tracing::debug!(marker, "known_hosts 标记条目暂不支持");
        return Ok(None);
    } else {
        line
    };

    let mut parts = line.splitn(3, char::is_whitespace);
    let hostspec = parts.next().context("缺少 hostspec")?;
    let keytype = parts.next().context("缺少 keytype")?;
    let key_rest = parts.next().context("缺少 key 数据")?;
    // key 部分可能带 comment,取到第一个空白为止即可
    let key_b64 = key_rest.split_whitespace().next().context("key 数据为空")?;

    let matcher = if let Some(rest) = hostspec.strip_prefix("|1|") {
        // |1|salt_b64|hash_b64
        let mut it = rest.splitn(2, '|');
        let salt_b64 = it.next().context("hashed hostspec 缺少 salt")?;
        let hash_b64 = it.next().context("hashed hostspec 缺少 hash")?;
        HostMatcher::Hashed {
            salt: B64.decode(salt_b64).context("salt base64 解码失败")?,
            hash: B64.decode(hash_b64).context("hash base64 解码失败")?,
        }
    } else {
        HostMatcher::Plain(
            hostspec
                .split(',')
                .filter(|s| !s.is_empty() && !s.starts_with('!')) // 否定匹配暂不支持
                .map(|s| s.to_string())
                .collect(),
        )
    };

    Ok(Some(SystemEntry {
        matcher,
        key: format!("{keytype} {key_b64}"),
    }))
}

/// 计算 OpenSSH 单行公钥字符串的 SHA256 指纹,用于 mismatch 展示。
/// 解析失败返回 None,让上层用空串兜底。
fn fingerprint_of_openssh_key(line: &str) -> Option<String> {
    line.parse::<PublicKey>()
        .ok()
        .map(|k| k.fingerprint(HashAlg::Sha256).to_string())
}
