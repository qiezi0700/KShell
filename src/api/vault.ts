import { invoke } from '@tauri-apps/api/core'

export interface VaultSetRequest {
  password: string
  key: string
  value: string
}

export interface VaultGetRequest {
  password: string
  key: string
}

export interface VaultDeleteRequest {
  password: string
  key: string
}

/**
 * 把 value 加密写入 Stronghold。主密码错误会抛错。
 */
export function vaultSet(req: VaultSetRequest): Promise<void> {
  return invoke('vault_set', req)
}

/**
 * 从 Stronghold 读取。key 不存在返回 null;主密码错误抛错。
 */
export function vaultGet(req: VaultGetRequest): Promise<string | null> {
  return invoke('vault_get', req)
}

/**
 * 删除指定 key。主密码错误抛错。
 */
export function vaultDelete(req: VaultDeleteRequest): Promise<void> {
  return invoke('vault_delete', req)
}

/** 构造会话凭据 key */
export function vaultKey(sessionId: string, kind: 'password' | 'passphrase') {
  return `session:${sessionId}:${kind}`
}
