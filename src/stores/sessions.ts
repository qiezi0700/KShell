import { computed, ref } from 'vue'
import {
  deleteGroup as apiDeleteGroup,
  deleteSession as apiDeleteSession,
  getSessionCredentials,
  importSessionFile,
  exportSessionFile,
  listGroups,
  listSessions,
  upsertGroup,
  upsertSession,
  type AuthKind,
  type Group,
  type StoredSession,
} from '@/api/sessions'
import { sshConnect, type AuthMethod, type JumpConfig, type SshConfig } from '@/api/ssh'
import { addTab, nextTabId } from '@/stores/tabs'
import { openPasswordPrompt } from '@/stores/prompt'
import { toast } from '@/stores/toast'

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
  // 默认分组永远置顶,其余按 sort 字段,未分组(空 id)置底
  nodes.sort((a, b) => {
    if (a.group.name === DEFAULT_GROUP_NAME && b.group.name !== DEFAULT_GROUP_NAME) return -1
    if (b.group.name === DEFAULT_GROUP_NAME && a.group.name !== DEFAULT_GROUP_NAME) return 1
    if (!a.group.id) return 1
    if (!b.group.id) return -1
    return (a.group.sort ?? 0) - (b.group.sort ?? 0)
  })
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
  // 凭据不持久化,仅用于本次连接;保存时忽略这两个字段
  password?: string | null
  passphrase?: string | null
  // ProxyJump 配置(凭据不保存)
  jumpHost?: string | null
  jumpPort?: number
  jumpUsername?: string | null
  jumpAuthKind?: AuthKind | null
  jumpKeyPath?: string | null
}

/** 保存会话到 SQLite。密码/passphrase 明文传入,后端加密入库。 */
export async function saveSession(input: SaveSessionInput): Promise<StoredSession> {
  const saved = await upsertSession(
    {
      id: input.id,
      groupId: input.groupId,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      authKind: input.authKind,
      keyPath: input.keyPath,
      jumpHost: input.jumpHost,
      jumpPort: input.jumpPort,
      jumpUsername: input.jumpUsername,
      jumpAuthKind: input.jumpAuthKind,
      jumpKeyPath: input.jumpKeyPath,
    },
    input.password ?? '',
    input.passphrase ?? '',
  )
  const idx = sessions.value.findIndex((s) => s.id === saved.id)
  if (idx >= 0) sessions.value.splice(idx, 1, saved)
  else sessions.value = [...sessions.value, saved]
  return saved
}

