<script setup lang="ts">
import type { UnlistenFn } from '@tauri-apps/api/event'
import { v4 as uuidv4 } from 'uuid'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Clock, Copy, FileSearch, FileText, Filter, Pause, Play, RefreshCw, ScrollText } from '@lucide/vue'

import { dockerFindLogFiles, dockerLogs } from '@/api/docker'
import {
  onChannelData,
  onChannelError,
  onChannelExit,
  sshCloseChannel,
  sshOpenExec,
} from '@/api/ssh'
import { LatestOperationGuard } from '@/components/docker/latest-operation-guard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/stores/toast'

const props = defineProps<{
  open: boolean
  sessionId: string
  /** 容器 id;name 仅用作标题展示 */
  containerId: string | null
  containerName: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

// 保留最近的日志行数上限:防止 follow 模式下无限增长把内存吃满
const MAX_LINES = 5000

// 输入项
const path = ref('')          // 容器内文件路径;非空走 tail,否则走 docker logs
const tail = ref(200)         // 初始读取行数
const timestamps = ref(false) // 加 --timestamps 前缀
const filter = ref('')        // 客户端子串过滤,不影响服务端拉取
const follow = ref(false)     // 是否流式跟随

// 状态
const loading = ref(false)              // 一次性拉取的 loading
const lines = ref<string[]>([])         // 所有已收到的行(未过滤)
const streaming = ref(false)            // 当前是否连着长通道
const streamChannelId = ref<string | null>(null)
let streamUnlisteners: UnlistenFn[] = []
let streamDecoder: TextDecoder | null = null

const fetchGuard = new LatestOperationGuard()
const scanGuard = new LatestOperationGuard()
const streamGuard = new LatestOperationGuard()

// 日志文件候选列表(点"查找日志文件"后填充)
const logCandidates = ref<string[]>([])
const scanning = ref(false)
const pickerOpen = ref(false)

// 客户端过滤后的展示文本;filter 走大小写不敏感子串匹配
const filteredText = computed(() => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return lines.value.join('\n')
  return lines.value.filter((line) => line.toLowerCase().includes(kw)).join('\n')
})

const bodyRef = ref<HTMLDivElement | null>(null)

// 上次 chunk 末尾未收满一行的残段,拼到下一 chunk 头再切
let pending = ''

