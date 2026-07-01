import { computed, ref } from 'vue'
import {
  deleteGroup as apiDeleteGroup,
  deleteSession as apiDeleteSession,
  listGroups,
  listSessions,
  upsertGroup,
  upsertSession,
  type AuthKind,
  type Group,
  type StoredSession,
} from '@/api/sessions'
import { vaultDelete, vaultGet, vaultKey, vaultSet } from '@/api/vault'
import { sshConnect, type SshConfig } from '@/api/ssh'
import { addTab, nextTabId } from '@/stores/tabs'
import { vaultPassword } from '@/stores/vault'

/** 默认分组名。首次保存时若不存在会自动创建。 */
export const DEFAULT_GROUP_NAME = '默认分组'

const groups = ref<Group[]>([])
const sessions = ref<StoredSession[]>([])
const loaded = ref(false)
const loading = ref(false)

/** 用于左侧树:分组 + 该分组下的会话 */
export interface GroupNode {
  group: Group
  sessions: StoredSession[]
}

export const groupsRef = groups
export const sessionsRef = sessions
export const dataLoaded = loaded

export const groupTree = computed<GroupNode[]>(() => {
  const byGroup = new Map<string | null, StoredSession[]>()
  for (const s of sessions.value) {
    const key = s.groupId ?? null
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(s)
  }
  const nodes: GroupNode[] = groups.value.map((g) => ({
    group: g,
    sessions: byGroup.get(g.id) ?? [],
  }))
  const orphans = byGroup.get(null)
  if (orphans && orphans.length) {
    nodes.push({
      group: {
        id: '',
        name: '未分组',
        parentId: null,
        sort: 9999,
        createdAt: '',
        updatedAt: '',
      },
      sessions: orphans,
    })
  }
  return nodes
})

export async function refreshAll() {
  if (loading.value) return
  loading.value = true
  try {
    const [gs, ss] = await Promise.all([listGroups(), listSessions()])
    groups.value = gs
    sessions.value = ss
    loaded.value = true
  } finally {
    loading.value = false
  }
}

/** 确保存在默认分组;返回其 id。 */
export async function ensureDefaultGroup(): Promise<string> {
  if (!loaded.value) await refreshAll()
  const hit = groups.value.find((g) => g.name === DEFAULT_GROUP_NAME)
  if (hit) return hit.id
  const created = await upsertGroup({ name: DEFAULT_GROUP_NAME })
  groups.value = [...groups.value, created]
  return created.id
}

export interface SaveSessionInput {
  id?: string
  groupId?: string | null
  name: string
  host: string
  port: number
  username: string
  authKind: AuthKind
  keyPath?: string | null
  password?: string | null
  passphrase?: string | null
}

export async function saveSession(input: SaveSessionInput): Promise<StoredSession> {
  // 密码/passphrase 不存 SQLite,只把元数据入库
  const saved = await upsertSession({
    id: input.id,
    groupId: input.groupId,
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    authKind: input.authKind,
    keyPath: input.keyPath,
  })
  const idx = sessions.value.findIndex((s) => s.id === saved.id)
  if (idx >= 0) sessions.value.splice(idx, 1, saved)
  else sessions.value = [...sessions.value, saved]

  // 若用户提供了敏感凭据,写 Stronghold
  const pw = vaultPassword.value
  if (pw) {
    if (input.authKind === 'password' && input.password) {
      await vaultSet({ password: pw, key: vaultKey(saved.id, 'password'), value: input.password })
    }
    if (input.authKind === 'private_key' && input.passphrase) {
      await vaultSet({
        password: pw,
        key: vaultKey(saved.id, 'passphrase'),
        value: input.passphrase,
      })
    }
  }
  return saved
}

export async function removeSession(id: string) {
  await apiDeleteSession(id)
  // 同步删除 Stronghold 里的凭据
  const pw = vaultPassword.value
  if (pw) {
    await vaultDelete({ password: pw, key: vaultKey(id, 'password') }).catch(() => {})
    await vaultDelete({ password: pw, key: vaultKey(id, 'passphrase') }).catch(() => {})
  }
  sessions.value = sessions.value.filter((s) => s.id !== id)
}

export async function saveGroup(name: string, id?: string): Promise<Group> {
  const g = await upsertGroup({ id, name })
  const idx = groups.value.findIndex((x) => x.id === g.id)
  if (idx >= 0) groups.value.splice(idx, 1, g)
  else groups.value = [...groups.value, g]
  return g
}

export async function removeGroup(id: string) {
  await apiDeleteGroup(id)
  groups.value = groups.value.filter((g) => g.id !== id)
  // 后端 ON DELETE SET NULL,前端同步调整
  sessions.value = sessions.value.map((s) => (s.groupId === id ? { ...s, groupId: null } : s))
}

/** 从 Stronghold 读取会话完整凭据 */
export async function loadSessionCredentials(
  s: StoredSession,
): Promise<{ password: string | null; passphrase: string | null }> {
  const pw = vaultPassword.value
  if (!pw) return { password: null, passphrase: null }
  if (s.authKind === 'password') {
    const p = await vaultGet({ password: pw, key: vaultKey(s.id, 'password') }).catch(() => null)
    return { password: p ?? null, passphrase: null }
  }
  const p = await vaultGet({ password: pw, key: vaultKey(s.id, 'passphrase') }).catch(() => null)
  return { password: null, passphrase: p ?? null }
}

/**
 * 判断已保存会话是否具备直接连接所需的凭据:
 * - 密码认证:Stronghold 里有 password
 * - 私钥认证:必须有 keyPath(passphrase 可选)
 */
export async function hasFullCredentials(s: StoredSession): Promise<boolean> {
  if (s.authKind === 'password') {
    const creds = await loadSessionCredentials(s)
    return Boolean(creds.password)
  }
  return Boolean(s.keyPath)
}

/**
 * 使用已保存凭据直接连接并新建 tab。凭据不全时返回 false,调用方应改走对话框。
 */
export async function quickConnect(s: StoredSession): Promise<boolean> {
  if (!(await hasFullCredentials(s))) return false
  const creds = await loadSessionCredentials(s)
  const cfg: SshConfig =
    s.authKind === 'password'
      ? {
          host: s.host,
          port: s.port,
          user: s.username,
          auth: { kind: 'password', password: creds.password ?? '' },
        }
      : {
          host: s.host,
          port: s.port,
          user: s.username,
          auth: {
            kind: 'private_key',
            path: s.keyPath ?? '',
            passphrase: creds.passphrase || null,
          },
        }
  const sessionId = await sshConnect(cfg)
  addTab({
    id: nextTabId('term'),
    type: 'terminal',
    title: s.name || `${s.username}@${s.host}`,
    sessionId,
    channelId: null,
    host: s.host,
    user: s.username,
    storedSessionId: s.id,
  })
  return true
}

/**
 * 查找与 (groupId, host, username, port) 匹配的已保存会话。
 * 用于避免入库时创建重复条目 —— 命中则复用其 id 走 update。
 */
export function findDuplicate(
  groupId: string | null,
  host: string,
  username: string,
  port: number,
  excludeId?: string,
): StoredSession | undefined {
  return sessions.value.find(
    (s) =>
      s.id !== excludeId &&
      (s.groupId ?? null) === (groupId ?? null) &&
      s.host === host &&
      s.username === username &&
      s.port === port,
  )
}
