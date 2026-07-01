<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ListTree,
  ChevronDown,
  X,
  Ban,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { transfersRef, activeCount, clearFinished, cancelTransfer } from '@/stores/transfers'

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
  <div
    v-if="hasItems"
    class="pointer-events-auto w-full rounded-lg border border-border bg-popover shadow-lg"
  >
    <!-- 标题栏(可折叠) -->
    <button
      class="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-medium"
      @click="expanded = !expanded"
    >
      <ListTree class="size-3.5 shrink-0 text-primary" />
      <span>传输队列</span>
      <span class="text-muted-foreground">({{ transfersRef.length }})</span>
      <span
        v-if="activeCount > 0"
        class="flex items-center gap-1 text-primary"
      >
        <Loader2 class="size-3 animate-spin" />
        {{ activeCount }} 进行中
      </span>
      <ChevronDown
        class="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform"
        :class="!expanded && '-rotate-90'"
      />
    </button>

    <!-- 展开时显示列表 -->
    <div v-if="expanded" class="border-t border-border">
      <div class="flex items-center justify-end px-2 py-1">
        <Button variant="ghost" size="sm" class="h-5 text-[10px]" @click="clearFinished">
          <Trash2 class="size-3" /> 清除已完成
        </Button>
      </div>
      <ScrollArea class="max-h-[260px]">
        <div
          v-for="t in transfersRef"
          :key="t.id"
          class="flex items-center gap-2 px-3 py-1 text-[11px]"
        >
          <ArrowRight v-if="t.direction === 'upload'" class="size-3 shrink-0 text-primary" />
          <ArrowLeft v-else class="size-3 shrink-0 text-success" />
          <span class="w-32 shrink-0 truncate" :title="t.name">{{ t.name }}</span>
          <div class="flex-1">
            <div class="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                class="h-full rounded-full transition-all"
                :class="t.status === 'error' ? 'bg-destructive' : t.status === 'done' ? 'bg-success' : 'bg-primary'"
                :style="{ width: pct(t) + '%' }"
              />
            </div>
          </div>
          <span class="w-9 shrink-0 text-right text-muted-foreground">{{ pct(t) }}%</span>
          <Loader2 v-if="t.status === 'transferring'" class="size-3 shrink-0 animate-spin text-primary" />
          <CheckCircle2 v-else-if="t.status === 'done'" class="size-3 shrink-0 text-success" />
          <AlertCircle v-else-if="t.status === 'error'" class="size-3 shrink-0 text-destructive" />
          <Ban v-else-if="t.status === 'cancelled'" class="size-3 shrink-0 text-muted-foreground" />
          <span v-else class="w-3 shrink-0" />
          <!-- 取消按钮:仅进行中/等待中可点 -->
          <button
            v-if="t.status === 'transferring' || t.status === 'pending'"
            class="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive"
            :title="'取消'"
            @click="cancelTransfer(t.id)"
          >
            <X class="size-3" />
          </button>
          <span v-else class="w-4 shrink-0" />
        </div>
      </ScrollArea>
    </div>
  </div>
</template>
