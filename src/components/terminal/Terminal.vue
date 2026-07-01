<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  sshOpenShell,
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
}>()

const container = ref<HTMLDivElement | null>(null)
const term = shallowRef<Terminal | null>(null)
const fit = shallowRef<FitAddon | null>(null)
const status = ref<'connecting' | 'connected' | 'closed' | 'error'>('connecting')
const errMsg = ref<string | null>(null)

let unlistenData: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null
let resizeObserver: ResizeObserver | null = null
let currentChannelId: string | null = null

const encoder = new TextEncoder()

onMounted(async () => {
  if (!container.value) return

  const t = new Terminal({
    fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace',
    fontSize: 13,
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
  f.fit()
  t.focus()
  term.value = t
  fit.value = f

  t.writeln(`\x1b[90m正在连接 ${props.sessionId.slice(0, 8)}… \x1b[0m`)

  try {
    const { cols, rows } = t
    const chId = props.channelId ?? (await sshOpenShell(props.sessionId, cols, rows))
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
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="container" class="absolute inset-0 p-2 bg-[#1e1f22]" />
    <div
      v-if="status === 'connecting'"
      class="pointer-events-none absolute right-3 top-3 rounded-sm bg-muted/80 px-2 py-1 text-[10px] text-muted-foreground"
    >
      连接中…
    </div>
    <div
      v-else-if="status === 'error'"
      class="pointer-events-none absolute right-3 top-3 rounded-sm bg-destructive/80 px-2 py-1 text-[10px] text-white"
    >
      连接失败
    </div>
  </div>
</template>
