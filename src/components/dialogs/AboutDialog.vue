<script setup lang="ts">
import { ref } from 'vue'
import { Github, Heart } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const open = ref(false)

defineExpose({ open: () => (open.value = true) })
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[380px]">
      <DialogHeader>
        <div class="mb-2 flex items-center gap-3">
          <span class="flex size-10 items-center justify-center rounded-md bg-gradient-to-br from-primary to-violet-500 text-[20px] font-semibold text-white shadow-sm">K</span>
          <div class="min-w-0">
            <DialogTitle class="text-[16px]">KShell</DialogTitle>
            <DialogDescription>跨平台 SSH 桌面客户端</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Card class="text-body gap-2 rounded-md border-border bg-panel p-3 text-muted-foreground shadow-none">
        <div class="flex justify-between">
          <span>版本</span>
          <span class="tabular-nums font-mono text-foreground">0.1.0</span>
        </div>
        <div class="flex justify-between">
          <span>技术栈</span>
          <span class="text-foreground">Tauri 2 · Vue 3 · Rust</span>
        </div>
        <div class="flex justify-between">
          <span>许可</span>
          <span class="text-foreground">MIT</span>
        </div>
      </Card>

      <div class="flex gap-2 pt-1">
        <Button as-child variant="outline" class="text-body flex-1 border-border text-foreground hover:bg-panel-2 hover:border-primary/40">
          <a href="https://github.com/qiezi0700/KShell" target="_blank">
            <Github class="size-3.5" />
            GitHub
          </a>
        </Button>
        <Button as-child variant="outline" class="text-body flex-1 border-border text-foreground hover:bg-panel-2 hover:border-primary/40">
          <a href="https://github.com/qiezi0700/KShell/issues" target="_blank">
            <Heart class="size-3.5" />
            反馈
          </a>
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
