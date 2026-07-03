<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { ScrollText, Copy, RefreshCw, FileText, Play, Pause, Filter, Clock, FileSearch } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/stores/toast'
import { dockerLogs, dockerFindLogFiles } from '@/api/docker'
import {
  sshOpenExec,
  sshCloseChannel,
  onChannelData,
  onChannelExit,
} from '@/api/ssh'
import type { UnlistenFn } from '@tauri-apps/api/event'

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
let unlistenData: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null

// 日志文件候选列表(点"查找日志文件"后填充)
const logCandidates = ref<string[]>([])
const scanning = ref(false)
const pickerOpen = ref(false)

// 客户端过滤后的展示文本;filter 走大小写不敏感子串匹配
const filteredText = computed(() => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return lines.value.join('\n')
  return lines.value.filter((l) => l.toLowerCase().includes(kw)).join('\n')
})

const bodyRef = ref<HTMLDivElement | null>(null)

// TextDecoder 流式模式;跨 chunk 的 utf-8 边界不会切坏
const decoder = new TextDecoder('utf-8', { fatal: false })
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
  scrollToBottom()
}

// 一次性拉取:关闭现有流,清空缓冲,调 dockerLogs
async function fetchOnce() {
  await stopStream()
  lines.value = []
  pending = ''
  loading.value = true
  try {
    const text = await dockerLogs(props.sessionId, props.containerId!, tail.value, path.value || undefined)
    lines.value = text.split(/\r?\n/)
    if (timestamps.value && path.value) {
      // tail 文件模式没时间戳可加,提示一下
      lines.value = ['(提示:tail 文件模式无 --timestamps,时间戳仅对 docker logs 生效)', ...lines.value]
    }
    // 空/近似空提示 —— 常见于 Java 容器把日志写到文件,docker logs 什么也看不到
    const bodyText = lines.value.join('').trim()
    if (!path.value && bodyText.length < 4) {
      lines.value = [
        '(docker logs 无输出。若应用日志被写入容器内文件,请点上方"扫描日志文件"选择路径)',
      ]
    }
    scrollToBottom()
  } catch (e: unknown) {
    lines.value = [`加载日志失败: ${String(e)}`]
  } finally {
    loading.value = false
  }
}

// 扫描容器内候选日志文件路径,填入 dropdown 供用户挑选
async function scanLogFiles() {
  if (!props.containerId || scanning.value) return
  scanning.value = true
  try {
    const list = await dockerFindLogFiles(props.sessionId, props.containerId)
    logCandidates.value = list
    if (list.length === 0) {
      toast.info('未找到候选日志文件(容器可能没装 sh/find,或应用只写 stdout)')
    } else {
      pickerOpen.value = true
    }
  } catch (e: unknown) {
    toast.error(String(e), '扫描失败')
  } finally {
    scanning.value = false
  }
}

function pickLogPath(p: string) {
  path.value = p
  pickerOpen.value = false
  fetchOnce()
}

// 启动流式跟随:走 sshOpenExec 长通道跑 `docker logs -f` 或 `tail -f`
async function startStream() {
  if (streaming.value || !props.containerId) return
  // 组装命令
  const id = props.containerId
  const n = Math.min(Math.max(Math.floor(tail.value), 0), 5000)
  let cmd: string
  const p = path.value.trim()
  if (p) {
    // 校验路径避免注入,直接用 tail -F 跟随(-F 处理文件轮转)
    if (!/^\/[a-zA-Z0-9/_.:@#+=-]+$/.test(p)) {
      toast.error('日志路径不合法(需绝对路径,不允许空格或 shell 元字符)')
      return
    }
    cmd = `docker exec ${id} tail -n ${n} -F ${p} 2>&1`
  } else {
    const ts = timestamps.value ? '--timestamps ' : ''
    cmd = `docker logs -f --tail ${n} ${ts}${id} 2>&1`
  }

  // 尺寸随便传,follow 走非交互,PTY 不影响文本
  let chId: string
  try {
    chId = await sshOpenExec(props.sessionId, cmd, 200, 40)
  } catch (e: unknown) {
    toast.error(String(e), '流式日志启动失败')
    return
  }
  streamChannelId.value = chId
  streaming.value = true
  follow.value = true
  pending = ''

  unlistenData = await onChannelData(chId, (bytes) => {
    // ArrayBuffer/Uint8Array 都可能,TextDecoder 都能吃
    const text = decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { stream: true })
    appendChunk(text)
  })
  unlistenExit = await onChannelExit(chId, () => {
    stopStream()
  })
}

async function stopStream() {
  follow.value = false
  streaming.value = false
  const chId = streamChannelId.value
  streamChannelId.value = null
  unlistenData?.()
  unlistenExit?.()
  unlistenData = null
  unlistenExit = null
  if (chId) {
    try {
      await sshCloseChannel(chId)
    } catch {
      // 通道可能已被服务端关闭,忽略
    }
  }
  // flush pending 半行避免最后一行丢失
  if (pending) {
    const next = lines.value.concat([pending])
    lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    pending = ''
  }
}

function toggleFollow() {
  if (streaming.value) stopStream()
  else startStream()
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

// 打开/切换容器时重置并拉取一次
watch(
  () => [props.open, props.containerId] as const,
  ([open, id], prev) => {
    const prevOpen = prev ? prev[0] : false
    if (open && id) {
      // 从关闭切到打开时清空上次输入,避免上一个容器的路径/过滤串到下一个
      if (!prevOpen) {
        path.value = ''
        filter.value = ''
        timestamps.value = false
        tail.value = 200
      }
      fetchOnce()
    } else if (!open) {
      // 弹窗关闭:停流、清缓冲
      stopStream()
      lines.value = []
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopStream()
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
                @click="streaming ? stopStream() : fetchOnce()"
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
