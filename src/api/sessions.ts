import { invoke } from '@tauri-apps/api/core'

// 认证方式与后端 AuthKind 对齐(snake_case tag)
export type AuthKind = 'password' | 'private_key' | 'agent' | 'keyboard_interactive'

export interface Group {
  id: string
  name: string
  parentId: string | null
  sort: number
  createdAt: string
  updatedAt: string
}

export interface StoredSession {
  id: string
  groupId: string | null
  name: string
  host: string
  port: number
  username: string
  authKind: AuthKind
  keyPath: string | null
  sort: number
  createdAt: string
  updatedAt: string
  // ProxyJump 配置(凭据不存库)
  jumpHost: string | null
  jumpPort: number
  jumpUsername: string | null
  jumpAuthKind: AuthKind | null
  jumpKeyPath: string | null
}

// ---- 分组 ----

export function listGroups(): Promise<Group[]> {
  return invoke('groups_list')
}

/**
 * upsert 分组。id 为空串代表新建。
 */
export function upsertGroup(group: Partial<Group> & { name: string }): Promise<Group> {
  const payload: Group = {
    id: group.id ?? '',
    name: group.name,
    parentId: group.parentId ?? null,
    sort: group.sort ?? 0,
    createdAt: group.createdAt ?? '',
    updatedAt: group.updatedAt ?? '',
  }
  return invoke('group_upsert', { group: payload })
}

export function deleteGroup(id: string): Promise<void> {
  return invoke('group_delete', { id })
}

// ---- 会话 ----

export function listSessions(): Promise<StoredSession[]> {
  return invoke('sessions_list')
}

/**
 * upsert 会话。id 为空串代表新建。
 * password / passphrase 为明文,后端加密后入库;空串表示不更新。
 */
export function upsertSession(
  session: Partial<StoredSession> & { name: string; host: string; username: string; authKind: AuthKind },
  password = '',
  passphrase = '',
): Promise<StoredSession> {
  const payload: StoredSession = {
    id: session.id ?? '',
    groupId: session.groupId ?? null,
    name: session.name,
    host: session.host,
    port: session.port ?? 22,
    username: session.username,
    authKind: session.authKind,
    keyPath: session.keyPath ?? null,
    sort: session.sort ?? 0,
    createdAt: session.createdAt ?? '',
    updatedAt: session.updatedAt ?? '',
    jumpHost: session.jumpHost ?? null,
    jumpPort: session.jumpPort ?? 22,
    jumpUsername: session.jumpUsername ?? null,
    jumpAuthKind: session.jumpAuthKind ?? null,
    jumpKeyPath: session.jumpKeyPath ?? null,
  }
  return invoke('session_upsert', {
    input: { ...payload, password, passphrase },
  })
}

export function deleteSession(id: string): Promise<void> {
  return invoke('session_delete', { id })
}

/** 读取某会话的解密后凭据(双击直连时用) */
export function getSessionCredentials(
  id: string,
): Promise<{ password: string | null; passphrase: string | null }> {
  return invoke('session_get_credentials', { id })
}

export function importSessionFile(): Promise<string | null> {
  return invoke<string | null>('session_import_file')
}

export function exportSessionFile(content: string): Promise<string | null> {
  return invoke<string | null>('session_export_file', { content })
}
