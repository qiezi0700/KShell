import { ref, shallowRef, computed } from 'vue'
import { collectMonitor, type MonitorSample } from '@/api/monitor'
import { tabs, activeTabId } from '@/stores/tabs'

// 历史窗口:保留最近 N 个采样点供图表绘制
const HISTORY_MAX = 60

// 每个会话的采样状态
interface SessionMonitor {
  latest: MonitorSample | null
  history: MonitorSample[]
  timer: number | null
  error: string | null
  isCollecting: boolean
}

const monitors = shallowRef<Record<string, SessionMonitor>>({})

// 采集间隔(ms)
const INTERVAL_MS = 2000

function ensure(sessionId: string): SessionMonitor {
  let m = monitors.value[sessionId]
  if (!m) {
    m = { latest: null, history: [], timer: null, error: null, isCollecting: false }
    monitors.value = { ...monitors.value, [sessionId]: m }
  }
  return m
}

async function tick(sessionId: string) {
  const m = ensure(sessionId)
  if (m.isCollecting) return
  m.isCollecting = true
  try {
    const sample = await collectMonitor(sessionId, m.latest)
    if (monitors.value[sessionId] !== m) return
    m.latest = sample
    m.history.push(sample)
    if (m.history.length > HISTORY_MAX) m.history.shift()
    m.error = null
    // 触发 shallowRef 更新(整体替换 record 引用)
    monitors.value = { ...monitors.value }
  } catch (e) {
    if (monitors.value[sessionId] !== m) return
    m.error = typeof e === 'string' ? e : (e as Error)?.message ?? String(e)
    monitors.value = { ...monitors.value }
    // 出错不停止轮询,下次重试
  } finally {
    m.isCollecting = false
  }
}

/** 启动某会话的监控轮询 */
export function startMonitor(sessionId: string) {
  if (!sessionId) return
  const m = ensure(sessionId)
  if (m.timer != null) return
  // 立即采一次,再定时
  void tick(sessionId)
  m.timer = window.setInterval(() => void tick(sessionId), INTERVAL_MS)
}

/** 停止某会话的监控轮询 */
export function stopMonitor(sessionId: string) {
  const m = monitors.value[sessionId]
  if (!m) return
  if (m.timer != null) {
    clearInterval(m.timer)
    m.timer = null
  }
}

/** 清除某会话的监控数据(断开连接时调用) */
export function clearMonitor(sessionId: string) {
  stopMonitor(sessionId)
  const next = { ...monitors.value }
  delete next[sessionId]
  monitors.value = next
}

/** 取某会话最新采样(响应式) */
export function useMonitor(sessionId: string) {
  return computed(() => monitors.value[sessionId]?.latest ?? null)
}

/** 取某会话历史(响应式) */
export function useHistory(sessionId: string) {
  return computed(() => monitors.value[sessionId]?.history ?? [])
}

/** 取某会话错误信息(响应式) */
export function useMonitorError(sessionId: string) {
  return computed(() => monitors.value[sessionId]?.error ?? null)
}

/**
 * 当前活跃终端 tab 对应的 sessionId。
 * 监控始终跟随当前活跃终端 tab,侧栏底部精简卡与状态栏 info 都用它。
 */
export const activeMonitorSessionId = computed<string | null>(() => {
  const id = activeTabId.value
  if (!id) return null
  const tab = tabs.value.find((t) => t.id === id)
  if (tab && tab.type === 'terminal') return tab.sessionId
  return null
})

/** 当前活跃会话的最新采样(响应式,自动跟随活跃 tab) */
export const activeSample = computed<MonitorSample | null>(() => {
  const sid = activeMonitorSessionId.value
  if (!sid) return null
  return monitors.value[sid]?.latest ?? null
})

/** 当前活跃会话的错误信息 */
export const activeMonitorError = computed<string | null>(() => {
  const sid = activeMonitorSessionId.value
  if (!sid) return null
  return monitors.value[sid]?.error ?? null
})

/** 当前活跃会话的历史 */
export const activeHistory = computed<MonitorSample[]>(() => {
  const sid = activeMonitorSessionId.value
  if (!sid) return []
  return monitors.value[sid]?.history ?? []
})

// 控制监控对话框的显隐
export const monitorDialogOpen = ref(false)
