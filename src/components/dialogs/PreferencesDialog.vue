<script setup lang="ts">
import { ref, computed } from 'vue'
import { Sun, Moon, Monitor, Minus, Plus } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { themeMode, themeColorId, themeColors, fontSize, type ThemeMode } from '@/stores/preferences'

const open = ref(false)

defineExpose({ open: () => (open.value = true) })

const modes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '明亮', icon: Sun },
  { id: 'dark', label: '暗黑', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
]

const currentColor = computed(() => themeColors.find((c) => c.id === themeColorId.value) ?? themeColors[0])

const MIN_FONT = 10
const MAX_FONT = 18

function decFont() {
  fontSize.value = Math.max(MIN_FONT, fontSize.value - 1)
}
function incFont() {
  fontSize.value = Math.min(MAX_FONT, fontSize.value + 1)
}
function resetFont() {
  fontSize.value = 13
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle class="text-[15px]">偏好设置</DialogTitle>
        <DialogDescription class="text-[length:var(--text-xs)]">个性化 KShell 外观</DialogDescription>
      </DialogHeader>

      <!-- 主题模式 -->
      <div class="space-y-2">
        <div class="text-[length:var(--text-sm)] font-medium text-foreground">主题模式</div>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="m in modes"
            :key="m.id"
            class="flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-[length:var(--text-sm)] transition-colors"
            :class="themeMode === m.id
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="themeMode = m.id"
          >
            <component :is="m.icon" class="size-4" />
            {{ m.label }}
          </button>
        </div>
      </div>

      <!-- 主题色 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[length:var(--text-sm)] font-medium text-foreground">主题色</span>
          <span class="text-[length:var(--text-xs)] text-muted-foreground">{{ currentColor.label }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in themeColors"
            :key="c.id"
            class="flex size-7 items-center justify-center rounded-full border-2 transition-all"
            :style="{ backgroundColor: `oklch(0.62 0.19 ${c.hue})` }"
            :class="themeColorId === c.id
              ? 'border-foreground ring-2 ring-offset-2 ring-offset-background'
              : 'border-transparent hover:scale-110'"
            :title="c.label"
            @click="themeColorId = c.id"
          >
            <svg
              v-if="themeColorId === c.id"
              class="size-3.5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 字体大小 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-[length:var(--text-sm)] font-medium text-foreground">字体大小</span>
          <button
            class="text-[length:var(--text-xs)] text-muted-foreground hover:text-foreground"
            @click="resetFont"
          >
            重置
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            :disabled="fontSize <= MIN_FONT"
            @click="decFont"
          >
            <Minus class="size-3.5" />
          </button>
          <input
            type="range"
            :min="MIN_FONT"
            :max="MAX_FONT"
            :step="1"
            :value="fontSize"
            class="flex-1 accent-primary"
            @input="fontSize = Number(($event.target as HTMLInputElement).value)"
          />
          <button
            class="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            :disabled="fontSize >= MAX_FONT"
            @click="incFont"
          >
            <Plus class="size-3.5" />
          </button>
          <span class="w-12 text-right font-mono text-[length:var(--text-sm)] text-foreground">{{ fontSize }}px</span>
        </div>
      </div>

      <!-- 预览 -->
      <div class="rounded-md border border-border bg-panel p-3">
        <div class="mb-2 text-[length:var(--text-xs)] text-muted-foreground">预览</div>
        <div class="flex items-center gap-2">
          <span class="rounded-md bg-primary px-2.5 py-1 text-[length:var(--text-xs)] text-primary-foreground">主色按钮</span>
          <span class="rounded-md border border-border bg-background px-2.5 py-1 text-[length:var(--text-xs)] text-foreground">普通按钮</span>
          <span class="rounded-md bg-success/15 px-2.5 py-1 text-[length:var(--text-xs)] text-success">成功</span>
          <span class="rounded-md bg-destructive/15 px-2.5 py-1 text-[length:var(--text-xs)] text-destructive">危险</span>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
