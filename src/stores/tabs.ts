import { computed, nextTick, ref } from 'vue'
import { sshDisconnect } from '@/api/ssh'

export type TabType = 'terminal' | 'sftp' | 'monitor' | 'docker'

export interface BaseTab {
  id: string
  type: TabType
  title: string
}

export interface TerminalTab extends BaseTab {
  type: 'terminal'
  sessionId: string
  channelId: string | null   // 打开后填充
  host: string
  user: string
  /** 关联的已保存会话 id;仅从会话列表打开的连接才有,供侧栏做活跃指示 */
  storedSessionId?: string
  /** 非空表示这是 exec 终端(如 docker exec 进容器),不附带 SFTP 面板 */
  command?: string
}

export interface SftpTab extends BaseTab {
  type: 'sftp'
  sessionId: string
  sftpId: string | null  // 打开后填充
  host: string
  user: string
  /** 关联的已保存会话 id */
  storedSessionId?: string
}

export interface DockerTab extends BaseTab {
  type: 'docker'
  sessionId: string
  host: string
  user: string
  /** 关联的已保存会话 id */
  storedSessionId?: string
}

export type Tab = TerminalTab | SftpTab | DockerTab

export const tabs = ref<Tab[]>([])
export const activeTabId = ref<string | null>(null)

const disconnectingSessions = new Map<string, Promise<void>>()

let counter = 0
export function nextTabId(prefix = 't') {
  counter += 1
  return `${prefix}-${counter}`
}

export function addTab(tab: Tab) {
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function detachTab(id: string): Tab | null {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return null
  const [tab] = tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? null
  }
  return tab ?? null
}

async function disconnectSessionIfUnused(sessionId: string): Promise<void> {
  if (tabs.value.some((tab) => tab.sessionId === sessionId)) return

  const existing = disconnectingSessions.get(sessionId)
  if (existing) return existing

  const task = (async () => {
    // 给同一操作中即将创建的复用标签一次挂载机会，避免先关父标签时误断连接。
    await nextTick()
    if (tabs.value.some((tab) => tab.sessionId === sessionId)) return
    try {
      await sshDisconnect(sessionId)
    } catch {
      // 标签关闭不能被清理失败阻塞；后端连接失效后再次断开也是幂等的。
    }
  })()

  disconnectingSessions.set(sessionId, task)
  await task
  if (disconnectingSessions.get(sessionId) === task) {
    disconnectingSessions.delete(sessionId)
  }
}

export function closeTab(id: string) {
  const tab = detachTab(id)
  if (tab) void disconnectSessionIfUnused(tab.sessionId)
}

export function updateTab(id: string, patch: Partial<Tab>) {
  const t = tabs.value.find(t => t.id === id)
  if (t) Object.assign(t, patch)
}

/** 当前活跃的已保存会话 id 集合,用于侧栏的连接状态指示。 */
export const activeStoredSessionIds = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const t of tabs.value) {
    if (t.storedSessionId) s.add(t.storedSessionId)
  }
  return s
})

/**
 * 关闭与某个已保存会话相关的所有 tab(终端/SFTP/Docker),
 * 并断开各自后端的 SSH 连接。供编辑/删除会话前清理使用。
 */
export async function closeTabsByStoredSession(storedSessionId: string) {
  const related = tabs.value.filter((t) => t.storedSessionId === storedSessionId)
  if (related.length === 0) return
  const sessionIds = new Set(related.map((tab) => tab.sessionId))
  for (const tab of related) detachTab(tab.id)
  await Promise.all(Array.from(sessionIds, disconnectSessionIfUnused))
}
