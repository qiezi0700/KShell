import { computed, shallowRef } from 'vue'
import {
  dockerVersion,
  dockerListContainers,
  dockerListImages,
  type DockerContainer,
  type DockerImage,
  type DockerVersion,
} from '@/api/docker'

// 轮询间隔(ms)
const INTERVAL_MS = 5000

interface SessionDocker {
  available: boolean
  version: DockerVersion | null
  containers: DockerContainer[]
  images: DockerImage[]
  /** 仅首次加载与手动刷新为 true,后台轮询不触发,避免刷新按钮反复 spin */
  loading: boolean
  error: string | null
}

const sessions = shallowRef<Record<string, SessionDocker>>({})
// 定时器句柄不属于 UI 状态,单独用 Map 管理,避免进入响应式对象
const timers = new Map<string, number>()
// 进行中的请求守卫,避免轮询与手动刷新并发叠加
const inFlight = new Set<string>()

function ensure(sessionId: string): SessionDocker {
  let s = sessions.value[sessionId]
  if (!s) {
    s = {
      available: false,
      version: null,
      containers: [],
      images: [],
      loading: false,
      error: null,
    }
    sessions.value = { ...sessions.value, [sessionId]: s }
  }
  return s
}

// 状态更新采用不可变替换:每次产出新的 SessionDocker 对象。
// useDockerSession 返回的 computed 取的是整个 session 对象引用,
// 若直接 mutate 旧对象再浅拷贝 record,computed 会因引用相等跳过更新,
// 导致数据已写入但 UI 不刷新(要等下一次无关渲染才显出)。
function patch(sessionId: string, p: Partial<SessionDocker>) {
  const cur = sessions.value[sessionId]
  if (!cur) return
  sessions.value = { ...sessions.value, [sessionId]: { ...cur, ...p } }
}

async function tick(sessionId: string, showLoading: boolean) {
  if (inFlight.has(sessionId)) return
  inFlight.add(sessionId)
  ensure(sessionId)
  if (showLoading) patch(sessionId, { loading: true })
  try {
    const [containers, images] = await Promise.all([
      dockerListContainers(sessionId),
      dockerListImages(sessionId),
    ])
    patch(sessionId, { containers, images, available: true, error: null, loading: false })
  } catch (e: unknown) {
    const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e)
    const cur = sessions.value[sessionId]
    if (!cur) return
    patch(sessionId, { error: cur.available ? msg : 'Docker 不可用: ' + msg, loading: false })
  } finally {
    inFlight.delete(sessionId)
  }
}

/** 启动某会话的 Docker 数据轮询 */
export function startDocker(sessionId: string) {
  if (!sessionId) return
  if (timers.has(sessionId)) return
  ensure(sessionId)
  // version 变化极少,单独拉取一次即可,不阻塞列表轮询
  void dockerVersion(sessionId).then((v) => {
    if (v) patch(sessionId, { version: v })
  })
  tick(sessionId, true)
  timers.set(sessionId, window.setInterval(() => tick(sessionId, false), INTERVAL_MS))
}

/** 停止轮询(保留已采集数据) */
export function stopDocker(sessionId: string) {
  const t = timers.get(sessionId)
  if (t != null) {
    clearInterval(t)
    timers.delete(sessionId)
  }
}

/** 停止轮询并清除某会话的 Docker 数据(tab 关闭 / 断开连接时调用) */
export function clearDocker(sessionId: string) {
  stopDocker(sessionId)
  inFlight.delete(sessionId)
  if (!sessions.value[sessionId]) return
  const next = { ...sessions.value }
  delete next[sessionId]
  sessions.value = next
}

/** 手动刷新某会话数据(显示 loading) */
export function refreshDocker(sessionId: string) {
  tick(sessionId, true)
}

/** 取某会话 Docker 状态(响应式) */
export function useDockerSession(sessionId: string) {
  return computed(() => sessions.value[sessionId] ?? null)
}
