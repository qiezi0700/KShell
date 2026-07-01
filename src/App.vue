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
    <div class="flex h-full flex-col bg-background">
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
  </TooltipProvider>
</template>
