<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import TitleBar from './components/layout/TitleBar.vue'
import SessionSidebar from './components/layout/SessionSidebar.vue'
import WorkArea from './components/layout/WorkArea.vue'
import StatusBar from './components/layout/StatusBar.vue'
import NewConnectionDialog from './components/dialogs/NewConnectionDialog.vue'
import ConfirmDialog from './components/dialogs/ConfirmDialog.vue'
import PromptDialog from './components/dialogs/PromptDialog.vue'
import PasswordPromptDialog from './components/dialogs/PasswordPromptDialog.vue'
import MonitorDialog from './components/dialogs/MonitorDialog.vue'
import KeyManagerDialog from './components/dialogs/KeyManagerDialog.vue'
import CommandPalette from './components/dialogs/CommandPalette.vue'
import TransferPanel from './components/sftp/TransferPanel.vue'
import ToastContainer from './components/dialogs/ToastContainer.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { initHostKeyGuard, destroyHostKeyGuard } from '@/stores/host-key'
import { initTheme, destroyTheme } from '@/stores/preferences'
import { sidebarVisible, statusBarVisible } from '@/stores/ui'
import { activeMonitorSessionId, startMonitor, stopMonitor } from '@/stores/monitor'

onMounted(() => {
  initTheme()
  initHostKeyGuard().catch(() => {})
})

// 监控轮询跟随活跃终端 tab:切到终端则启动,切走则停止
watch(activeMonitorSessionId, (sid, prev) => {
  if (prev && prev !== sid) stopMonitor(prev)
  if (sid) startMonitor(sid)
})

onBeforeUnmount(() => {
  destroyTheme()
  destroyHostKeyGuard()
})
</script>

<template>
  <TooltipProvider>
    <div class="flex h-full flex-col bg-background">
      <TitleBar />
      <SidebarProvider
        :open="sidebarVisible"
        class="flex min-h-0 flex-1"
        :style="{ '--sidebar-width': '220px' }"
        @update:open="(v: boolean) => (sidebarVisible = v)"
      >
        <SessionSidebar />
        <SidebarInset class="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <WorkArea />
          <StatusBar v-show="statusBarVisible" />
        </SidebarInset>
      </SidebarProvider>
    </div>
    <NewConnectionDialog />
    <ConfirmDialog />
    <PromptDialog />
    <PasswordPromptDialog />
    <MonitorDialog />
    <KeyManagerDialog />
    <CommandPalette />
    <!-- 右上角浮动区:传输队列 + 消息提示,垂直堆叠 -->
    <div class="pointer-events-none fixed right-3 top-[38px] z-40 flex w-[340px] flex-col gap-2">
      <TransferPanel />
      <ToastContainer />
    </div>
  </TooltipProvider>
</template>
