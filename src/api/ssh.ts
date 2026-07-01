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
