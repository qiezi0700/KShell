<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
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
import { initTheme, destroyTheme } from '@/stores/preferences'
import { sidebarVisible, statusBarVisible } from '@/stores/ui'
import { sidebarWidth, sidebarResizing } from '@/stores/sidebar-panels'
import { activeMonitorSessionId, startMonitor, stopMonitor } from '@/stores/monitor'

onMounted(() => {
  initTheme()
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
    <div class="flex h-full flex-col bg-background">
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
    <!-- 右上角浮动区:传输队列 + 消息提示,垂直堆叠 -->
    <div class="pointer-events-none fixed right-3 top-[38px] z-40 flex w-[340px] flex-col gap-2">
      <TransferPanel />
      <ToastContainer />
    </div>
  </TooltipProvider>
</template>
