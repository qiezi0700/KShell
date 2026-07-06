<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ArrowRight,
  ArrowLeft,
  Copy,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ListTree,
  ChevronDown,
  X,
  Ban,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { transfersRef, activeCount, clearFinished, cancelTransfer, removeTransfer } from '@/stores/transfers'

const expanded = ref(false)

const hasItems = computed(() => transfersRef.value.length > 0)

function fmtSize(n: number) {
  if (n === 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function pct(t: { transferred: number; total: number }) {
  if (t.total === 0) return 0
  return Math.min(100, Math.round((t.transferred / t.total) * 100))
}
</script>

<template>
  <!-- 传输队列卡片(在 App.vue 的右上角容器内) -->
  <Collapsible
    v-if="hasItems"
    v-model:open="expanded"
    class="pointer-events-auto w-full rounded-lg border border-border bg-popover shadow-lg"
  >
    <!-- 标题栏(可折叠) -->
    <CollapsibleTrigger as-child>
      <button
        class="text-body flex w-full items-center gap-2 px-3 py-2 font-medium"
      >
      <ListTree class="size-3.5 shrink-0 text-primary" />
      <span>传输队列</span>
      <span class="text-caption font-normal tabular-nums text-muted-foreground normal-case tracking-normal">{{ transfersRef.length }}</span>
      <span
        v-if="activeCount > 0"
        class="text-caption flex items-center gap-1 font-normal tracking-normal normal-case text-primary"
      >
        <Loader2 class="size-3.5 animate-spin" />
        {{ activeCount }} 进行中
      </span>
      <ChevronDown
        class="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform"
        :class="!expanded && '-rotate-90'"
      />
      </button>
    </CollapsibleTrigger>

    <!-- 展开时显示列表 -->
    <CollapsibleContent class="border-t border-border">
      <div class="flex items-center justify-end px-2 py-1.5">
        <Button variant="ghost" size="xs" @click="clearFinished">
          <Trash2 /> 清除已完成
        </Button>
      </div>
      <ScrollArea class="max-h-[260px]">
        <div
          v-for="t in transfersRef"
          :key="t.id"
          class="text-body flex items-center gap-2 px-3 py-1.5"
        >
          <ArrowRight
            v-if="t.direction === 'upload' || t.direction === 'uploadDir'"
            class="size-3.5 shrink-0 text-primary"
          />
          <Copy v-else-if="t.direction === 'copyRemote'" class="size-3.5 shrink-0 text-primary" />
          <ArrowLeft v-else class="size-3.5 shrink-0 text-success" />
          <span class="w-32 shrink-0 truncate" :title="t.name">{{ t.name }}</span>
          <Progress
            :model-value="pct(t)"
            class="h-1 flex-1 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
            :style="{ '--bar-color': t.status === 'error' ? 'var(--color-destructive)' : t.status === 'done' ? 'var(--color-success)' : 'var(--color-primary)' }"
          />
          <span class="w-9 shrink-0 text-right tabular-nums text-muted-foreground">{{ pct(t) }}%</span>
          <Loader2 v-if="t.status === 'transferring'" class="size-3.5 shrink-0 animate-spin text-primary" />
          <CheckCircle2 v-else-if="t.status === 'done'" class="size-3.5 shrink-0 text-success" />
          <AlertCircle v-else-if="t.status === 'error'" class="size-3.5 shrink-0 text-destructive" />
          <Ban v-else-if="t.status === 'cancelled'" class="size-3.5 shrink-0 text-muted-foreground" />
          <span v-else class="w-3.5 shrink-0" />
          <!-- 取消按钮:仅进行中/等待中可点 -->
          <Button
            v-if="t.status === 'transferring' || t.status === 'pending'"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 hover:bg-panel-2 hover:text-destructive"
            title="取消"
            @click="cancelTransfer(t.id)"
          >
            <X class="size-3.5" />
          </Button>
          <!-- 删除按钮:已结束任务可单条移除 -->
          <Button
            v-else
            variant="ghost"
            size="icon-sm"
            class="shrink-0 hover:bg-panel-2 hover:text-foreground"
            title="从列表移除"
            @click="removeTransfer(t.id)"
          >
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </ScrollArea>
    </CollapsibleContent>
  </Collapsible>
</template>
