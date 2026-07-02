import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type AuthMethod =
  | { kind: 'password'; password: string }
  | { kind: 'private_key'; path: string; passphrase?: string | null }

export interface SshConfig {
  host: string
  port: number
  user: string
  auth: AuthMethod
  timeout_ms?: number | null
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

// ============================================================
// 主机公钥校验(M1.5)
// ============================================================

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

/** 用户确认/拒绝信任首次连接的主机公钥 */
export async function sshConfirmHost(confirmId: string, accept: boolean): Promise<void> {
  await invoke('ssh_confirm_host', { confirmId, accept })
}

/** 移除某主机的已信任公钥记录(mismatch 后用户确认换钥时用) */
export async function sshRemoveKnownHost(host: string, port: number): Promise<void> {
  await invoke('ssh_remove_known_host', { host, port })
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
