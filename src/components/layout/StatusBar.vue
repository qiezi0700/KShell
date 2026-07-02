<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'
import { tabs, activeTabId, type Tab } from '@/stores/tabs'
import { statusActions } from '@/stores/status-actions'

// 活跃终端会话数
const sessionCount = computed(() => tabs.value.filter((t) => t.type === 'terminal').length)
const activeTab = computed<Tab | null>(() =>
  activeTabId.value ? tabs.value.find((t) => t.id === activeTabId.value) ?? null : null,
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
    <template v-for="a in statusActions" :key="a.id">
      <Button
        v-if="activeTab && a.visible(activeTab)"
        variant="ghost"
        size="xs"
        :title="a.label(activeTab)"
        @click="a.run(activeTab)"
      >
        <component :is="a.icon" class="size-3.5" />
        {{ a.label(activeTab) }}
      </Button>
    </template>
    <span>UTF-8</span>
    <span>LF</span>
    <span class="tabular-nums">v0.1.0</span>
  </footer>
</template>
