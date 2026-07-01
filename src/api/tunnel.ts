import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface LocalTunnelKind {
  kind: 'local'
  localAddr: string
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface RemoteTunnelKind {
  kind: 'remote'
  bindAddr: string
  bindPort: number
  localHost: string
  localPort: number
}

export type TunnelKind = LocalTunnelKind | RemoteTunnelKind

export interface TunnelInfo {
  id: string
  sessionId: string
  kind: TunnelKind
  state: 'active' | { error: string } | 'closed'
}

export function tunnelList(sessionId: string): Promise<TunnelInfo[]> {
  return invoke<TunnelInfo[]>('tunnel_list', { sessionId })
}

export function tunnelAdd(sessionId: string, kind: TunnelKind): Promise<string> {
  return invoke<string>('tunnel_add', { sessionId, kind })
}

export function tunnelRemove(tunnelId: string): Promise<void> {
  return invoke('tunnel_remove', { tunnelId })
}

/** 监听单个隧道的状态更新 */
export function onTunnelUpdate(
  tunnelId: string,
  handler: (t: TunnelInfo) => void,
): Promise<UnlistenFn> {
  return listen<TunnelInfo>(`ssh://tunnel/${tunnelId}/update`, e => handler(e.payload))
}

/** 监听全局隧道错误(如远程转发连接本地目标失败) */
export function onTunnelError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>('ssh://tunnel/error', e => handler(e.payload))
}