async function scrollToBottom() {
  await nextTick()
  const el = bodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function appendChunk(text: string) {
  const combined = pending + text
  const parts = combined.split(/\r?\n/)
  pending = parts.pop() ?? ''
  if (parts.length === 0) return
  const next = lines.value.concat(parts)
  // 截尾保留最近 MAX_LINES 行,避免内存无限增长
  lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
  void scrollToBottom()
}

function isDialogContextCurrent(sessionId: string, containerId: string): boolean {
  return props.open && props.sessionId === sessionId && props.containerId === containerId
}

function disposeUnlisteners(unlisteners: UnlistenFn[]) {
  for (const unlisten of unlisteners) unlisten()
}

async function closeChannelSafely(channelId: string) {
  try {
    await sshCloseChannel(channelId)
  } catch {
    // 通道可能已被服务端关闭,忽略
  }
}

function flushPendingLine() {
  if (!pending) return
  const next = lines.value.concat([pending])
  lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
  pending = ''
  void scrollToBottom()
}

// 一次性拉取只允许最新请求写入状态,避免旧容器响应覆盖当前弹窗。
async function fetchOnce() {
  const containerId = props.containerId
  if (!props.open || !containerId) return

  const sessionId = props.sessionId
  const requestVersion = fetchGuard.begin()
  const requestedPath = path.value.trim()
  const requestedTail = tail.value
  const requestedTimestamps = timestamps.value
  loading.value = true

  await stopStream()
  if (!fetchGuard.isCurrent(requestVersion) || !isDialogContextCurrent(sessionId, containerId)) {
    return
  }

  lines.value = []
  pending = ''
  try {
    const text = await dockerLogs(
      sessionId,
      containerId,
      requestedTail,
      requestedPath || undefined,
    )
    if (!fetchGuard.isCurrent(requestVersion) || !isDialogContextCurrent(sessionId, containerId)) {
      return
    }

    let nextLines = text.split(/\r?\n/)
    if (requestedTimestamps && requestedPath) {
      nextLines = ['(提示:tail 文件模式无 --timestamps,时间戳仅对 docker logs 生效)', ...nextLines]
    }
    const bodyText = nextLines.join('').trim()
    if (!requestedPath && bodyText.length < 4) {
      nextLines = [
        '(docker logs 无输出。若应用日志被写入容器内文件,请点上方"扫描日志文件"选择路径)',
      ]
    }
    lines.value = nextLines
    void scrollToBottom()
  } catch (e: unknown) {
    if (fetchGuard.isCurrent(requestVersion) && isDialogContextCurrent(sessionId, containerId)) {
      lines.value = [`加载日志失败: ${String(e)}`]
    }
  } finally {
    if (fetchGuard.isCurrent(requestVersion)) loading.value = false
  }
}

// 扫描结果同样绑定当前容器,切换目标后丢弃旧响应。
async function scanLogFiles() {
  const containerId = props.containerId
  if (!props.open || !containerId || scanning.value) return

  const sessionId = props.sessionId
  const requestVersion = scanGuard.begin()
  scanning.value = true
  try {
    const list = await dockerFindLogFiles(sessionId, containerId)
    if (!scanGuard.isCurrent(requestVersion) || !isDialogContextCurrent(sessionId, containerId)) {
      return
    }

    logCandidates.value = list
    if (list.length === 0) {
      toast.info('未找到候选日志文件(容器可能没装 sh/find,或应用只写 stdout)')
    } else {
      pickerOpen.value = true
    }
  } catch (e: unknown) {
    if (scanGuard.isCurrent(requestVersion) && isDialogContextCurrent(sessionId, containerId)) {
      toast.error(String(e), '扫描失败')
    }
  } finally {
    if (scanGuard.isCurrent(requestVersion)) scanning.value = false
  }
}

function pickLogPath(selectedPath: string) {
  path.value = selectedPath
  pickerOpen.value = false
  void fetchOnce()
}

// 每次流式跟随拥有独立代次,旧通道事件不能停止或污染新流。
async function startStream() {
  const containerId = props.containerId
  if (streaming.value || !props.open || !containerId) return

  const sessionId = props.sessionId
  const requestedPath = path.value.trim()
  const n = Math.min(Math.max(Math.floor(tail.value), 0), 5000)
  let cmd: string
  if (requestedPath) {
    if (!/^\/[a-zA-Z0-9/_.:@#+=-]+$/.test(requestedPath)) {
      toast.error('日志路径不合法(需绝对路径,不允许空格或 shell 元字符)')
      return
    }
    cmd = `docker exec ${containerId} tail -n ${n} -F ${requestedPath} 2>&1`
  } else {
    const ts = timestamps.value ? '--timestamps ' : ''
    cmd = `docker logs -f --tail ${n} ${ts}${containerId} 2>&1`
  }

  fetchGuard.invalidate()
  loading.value = false
  const streamVersion = streamGuard.begin()
  const channelId = uuidv4()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  const localUnlisteners: UnlistenFn[] = []
  let listenersAdopted = false
  streaming.value = true
  follow.value = true
  pending = ''

  const isCurrentStream = () => (
    streamGuard.isCurrent(streamVersion) && isDialogContextCurrent(sessionId, containerId)
  )
  const abandonSetup = async () => {
    disposeUnlisteners(localUnlisteners)
    if (streamGuard.isCurrent(streamVersion)) await stopStream(streamVersion)
  }

  try {
    localUnlisteners.push(await onChannelData(channelId, (bytes) => {
      if (!streamGuard.isCurrent(streamVersion)) return
      appendChunk(decoder.decode(bytes, { stream: true }))
    }))
    localUnlisteners.push(await onChannelExit(channelId, () => {
      void stopStream(streamVersion)
    }))
    localUnlisteners.push(await onChannelError(channelId, (message) => {
      if (!streamGuard.isCurrent(streamVersion)) return
      appendChunk(`\n[通道错误] ${message}\n`)
      void stopStream(streamVersion)
    }))

    if (!streamGuard.isCurrent(streamVersion) || !isDialogContextCurrent(sessionId, containerId)) {
      disposeUnlisteners(localUnlisteners)
      return
    }

    streamUnlisteners = localUnlisteners
    streamDecoder = decoder
    streamChannelId.value = channelId
    listenersAdopted = true
    await sshOpenExec(sessionId, cmd, 200, 40, channelId)

    if (!streamGuard.isCurrent(streamVersion) || !isDialogContextCurrent(sessionId, containerId)) {
      await closeChannelSafely(channelId)
    }
  } catch (e: unknown) {
    if (!listenersAdopted) disposeUnlisteners(localUnlisteners)
    if (streamGuard.isCurrent(streamVersion) && isDialogContextCurrent(sessionId, containerId)) {
      await stopStream(streamVersion)
      toast.error(String(e), '流式日志启动失败')
    } else {
      await closeChannelSafely(channelId)
    }
  }
}

async function stopStream(expectedVersion?: number) {
  if (expectedVersion !== undefined && !streamGuard.isCurrent(expectedVersion)) return

  streamGuard.invalidate()
  follow.value = false
  streaming.value = false
  const channelId = streamChannelId.value
  const decoder = streamDecoder
  const unlisteners = streamUnlisteners
  streamChannelId.value = null
  streamDecoder = null
  streamUnlisteners = []
  disposeUnlisteners(unlisteners)

  const decoderTail = decoder?.decode() ?? ''
  if (decoderTail) pending += decoderTail
  flushPendingLine()

  if (channelId) await closeChannelSafely(channelId)
}

function toggleFollow() {
  if (streaming.value) void stopStream()
  else void startStream()
}

async function copyLog() {
  const text = filteredText.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success('日志已复制到剪贴板')
  } catch {
    toast.error('复制失败,请手动选择文本')
  }
}

// 打开、关闭或切换目标时使旧请求失效,并为新容器重置输入状态。
watch(
  () => [props.open, props.sessionId, props.containerId] as const,
  ([open, sessionId, containerId], previous) => {
    const wasOpen = previous?.[0] ?? false
    const contextChanged = previous?.[1] !== sessionId || previous?.[2] !== containerId

    if (open && containerId) {
      if (!wasOpen || contextChanged) {
        path.value = ''
        filter.value = ''
        timestamps.value = false
        tail.value = 200
        scanGuard.invalidate()
        scanning.value = false
        pickerOpen.value = false
        logCandidates.value = []
      }
      void fetchOnce()
      return
    }

    fetchGuard.invalidate()
    scanGuard.invalidate()
    loading.value = false
    scanning.value = false
    pickerOpen.value = false
    void stopStream()
    lines.value = []
    pending = ''
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  fetchGuard.invalidate()
  scanGuard.invalidate()
  void stopStream()
})
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-4xl w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gap-2">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ScrollText class="size-4" />
          <span>容器日志:{{ containerName }}</span>
          <span v-if="streaming" class="text-caption text-success flex items-center gap-1">
            <span class="size-1.5 rounded-full bg-success animate-pulse" /> 跟随中
          </span>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                class="ml-auto"
                :disabled="loading"
                @click="fetchOnce"
              >
                <RefreshCw class="size-3.5" :class="loading && 'animate-spin'" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ streaming ? '停止跟随并重取' : '刷新' }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                :class="streaming && 'text-success'"
                @click="toggleFollow"
              >
                <Pause v-if="streaming" class="size-3.5" />
                <Play v-else class="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ streaming ? '停止跟随' : '开始跟随(docker logs -f)' }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                :class="timestamps && 'text-primary'"
                @click="timestamps = !timestamps"
              >
                <Clock class="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ timestamps ? '关闭时间戳' : '显示时间戳(下次拉取生效)' }}</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" :disabled="!lines.length" @click="copyLog">
            <Copy class="size-3.5" />
          </Button>
        </DialogTitle>
        <DialogDescription class="sr-only">查看、筛选和持续跟随容器日志</DialogDescription>
      </DialogHeader>

      <!-- 路径 + 扫描 + tail 行数 -->
      <div class="flex items-center gap-1.5">
        <div class="relative flex-1">
          <FileText class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="path"
            placeholder="容器内日志路径(留空使用 docker logs)"
            class="h-7 pl-7 text-body"
            @keydown.enter="fetchOnce"
          />
        </div>
        <DropdownMenu v-model:open="pickerOpen">
          <DropdownMenuTrigger as-child>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1.5 px-2"
                  :disabled="scanning"
                  @click.prevent="scanLogFiles"
                >
                  <FileSearch class="size-3.5" :class="scanning && 'animate-pulse'" />
                  <span class="text-body">扫描</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>扫描容器内日志文件(Java 等把日志写到文件时用)</TooltipContent>
            </Tooltip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="max-w-[520px]">
            <div class="px-2 py-1 text-caption text-muted-foreground">
              找到 {{ logCandidates.length }} 个候选(按大小排序,点选即可加载)
            </div>
            <DropdownMenuItem
              v-for="p in logCandidates"
              :key="p"
              class="font-mono text-caption"
              @select="pickLogPath(p)"
            >
              {{ p }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          v-model.number="tail"
          type="number"
          min="10"
          max="5000"
          step="50"
          class="h-7 w-20 text-body"
          title="初始读取行数"
        />
      </div>
      <div class="relative">
        <Filter class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="filter"
          placeholder="过滤(子串,大小写不敏感,仅前端筛选)"
          class="h-7 pl-7 text-body"
        />
      </div>

      <div
        ref="bodyRef"
        class="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/30 p-3 font-mono text-caption"
        :style="{ maxHeight: '55vh' }"
      >
        <span v-if="loading && !lines.length" class="text-muted-foreground">加载中…</span>
        <pre v-else class="whitespace-pre-wrap break-words text-foreground">{{ filteredText }}</pre>
      </div>
    </DialogContent>
  </Dialog>
</template>