export async function removeSession(id: string) {
  await apiDeleteSession(id)
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

// ============================================================
// 导入 / 导出
// ============================================================

/** 导入文件格式:分组 + 会话,密码/passphrase 以明文传入后端加密入库 */
export interface ImportData {
  groups: { name: string; sessions: Omit<SaveSessionInput, 'groupId'>[] }[]
}

/** 导出当前所有分组和会话为 ImportData 格式(不含凭据) */
export function exportData(): ImportData {
  return {
    groups: groupTree.value
      .filter((node) => node.group.id !== '')
      .map((node) => ({
        name: node.group.name,
        sessions: node.sessions.map((s) => ({
          name: s.name,
          host: s.host,
          port: s.port,
          username: s.username,
          authKind: s.authKind,
          keyPath: s.keyPath,
          jumpHost: s.jumpHost,
          jumpPort: s.jumpPort,
          jumpUsername: s.jumpUsername,
          jumpAuthKind: s.jumpAuthKind,
          jumpKeyPath: s.jumpKeyPath,
        })),
      })),
  }
}

/** 批量导入会话。已存在的分组按名称匹配复用,会话按 (host, port, username) 去重。 */
export async function importData(data: ImportData): Promise<{ groups: number; sessions: number }> {
  let groupCount = 0
  let sessionCount = 0
  for (const g of data.groups) {
    // 按名称找已有分组,没有则新建
    let groupId = groups.value.find((x) => x.name === g.name)?.id
    if (!groupId) {
      const created = await upsertGroup({ name: g.name })
      groups.value = [...groups.value, created]
      groupId = created.id
      groupCount++
    }
    for (const s of g.sessions) {
      // 同组内按 host+port+user 去重
      const dup = sessions.value.find(
        (x) =>
          (x.groupId ?? null) === groupId &&
          x.host === s.host &&
          x.port === (s.port || 22) &&
          x.username === s.username,
      )
      if (dup) continue
      await saveSession({
        ...s,
        groupId,
        port: s.port || 22,
        password: s.password ?? null,
        passphrase: s.passphrase ?? null,
      })
      sessionCount++
    }
  }
  await refreshAll()
  return { groups: groupCount, sessions: sessionCount }
}

/** 弹出文件选择框读取 JSON 并导入会话配置。失败时通过 toast 反馈。 */
export async function importSessions() {
  try {
    const json = await importSessionFile()
    if (!json) return
    const data = JSON.parse(json) as ImportData
    if (!data.groups || !Array.isArray(data.groups)) {
      toast.error('文件格式不正确,缺少 groups 字段', '导入失败')
      return
    }
    const result = await importData(data)
    toast.success(
      `已导入 ${result.sessions} 个会话${result.groups > 0 ? `(新建 ${result.groups} 个分组)` : ''}`,
      '导入成功',
    )
  } catch (e: any) {
    toast.error(String(e?.message ?? e), '导入失败')
  }
}

/** 弹出保存框将当前会话配置导出为 JSON。 */
export async function exportSessions() {
  if (sessions.value.length === 0) {
    toast.info('没有可导出的会话')
    return
  }
  try {
    const data = exportData()
    const json = JSON.stringify(data, null, 2)
    const path = await exportSessionFile(json)
    if (!path) return
    toast.success(`已导出到 ${path}`, '导出成功')
  } catch (e: any) {
    toast.error(String(e?.message ?? e), '导出失败')
  }
}

async function resolveMainAuth(s: StoredSession): Promise<AuthMethod | null> {
  if (s.authKind === 'agent' || s.authKind === 'keyboard_interactive') {
    return { kind: s.authKind }
  }

  const creds = await getSessionCredentials(s.id)
  if (s.authKind === 'password') {
    let password = creds.password
    if (password == null) {
      password = await openPasswordPrompt({
        title: `连接 ${s.name}`,
        message: `${s.username}@${s.host} 未保存密码,请输入本次连接密码。`,
        placeholder: 'SSH 密码',
        confirmText: '连接',
      })
    }
    return password == null ? null : { kind: 'password', password }
  }

  if (!s.keyPath) throw new Error('私钥路径为空,请编辑会话并重新选择私钥')
  return {
    kind: 'private_key',
    path: s.keyPath,
    passphrase: creds.passphrase || null,
  }
}

async function resolveJumpConfig(s: StoredSession): Promise<JumpConfig | null | undefined> {
  if (!s.jumpHost) return undefined
  if (!s.jumpUsername || !s.jumpAuthKind) {
    throw new Error('跳板机配置不完整,请编辑会话后重试')
  }

  let auth: AuthMethod
  if (s.jumpAuthKind === 'password') {
    const password = await openPasswordPrompt({
      title: `连接跳板机 ${s.jumpHost}`,
      message: `${s.jumpUsername}@${s.jumpHost} 的凭据不会保存,仅用于本次连接。`,
      placeholder: '跳板机密码',
      confirmText: '继续连接',
    })
    if (password == null) return null
    auth = { kind: 'password', password }
  } else if (s.jumpAuthKind === 'private_key') {
    if (!s.jumpKeyPath) throw new Error('跳板机私钥路径为空,请编辑会话后重试')
    const passphrase = await openPasswordPrompt({
      title: `解锁跳板机私钥`,
      message: '私钥未加密时可留空后继续;凭据不会保存。',
      placeholder: '私钥密码短语(可留空)',
      confirmText: '继续连接',
    })
    if (passphrase == null) return null
    auth = {
      kind: 'private_key',
      path: s.jumpKeyPath,
      passphrase: passphrase || null,
    }
  } else {
    auth = { kind: s.jumpAuthKind }
  }

  return {
    host: s.jumpHost,
    port: s.jumpPort || 22,
    user: s.jumpUsername,
    auth,
  }
}

/** 读取凭据并建立 SSH 会话。用户取消临时凭据输入时返回 null。 */
export async function connectSession(s: StoredSession): Promise<string | null> {
  const auth = await resolveMainAuth(s)
  if (!auth) return null
  const jump = await resolveJumpConfig(s)
  if (jump === null) return null

  const cfg: SshConfig = {
    host: s.host,
    port: s.port,
    user: s.username,
    auth,
    jump,
  }
  return await sshConnect(cfg)
}

/**
 * 双击已保存会话:从后端读取解密凭据,直接连接并新建终端 tab。
 * 凭据缺失(密码认证但无密码)返回 false,调用方应改走对话框。
 */
export async function quickConnect(s: StoredSession): Promise<boolean> {
  const sessionId = await connectSession(s)
  if (!sessionId) return false
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
