<script setup lang="ts">
import {
  X,
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
} from 'lucide-vue-next'
import { toastItems, toast } from '@/stores/toast'

const iconMap = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
}

const colorMap = {
  error: 'text-destructive',
  success: 'text-success',
  info: 'text-primary',
  warning: 'text-warning',
}
</script>

<template>
  <div class="flex w-full flex-col items-end gap-2">
    <TransitionGroup
      tag="div"
      class="flex w-full flex-col gap-2"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-x-4 opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="translate-x-4 opacity-0"
    >
      <div
        v-for="t in toastItems"
        :key="t.id"
        class="pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border border-border bg-popover p-3 shadow-lg"
      >
        <component
          :is="iconMap[t.type]"
          class="mt-0.5 size-4 shrink-0"
          :class="colorMap[t.type]"
        />
        <div class="min-w-0 flex-1">
          <div class="text-[length:var(--text-sm)] font-medium text-foreground">{{ t.title }}</div>
          <div v-if="t.message" class="mt-0.5 break-words text-[length:var(--text-xs)] text-muted-foreground">{{ t.message }}</div>
        </div>
        <button
          class="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          @click="toast.dismiss(t.id)"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
