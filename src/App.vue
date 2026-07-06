<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import TitleBar from './components/layout/TitleBar.vue'
import SessionSidebar from './components/layout/SessionSidebar.vue'
import WorkArea from './components/layout/WorkArea.vue'
import StatusBar from './components/layout/StatusBar.vue'
import TransferPanel from './components/sftp/TransferPanel.vue'
import ToastContainer from './components/dialogs/ToastContainer.vue'
import { overlays } from '@/stores/overlays'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { initHostKeyGuard, destroyHostKeyGuard } from '@/stores/host-key'
import { initKiGuard, destroyKiGuard } from '@/stores/ki-prompt'
import { initPreferences, initTheme, destroyTheme } from '@/stores/preferences'
import { sidebarVisible, statusBarVisible } from '@/stores/ui'
import { sidebarWidth, sidebarResizing, initSidebarWidth } from '@/stores/sidebar-panels'
import { activeMonitorSessionId, startMonitor, stopMonitor } from '@/stores/monitor'
import { initQuickCommands } from '@/stores/quick-commands'

// SQLite 设置加载完毕前不渲染主 UI,避免偏好/布局闪烁
const settingsReady = ref(false)

onMounted(async () => {
  // 并行加载全局设置:偏好 / 快捷指令 / 侧栏宽度
  await Promise.all([
    initPreferences(),
    initQuickCommands(),
    initSidebarWidth(),
  ])
  // 偏好就位后再应用主题,确保用真实值生效
  initTheme()
  // 放行主 UI 渲染
  settingsReady.value = true
  // 不依赖设置的后台守护,放行后异步启动
  initHostKeyGuard().catch(() => {})
  initKiGuard().catch(() => {})
})

// 监控轮询跟随活跃终端 tab:切到终端则启动,切走则停止
watch(activeMonitorSessionId, (sid, prev) => {
  if (prev && prev !== sid) stopMonitor(prev)
  if (sid) startMonitor(sid)
})

onBeforeUnmount(() => {
  destroyTheme()
  destroyHostKeyGuard()
  destroyKiGuard()
})
</script>

<template>
  <TooltipProvider>
    <div v-if="settingsReady" class="flex h-full flex-col bg-background">
      <TitleBar />
      <SidebarProvider
        :open="sidebarVisible"
        class="flex min-h-0 flex-1"
        :style="{ '--sidebar-width': sidebarWidth + 'px' }"
        :data-resizing="sidebarResizing"
        @update:open="(v: boolean) => (sidebarVisible = v)"
      >
        <SessionSidebar />
        <SidebarInset class="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <WorkArea />
          <StatusBar v-show="statusBarVisible" />
        </SidebarInset>
      </SidebarProvider>
    </div>
    <component v-for="(o, i) in overlays" :key="i" :is="o" />
    <!-- 右上角浮动区:传输队列 -->
    <div v-if="settingsReady" class="pointer-events-none fixed right-3 top-[38px] z-40 flex w-[340px] flex-col gap-2">
      <TransferPanel />
    </div>
    <!-- 消息提示:必须在弹窗之上,参照 --reka-dialog-z -->
    <div class="pointer-events-none fixed right-3 top-[38px] z-[calc(var(--reka-dialog-z,50)+20)] flex w-[340px] flex-col gap-2">
      <ToastContainer />
    </div>
  </TooltipProvider>
</template>
