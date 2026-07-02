import { computed, ref } from 'vue'
import {
  deleteGroup as apiDeleteGroup,
  deleteSession as apiDeleteSession,
  getSessionCredentials,
  listGroups,
  listSessions,
  upsertGroup,
  upsertSession,
  type AuthKind,
  type Group,
  type StoredSession,
} from '@/api/sessions'
import { sshConnect, type SshConfig } from '@/api/ssh'
import { addTab, nextTabId } from '@/stores/tabs'
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import { localReadFile, localWriteFile } from '@/api/sftp'
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
  groups.value = groups.value.filter((g) => g.id !== g.id)
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
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: '导入会话配置',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (typeof selected !== 'string' || !selected) return
    const bytes = await localReadFile(selected)
    const json = new TextDecoder().decode(new Uint8Array(bytes))
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
    const path = await saveFileDialog({
      title: '导出会话配置',
      defaultPath: 'kshell-sessions.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (typeof path !== 'string' || !path) return
    const data = exportData()
    const json = JSON.stringify(data, null, 2)
    const bytes = Array.from(new TextEncoder().encode(json))
    await localWriteFile(path, bytes)
    toast.success(`已导出到 ${path}`, '导出成功')
  } catch (e: any) {
    toast.error(String(e?.message ?? e), '导出失败')
  }
}

/**
 * 双击已保存会话:从后端读取解密凭据,直接连接并新建 tab。
 * 凭据缺失(密码认证但无密码)返回 false,调用方应改走对话框。
 */
export async function quickConnect(s: StoredSession): Promise<boolean> {
  // agent / keyboard-interactive 无凭据,不查库直接连
  let cfg: SshConfig
  if (s.authKind === 'agent' || s.authKind === 'keyboard_interactive') {
    cfg = {
      host: s.host,
      port: s.port,
      user: s.username,
      auth: { kind: s.authKind },
    }
  } else {
    const creds = await getSessionCredentials(s.id)
    cfg =
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
