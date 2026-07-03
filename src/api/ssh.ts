import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type AuthMethod =
  | { kind: 'password'; password: string }
  | { kind: 'private_key'; path: string; passphrase?: string | null }
  | { kind: 'agent' }
  | { kind: 'keyboard_interactive' }

export interface JumpConfig {
  host: string
  port: number
  user: string
  auth: AuthMethod
  timeout_ms?: number | null
}

export interface SshConfig {
  host: string
  port: number
  user: string
  auth: AuthMethod
  timeout_ms?: number | null
  jump?: JumpConfig | null
}

export async function sshConnect(cfg: SshConfig): Promise<string> {
  return await invoke<string>('ssh_connect', { cfg })
}

export async function sshOpenShell(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<string> {
  return await invoke<string>('ssh_open_shell', { sessionId, cols, rows })
}

/** 在已有 SSH 会话上以 PTY 模式交互式执行命令(如 docker exec -it),返回 channel id。 */
export async function sshOpenExec(
  sessionId: string,
  command: string,
  cols: number,
  rows: number,
): Promise<string> {
  return await invoke<string>('ssh_open_exec', { sessionId, command, cols, rows })
}

export async function sshWrite(channelId: string, data: Uint8Array): Promise<void> {
  await invoke('ssh_write', { channelId, data: Array.from(data) })
}

export async function sshResize(channelId: string, cols: number, rows: number): Promise<void> {
  await invoke('ssh_resize', { channelId, cols, rows })
}

/** 在已有 SSH 会话上一次性执行命令,返回合并的 stdout+stderr 文本。 */
export async function sshExec(sessionId: string, command: string): Promise<string> {
  return await invoke<string>('ssh_exec', { sessionId, command })
}

export async function sshCloseChannel(channelId: string): Promise<void> {
  await invoke('ssh_close_channel', { channelId })
}

export async function sshDisconnect(sessionId: string): Promise<void> {
  await invoke('ssh_disconnect', { sessionId })
}

export async function onChannelData(
  channelId: string,
  handler: (data: Uint8Array) => void,
): Promise<UnlistenFn> {
  return await listen<number[]>(`ssh://${channelId}/data`, e => {
    handler(new Uint8Array(e.payload))
  })
}

export async function onChannelExit(
  channelId: string,
  handler: (code: number | null) => void,
): Promise<UnlistenFn> {
  return await listen<number | null>(`ssh://${channelId}/exit`, e => {
    handler(e.payload)
  })
}

export interface KiPrompt {
  prompt: string
  echo: boolean
}

export interface KiPromptPayload {
  promptId: string
  name: string
  instructions: string
  prompts: KiPrompt[]
}

/** 前端填写完 keyboard-interactive prompts 后回传后端 */
export async function sshKiRespond(promptId: string, responses: string[]): Promise<void> {
  await invoke('ssh_ki_respond', { promptId, responses })
}

/** 监听 keyboard-interactive 认证的服务器提示 */
export async function onKiPrompt(
  handler: (payload: KiPromptPayload) => void,
): Promise<UnlistenFn> {
  return await listen<KiPromptPayload>('ssh://ki-prompt', e => {
    handler(e.payload)
  })
}

export interface HostKeyConfirmPayload {
  confirmId: string
  host: string
  port: number
  fingerprint: string
  keyType: string
}

export interface HostKeyMismatchPayload {
  host: string
  port: number
  expectedFingerprint: string
  actualFingerprint: string
}

/** 用户确认/拒绝信任首次连接的主机公钥;syncToSystem 同时写入系统 ~/.ssh/known_hosts */
export async function sshConfirmHost(confirmId: string, accept: boolean, syncToSystem = false): Promise<void> {
  await invoke('ssh_confirm_host', { confirmId, accept, syncToSystem })
}

/** 移除某主机的已信任公钥记录(mismatch 后用户确认换钥时用) */
export async function sshRemoveKnownHost(host: string, port: number): Promise<void> {
  await invoke('ssh_remove_known_host', { host, port })
}

/** 已知主机管理面板用:合并 app 库与系统 ~/.ssh/known_hosts 的单条视图 */
export interface KnownHostRecord {
  host: string
  port: number
  keyType: string
  fingerprint: string
  /** app = KShell 自管;system = 系统 ~/.ssh/known_hosts */
  source: 'app' | 'system'
  /** ISO8601;仅 app 条目有值 */
  trustedAt: string
  /** 系统层 HashKnownHosts yes 生成的哈希主机名,不能显示明文 host */
  hashed: boolean
}

/** 列出全部已知主机(app + 系统只读参考) */
export async function sshListKnownHosts(): Promise<KnownHostRecord[]> {
  return await invoke<KnownHostRecord[]>('ssh_list_known_hosts')
}

/** 监听首次连接的公钥确认请求 */
export async function onHostKeyConfirm(
  handler: (payload: HostKeyConfirmPayload) => void,
): Promise<UnlistenFn> {
  return await listen<HostKeyConfirmPayload>('ssh://host-key/confirm', e => {
    handler(e.payload)
  })
}

/** 监听公钥不匹配警告 */
export async function onHostKeyMismatch(
  handler: (payload: HostKeyMismatchPayload) => void,
): Promise<UnlistenFn> {
  return await listen<HostKeyMismatchPayload>('ssh://host-key/mismatch', e => {
    handler(e.payload)
  })
}
