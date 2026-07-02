<script setup lang="ts">
import { computed } from 'vue'
import { Activity } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { tabs, activeTabId } from '@/stores/tabs'
import { monitorDialogOpen } from '@/stores/monitor'

// 活跃终端会话数
const sessionCount = computed(() => tabs.value.filter((t) => t.type === 'terminal').length)
const hasActive = computed(
  () => activeTabId.value != null && tabs.value.find((t) => t.id === activeTabId.value)?.type === 'terminal',
)
</script>

<template>
  <footer class="text-body flex shrink-0 items-center gap-3 border-t border-border bg-titlebar px-2 text-muted-foreground" :style="{ height: 'var(--size-statusbar)' }">
    <span class="inline-flex items-center gap-1.5">
      <StatusDot variant="success" />
      就绪
    </span>
    <span class="tabular-nums">{{ sessionCount }} 会话</span>
    <span class="flex-1" />
    <Button
      v-if="hasActive"
      variant="ghost"
      size="xs"
      title="服务器监控"
      @click="monitorDialogOpen = true"
    >
      <Activity class="size-3.5" />
      监控
    </Button>
    <span>UTF-8</span>
    <span>LF</span>
    <span class="tabular-nums">v0.1.0</span>
  </footer>
</template>
