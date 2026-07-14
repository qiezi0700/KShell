import { computed, shallowRef } from 'vue'
import {
  dockerVersion,
  dockerListContainers,
  dockerListImages,
  dockerStats,
  dockerListVolumes,
  dockerListNetworks,
  dockerListStacks,
  type DockerContainer,
  type DockerImage,
  type DockerVersion,
  type DockerStats,
  type DockerVolume,
  type DockerNetwork,
  type DockerStack,
} from '@/api/docker'
import { isDockerPollAvailable } from '@/stores/docker-poll-result'

// 轮询间隔(ms)
const INTERVAL_MS = 5000

interface SessionDocker {
  available: boolean
  version: DockerVersion | null
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  stacks: DockerStack[]
  /** 容器资源占用,按容器短 ID 索引;stats 采集较慢,独立于主列表 */
  stats: Record<string, DockerStats>
  /** 仅首次加载与手动刷新为 true,后台轮询不触发,避免刷新按钮反复 spin */
  loading: boolean
  // 四类资源分别独立采集,失败也各自记录,互不影响展示
  containersError: string | null
  imagesError: string | null
  volumesError: string | null
  networksError: string | null
  stacksError: string | null
}

const sessions = shallowRef<Record<string, SessionDocker>>({})
// 定时器句柄不属于 UI 状态,单独用 Map 管理,避免进入响应式对象
const timers = new Map<string, number>()
// 主列表(容器/镜像)进行中请求守卫,避免轮询与手动刷新并发叠加
const inFlight = new Set<string>()
// stats 采集单独守卫,避免慢查询与主列表互相阻塞或叠加
const statsInFlight = new Set<string>()

function ensure(sessionId: string): SessionDocker {
  let s = sessions.value[sessionId]
  if (!s) {
    s = {
      available: false,
      version: null,
      containers: [],
      images: [],
      volumes: [],
      networks: [],
      stacks: [],
      stats: {},
      loading: false,
      containersError: null,
      imagesError: null,
      volumesError: null,
      networksError: null,
      stacksError: null,
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

// 把 docker CLI 抛出的错误归一成中文短消息
function errMsg(e: unknown, prefix: string): string {
  const raw = typeof e === 'string' ? e : (e as Error)?.message ?? String(e)
  return `${prefix}: ${raw}`
}

async function tick(sessionId: string, showLoading: boolean) {
  if (inFlight.has(sessionId)) return
  inFlight.add(sessionId)
  ensure(sessionId)
  if (showLoading) patch(sessionId, { loading: true })
  try {
    // 容器与镜像并行采集,各自独立成败:任一失败不影响另一类展示,
    // 也可让 UI 各自给出重试入口,而不是整体坍塌成空。
    const [cRes, iRes, vRes, nRes, sRes] = await Promise.allSettled([
      dockerListContainers(sessionId),
      dockerListImages(sessionId),
      dockerListVolumes(sessionId),
      dockerListNetworks(sessionId),
      dockerListStacks(sessionId),
    ])
    const pollAvailable = isDockerPollAvailable([cRes, iRes, vRes, nRes, sRes])
    const applyList = <T,>(
      r: PromiseSettledResult<T>,
      okKey: keyof SessionDocker,
      errKey: keyof SessionDocker,
      label: string,
    ) => {
      if (r.status === 'fulfilled') {
        patch(sessionId, { [okKey]: r.value, [errKey]: null } as Partial<SessionDocker>)
      } else {
        patch(sessionId, {
          [errKey]: pollAvailable
            ? errMsg(r.reason, `${label}刷新失败`)
            : 'Docker 不可用: ' + errMsg(r.reason, label),
        } as Partial<SessionDocker>)
      }
    }
    applyList(cRes, 'containers', 'containersError', '容器列表')
    applyList(iRes, 'images', 'imagesError', '镜像列表')
    applyList(vRes, 'volumes', 'volumesError', '卷列表')
    applyList(nRes, 'networks', 'networksError', '网络列表')
    applyList(sRes, 'stacks', 'stacksError', 'Compose 列表')
    patch(sessionId, { available: pollAvailable, loading: false })
    // stats 采集较慢(--no-stream 仍需秒级),不阻塞主列表 loading,独立异步刷新
    void refreshStats(sessionId)
  } finally {
    inFlight.delete(sessionId)
  }
}

/** 采集运行中容器的资源占用,按容器短 ID 建索引后写回状态 */
async function refreshStats(sessionId: string) {
  if (statsInFlight.has(sessionId)) return
  statsInFlight.add(sessionId)
  try {
    const list = await dockerStats(sessionId)
    const map: Record<string, DockerStats> = {}
    for (const s of list) map[s.container] = s
    patch(sessionId, { stats: map })
  } catch {
    // stats 失败不阻断主列表,静默保留上次数据
  } finally {
    statsInFlight.delete(sessionId)
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
  void tick(sessionId, true)
  timers.set(sessionId, window.setInterval(() => void tick(sessionId, false), INTERVAL_MS))
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
  statsInFlight.delete(sessionId)
  if (!sessions.value[sessionId]) return
  const next = { ...sessions.value }
  delete next[sessionId]
  sessions.value = next
}

/** 手动刷新某会话数据(显示 loading) */
export function refreshDocker(sessionId: string) {
  void tick(sessionId, true)
}

/** 取某会话 Docker 状态(响应式) */
export function useDockerSession(sessionId: string) {
  return computed(() => sessions.value[sessionId] ?? null)
}
