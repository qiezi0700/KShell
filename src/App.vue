<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import TitleBar from './components/layout/TitleBar.vue'
import SessionSidebar from './components/layout/SessionSidebar.vue'
import WorkArea from './components/layout/WorkArea.vue'
import StatusBar from './components/layout/StatusBar.vue'
import NewConnectionDialog from './components/dialogs/NewConnectionDialog.vue'
import ConfirmDialog from './components/dialogs/ConfirmDialog.vue'
import PromptDialog from './components/dialogs/PromptDialog.vue'
import PasswordPromptDialog from './components/dialogs/PasswordPromptDialog.vue'
import TransferPanel from './components/sftp/TransferPanel.vue'
import ToastContainer from './components/dialogs/ToastContainer.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { initHostKeyGuard, destroyHostKeyGuard } from '@/stores/host-key'

onMounted(() => {
  initHostKeyGuard().catch(() => {})
})

onBeforeUnmount(() => {
  destroyHostKeyGuard()
})
</script>

<template>
  <TooltipProvider>
    <div class="flex h-full flex-col bg-background" @contextmenu.prevent>
      <TitleBar />
      <div class="flex min-h-0 flex-1">
        <SessionSidebar />
        <WorkArea />
      </div>
      <StatusBar />
    </div>
    <NewConnectionDialog />
    <ConfirmDialog />
    <PromptDialog />
    <PasswordPromptDialog />
    <!-- 右上角浮动区:传输队列 + 消息提示,垂直堆叠 -->
    <div class="pointer-events-none fixed right-3 top-[38px] z-40 flex w-[340px] flex-col gap-2">
      <TransferPanel />
      <ToastContainer />
    </div>
  </TooltipProvider>
</template>
