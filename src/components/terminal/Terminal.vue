<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, nextTick, watch } from 'vue'
import { activeTabId } from '@/stores/tabs'
import { clearTerminalTrigger, clearScrollbackTrigger, copySelectionTrigger } from '@/stores/ui'
import { Badge } from '@/components/ui/badge'
import { StatusDot } from '@/components/ui/status-dot'
import { fontSize } from '@/stores/preferences'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  sshOpenShell,
  sshOpenExec,
  sshWrite,
  sshResize,
  sshCloseChannel,
  onChannelData,
  onChannelExit,
} from '@/api/ssh'
import { updateTab, closeTab } from '@/stores/tabs'

const props = defineProps<{
  tabId: string
  sessionId: string
  channelId: string | null
  /** 非空表示以 PTY exec 模式启动(如 docker exec -it),而非默认 shell */
  command?: string
}>()

const container = ref<HTMLDivElement | null>(null)
const term = shallowRef<Terminal | null>(null)
const fit = shallowRef<FitAddon | null>(null)
const status = ref<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
const errMsg = ref<string | null>(null)

let unlistenData: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null
let resizeObserver: ResizeObserver | null = null
let wheelHandler: ((e: WheelEvent) => void) | null = null
let currentChannelId: string | null = null

const encoder = new TextEncoder()

onMounted(async () => {
  if (!container.value) return

  const t = new Terminal({
    fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace',
    fontSize: fontSize.value,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    theme: {
      background: '#1e1f22',
      foreground: '#dfe1e5',
      cursor: '#a9adb3',
      selectionBackground: '#3b82f680',
      black: '#1e1f22',
      red: '#f14c4c',
      green: '#4ec9b0',
      yellow: '#d7ba7d',
      blue: '#3b82f6',
      magenta: '#c586c0',
      cyan: '#9cdcfe',
      white: '#dfe1e5',
      brightBlack: '#6f7379',
      brightRed: '#f97583',
      brightGreen: '#7ee787',
      brightYellow: '#ffdf5d',
      brightBlue: '#79b8ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#ffffff',
    },
  })
  const f = new FitAddon()
  t.loadAddon(f)
  t.loadAddon(new WebLinksAddon())
  t.open(container.value)
  t.focus()
  term.value = t
  fit.value = f

  // 首屏 fit 必须发生在 writeln 与 sshOpenShell 之前:
  // TerminalSplit 打开时 SFTP 占 40% 高度,若直接用 xterm 默认 80×24 开 shell,
  // 后端按 24 行分配 PTY,而可视区实际只有十来行,shell 首屏输出会落到不可见行,
  // 看起来就像被下方的 SFTP 面板遮挡。这里等一帧,让 flex 布局稳定后再 fit。
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  f.fit()

  t.writeln(`\x1b[90m正在连接 ${props.sessionId.slice(0, 8)}… \x1b[0m`)

  try {
    const { cols, rows } = t
    const chId =
      props.channelId ??
      (props.command
        ? await sshOpenExec(props.sessionId, props.command, cols, rows)
        : await sshOpenShell(props.sessionId, cols, rows))
    currentChannelId = chId
    updateTab(props.tabId, { channelId: chId } as any)
    status.value = 'connected'

    unlistenData = await onChannelData(chId, bytes => {
      t.write(bytes)
    })
    unlistenExit = await onChannelExit(chId, code => {
      status.value = 'closed'
      t.writeln(`\r\n\x1b[90m会话已结束(exit ${code ?? 'null'})\x1b[0m`)
    })

    t.onData(data => {
      if (currentChannelId) sshWrite(currentChannelId, encoder.encode(data))
    })

    // Ctrl+滚轮缩放终端字体(独立于全局偏好,仅当前终端)
    t.attachCustomKeyEventHandler(() => true)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const t = term.value
      const f = fit.value
      if (!t || !f) return
      const cur = t.options.fontSize ?? 13
      const next = e.deltaY < 0 ? Math.min(32, cur + 1) : Math.max(8, cur - 1)
      if (next === cur) return
      t.options.fontSize = next
      f.fit()
      const { cols, rows } = t
      if (currentChannelId) sshResize(currentChannelId, cols, rows)
    }
    container.value!.addEventListener('wheel', onWheel, { capture: true })
    wheelHandler = onWheel

    resizeObserver = new ResizeObserver(() => {
      f.fit()
      const { cols, rows } = t
      if (currentChannelId) sshResize(currentChannelId, cols, rows)
    })
    resizeObserver.observe(container.value!)
  } catch (e: any) {
    status.value = 'error'
    errMsg.value = typeof e === 'string' ? e : e?.message ?? String(e)
    t.writeln(`\r\n\x1b[31m连接失败: ${errMsg.value}\x1b[0m`)
  }
})

onBeforeUnmount(async () => {
  if (wheelHandler && container.value) {
    container.value.removeEventListener('wheel', wheelHandler, { capture: true } as EventListenerOptions)
  }
  resizeObserver?.disconnect()
  unlistenData?.()
  unlistenExit?.()
  if (currentChannelId) {
    try {
      await sshCloseChannel(currentChannelId)
    } catch {}
  }
  term.value?.dispose()
})

defineExpose({
  close() {
    closeTab(props.tabId)
  },
})

// 菜单「编辑 → 清屏」:仅活跃 tab 响应
watch(clearTerminalTrigger, () => {
  if (activeTabId.value !== props.tabId) return
  term.value?.clear()
})

// 菜单「编辑 → 清除滚动缓冲」:仅活跃 tab 响应
watch(clearScrollbackTrigger, () => {
  if (activeTabId.value !== props.tabId) return
  term.value?.write('\x1b[3J')
})

// 复制终端选区(Ctrl+Shift+C 或菜单):仅活跃 tab 响应
watch(copySelectionTrigger, async () => {
  if (activeTabId.value !== props.tabId) return
  const t = term.value
  if (!t) return
  const sel = t.getSelection()
  if (!sel) return
  try {
    await navigator.clipboard.writeText(sel)
  } catch {}
})

// 偏好设置字号变化:更新 xterm + refit + 通知后端 PTY resize
watch(fontSize, () => {
  if (activeTabId.value !== props.tabId) return
  const t = term.value
  const f = fit.value
  if (!t || !f) return
  t.options.fontSize = fontSize.value
  f.fit()
  const { cols, rows } = t
  if (currentChannelId) sshResize(currentChannelId, cols, rows)
})
</script>

<template>
  <div class="relative h-full w-full">
    <!-- 容器底色与 xterm 主题的 background 一致,避免终端 padding 区露出主背景色 -->
    <div ref="container" class="absolute inset-0 p-2 bg-[#1e1f22]" />
    <Badge
      v-if="status === 'connecting'"
      variant="secondary"
      class="text-caption pointer-events-auto absolute right-3 top-3 shadow-sm"
    >
      <StatusDot variant="warning" pulse />
      连接中…
    </Badge>
    <Badge
      v-else-if="status === 'error'"
      variant="destructive"
      class="text-caption pointer-events-auto absolute right-3 top-3 shadow-sm"
    >
      <StatusDot variant="destructive" />
      连接失败
    </Badge>
  </div>
</template>
