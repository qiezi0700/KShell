<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { PanelBottomClose, PanelBottomOpen } from 'lucide-vue-next'
import Terminal from '@/components/terminal/Terminal.vue'
import SftpView from '@/components/sftp/SftpView.vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  tabId: string
  sessionId: string
  channelId: string | null
  host: string
  user: string
}>()

// SFTP 面板可见性。默认打开。
const sftpVisible = ref(true)
// SFTP 占容器高度百分比(10-80)。默认 40。
const sftpHeightPct = ref(40)

// 拖拽中
const dragging = ref(false)
const containerEl = ref<HTMLDivElement | null>(null)

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
  sftpHeightPct.value = Math.max(10, Math.min(80, Math.round(pct)))
}

function onUp() {
  dragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', onUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(() => {
  // 等布局完成后触发一次 resize,让 xterm 的 FitAddon 正确计算首屏尺寸
  nextTick(() => {
    window.dispatchEvent(new Event('resize'))
  })
})

onBeforeUnmount(() => {
  if (dragging.value) onUp()
})
</script>

<template>
  <div ref="containerEl" class="relative flex h-full flex-col">
    <!-- 上半:终端(flex-grow 按比例分配,flex-basis:0 避免溢出) -->
    <div
      class="min-h-0 overflow-hidden"
      :style="{ flexGrow: sftpVisible ? terminalFlex : 1, flexBasis: '0px' }"
    >
      <Terminal
        :tab-id="tabId"
        :session-id="sessionId"
        :channel-id="channelId"
      />
    </div>

    <!-- 可拖拽分隔条 + SFTP 切换按钮 -->
    <div
      v-if="sftpVisible"
      class="group relative h-[3px] shrink-0 cursor-row-resize bg-border hover:bg-primary/50"
      @mousedown="onDividerDown"
    >
      <div class="absolute left-1/2 top-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 group-hover:bg-primary" />
    </div>

    <!-- SFTP 切换按钮(始终在终端右下角) -->
    <Button
      variant="outline"
      size="xs"
      class="absolute bottom-2 right-3 z-10 bg-popover hover:bg-muted"
      :title="sftpVisible ? '隐藏文件管理' : '显示文件管理'"
      @click="toggleSftp"
    >
      <PanelBottomClose v-if="sftpVisible" class="size-3.5" />
      <PanelBottomOpen v-else class="size-3.5" />
      <span>SFTP</span>
    </Button>

    <!-- 下半:SFTP -->
    <div
      v-if="sftpVisible"
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
