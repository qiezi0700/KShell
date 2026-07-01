<script setup lang="ts">
import { ref } from 'vue'
import { Github, Heart } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const open = ref(false)

defineExpose({ open: () => (open.value = true) })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[360px]">
      <DialogHeader>
        <div class="mb-3 flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-md bg-gradient-to-br from-primary to-violet-500 text-[18px] font-bold text-white">K</span>
          <div>
            <DialogTitle class="text-[16px]">KShell</DialogTitle>
            <DialogDescription class="text-[length:var(--text-xs)]">跨平台 SSH 桌面客户端</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div class="space-y-2 text-[length:var(--text-sm)] text-muted-foreground">
        <div class="flex justify-between">
          <span>版本</span>
          <span class="text-foreground">0.1.0</span>
        </div>
        <div class="flex justify-between">
          <span>技术栈</span>
          <span class="text-foreground">Tauri 2 · Vue 3 · Rust</span>
        </div>
        <div class="flex justify-between">
          <span>许可</span>
          <span class="text-foreground">MIT</span>
        </div>
      </div>

      <div class="flex gap-2 pt-2">
        <a
          href="https://github.com/anomalyco/opencode"
          target="_blank"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-foreground hover:bg-muted"
        >
          <Github class="size-3.5" />
          GitHub
        </a>
        <a
          href="https://opencode.ai"
          target="_blank"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[length:var(--text-sm)] text-foreground hover:bg-muted"
        >
          <Heart class="size-3.5" />
          反馈
        </a>
      </div>
    </DialogContent>
  </Dialog>
</template>
