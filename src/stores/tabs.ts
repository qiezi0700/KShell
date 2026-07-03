import { computed, ref } from 'vue'
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

let counter = 0
export function nextTabId(prefix = 't') {
  counter += 1
  return `${prefix}-${counter}`
}

export function addTab(tab: Tab) {
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

export function closeTab(id: string) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? null
  }
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
  // 先断开各自 SSH 会话,再移除 tab(组件 onBeforeUnmount 会关 channel/sftp,容错)
  await Promise.all(
    related.map((t) => sshDisconnect(t.sessionId).catch(() => {})),
  )
  for (const t of related) closeTab(t.id)
}
