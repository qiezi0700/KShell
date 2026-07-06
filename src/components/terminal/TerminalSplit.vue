<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { PanelBottomClose, PanelBottomOpen } from '@lucide/vue'
import Terminal from '@/components/terminal/Terminal.vue'
import SftpView from '@/components/sftp/SftpView.vue'
import QuickCommandFab from '@/components/terminal/QuickCommandFab.vue'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { settingsGet, settingsSet } from '@/api/settings'
import { activeTabId } from '@/stores/tabs'
import { setActiveTerminalSender, canSendToTerminal } from '@/stores/active-terminal'

const props = defineProps<{
  tabId: string
  sessionId: string
  channelId: string | null
  host: string
  user: string
  /** 是否附带 SFTP 面板;exec 终端(如进容器)传 false */
  withSftp?: boolean
  /** exec 模式启动命令(如 docker exec -it <c> sh),透传给底层 Terminal */
  command?: string
}>()

// 是否附带 SFTP 面板;exec 终端(进容器)不附带
const hasSftp = props.withSftp ?? true
// SFTP 面板可见性。默认打开。
const sftpVisible = ref(hasSftp)
// SFTP 占容器高度百分比(10-80)。默认 40。持久化到 SQLite settings
// ref 先用默认值,onMounted 异步从 SQLite 加载真实值
const sftpHeightPct = ref(40)
let sftpHeightReady = false

// 拖拽中
const dragging = ref(false)
const containerEl = ref<HTMLDivElement | null>(null)

// Terminal 组件 ref:用于 QuickCommandFab 转发 sendCommand
const terminalRef = ref<InstanceType<typeof Terminal> | null>(null)
function onQuickCommand(cmd: string) {
  terminalRef.value?.sendCommand(cmd)
}

// 活跃终端注册:切到本 tab 时注册 sendCommand,供侧栏代码片段面板调用
watch(
  activeTabId,
  (cur) => {
    if (cur === props.tabId) {
      canSendToTerminal.value = true
      setActiveTerminalSender((cmd: string) => terminalRef.value?.sendCommand(cmd))
    } else if (canSendToTerminal.value) {
      // 切走时清空发送权
      canSendToTerminal.value = false
      setActiveTerminalSender(null)
    }
  },
  { immediate: true },
)

// 终端 flex 比例 = 100 - SFTP 比例;flex-basis:0 确保严格按比例分配
const terminalFlex = computed(() => 100 - sftpHeightPct.value)
const sftpFlex = computed(() => sftpHeightPct.value)

function toggleSftp() {
  sftpVisible.value = !sftpVisible.value
}

function onDividerDown(e: MouseEvent) {
  e.preventDefault()
  dragging.value = true
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

function onDrag(e: MouseEvent) {
  if (!dragging.value || !containerEl.value) return
  const rect = containerEl.value.getBoundingClientRect()
  const fromBottom = rect.bottom - e.clientY
  const pct = (fromBottom / rect.height) * 100
  const clamped = Math.max(10, Math.min(80, Math.round(pct)))
  sftpHeightPct.value = clamped
  if (sftpHeightReady) void settingsSet('terminal-sftp-height-pct', String(clamped))
}

function onUp() {
  dragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', onUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(() => {
  // 异步从 SQLite 加载 SFTP 高度百分比,加载完才允许回写,避免默认值覆盖
  if (hasSftp) {
    void settingsGet('terminal-sftp-height-pct').then((raw) => {
      if (raw != null) {
        const n = Number(raw)
        if (Number.isFinite(n)) sftpHeightPct.value = Math.min(Math.max(Math.round(n), 10), 80)
      }
      sftpHeightReady = true
    })
  }
  // 等布局完成后触发一次 resize,让 xterm 的 FitAddon 正确计算首屏尺寸
  nextTick(() => {
    window.dispatchEvent(new Event('resize'))
  })
})

onBeforeUnmount(() => {
  if (dragging.value) onUp()
  // 卸载时若是当前活跃终端,清空发送权
  if (canSendToTerminal.value) {
    canSendToTerminal.value = false
    setActiveTerminalSender(null)
  }
})
</script>

<template>
  <div ref="containerEl" class="relative flex h-full flex-col">
    <!-- 上半:终端(flex-grow 按比例分配,flex-basis:0 避免溢出) -->
    <div
      class="min-h-0 overflow-hidden"
      :style="{ flexGrow: sftpVisible && hasSftp ? terminalFlex : 1, flexBasis: '0px' }"
    >
      <Terminal
        ref="terminalRef"
        :tab-id="tabId"
        :session-id="sessionId"
        :channel-id="channelId"
        :command="command"
      />
    </div>

    <!-- 可拖拽分隔条 + SFTP 切换按钮 -->
    <div
      v-if="hasSftp && sftpVisible"
      class="group relative h-[3px] shrink-0 cursor-row-resize bg-border hover:bg-primary/50"
      @mousedown="onDividerDown"
    >
      <div class="absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 group-hover:bg-primary" />
    </div>

    <!-- 快捷指令 FAB:带 SFTP 时为 SFTP 圆钮让位;不带 SFTP 时贴右下角 -->
    <QuickCommandFab
      :offset-right="hasSftp ? '3.5rem' : '0.75rem'"
      @send="onQuickCommand"
    />

    <!-- SFTP 切换按钮:圆形悬浮按钮,常驻终端右下角 -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          v-if="hasSftp"
          type="button"
          class="absolute bottom-3 right-3 z-10 inline-flex size-9 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-md ring-1 ring-black/5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          @click="toggleSftp"
        >
          <PanelBottomClose v-if="sftpVisible" class="size-4" />
          <PanelBottomOpen v-else class="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{{ sftpVisible ? '隐藏文件管理' : '显示文件管理' }}</TooltipContent>
    </Tooltip>

    <!-- 下半:SFTP -->
    <div
      v-if="hasSftp && sftpVisible"
      class="min-h-0 overflow-hidden border-t border-border"
      :style="{ flexGrow: sftpFlex, flexBasis: '0px' }"
    >
      <SftpView
        :tab-id="tabId"
        :session-id="sessionId"
        :sftp-id="null"
        :host="host"
        :user="user"
      />
    </div>
  </div>
</template>
