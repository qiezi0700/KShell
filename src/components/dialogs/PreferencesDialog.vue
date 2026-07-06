<script setup lang="ts">
import { ref, computed } from 'vue'
import { Sun, Moon, Monitor } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Switch } from '@/components/ui/switch'
import {
  themeMode,
  themeColorId,
  themeColors,
  UI_SIZE_LEVELS,
  fontSize,
  syncKnownHostsToSystem,
  terminalFontFamily,
  terminalLineHeight,
  terminalScrollback,
  terminalPadding,
  SCROLLBACK_LEVELS,
  TERMINAL_FONT_OPTIONS,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  DEFAULT_TERMINAL_PADDING,
  type ThemeMode,
} from '@/stores/preferences'

const open = ref(false)

defineExpose({ open: () => (open.value = true) })

const modes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '明亮', icon: Sun },
  { id: 'dark', label: '暗黑', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
]

const currentColor = computed(() => themeColors.find((c) => c.id === themeColorId.value) ?? themeColors[0])

const currentLevel = computed(() => UI_SIZE_LEVELS.find((l) => l.fontSize === fontSize.value) ?? UI_SIZE_LEVELS[1])

const selectedLevelId = computed({
  get: () => currentLevel.value.id,
  set: (id: string) => setLevel(id),
})

function setLevel(id: string) {
  const level = UI_SIZE_LEVELS.find((l) => l.id === id)
  if (level) fontSize.value = level.fontSize
}

function resetFont() {
  fontSize.value = UI_SIZE_LEVELS[1].fontSize
}

// 终端字体:Select 绑定 family 字符串,不匹配预设时回退到第一个
const selectedFontFamily = computed({
  get: () => {
    const found = TERMINAL_FONT_OPTIONS.find((f) => f.family === terminalFontFamily.value)
    return found ? found.family : TERMINAL_FONT_OPTIONS[0].family
  },
  set: (family: string) => {
    terminalFontFamily.value = family
  },
})

function resetTerminalFont() {
  terminalFontFamily.value = DEFAULT_TERMINAL_FONT_FAMILY
}

function resetTerminalLineHeight() {
  terminalLineHeight.value = DEFAULT_TERMINAL_LINE_HEIGHT
}

function resetTerminalPadding() {
  terminalPadding.value = DEFAULT_TERMINAL_PADDING
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[440px] max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>偏好设置</DialogTitle>
        <DialogDescription>个性化 KShell 外观</DialogDescription>
      </DialogHeader>

      <!-- 主题模式 -->
      <div class="space-y-2">
        <div class="text-caption text-muted-foreground">主题模式</div>
        <ToggleGroup
          type="single"
          :model-value="themeMode"
          variant="outline"
          size="lg"
          :spacing="1"
          class="grid w-full grid-cols-3 gap-2"
          @update:model-value="(v) => v && (themeMode = v as ThemeMode)"
        >
          <ToggleGroupItem
            v-for="m in modes"
            :key="m.id"
            :value="m.id"
            class="text-body flex-col gap-1.5 py-3 h-auto data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
          >
            <component :is="m.icon" class="size-4" />
            {{ m.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <!-- 主题色 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">主题色</span>
          <span class="text-body text-muted-foreground">{{ currentColor.label }}</span>
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

      <!-- 界面字号 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">界面字号</span>
          <Button variant="ghost" size="xs" class="text-muted-foreground hover:text-foreground" @click="resetFont">
            重置
          </Button>
        </div>
        <ToggleGroup
          v-model="selectedLevelId"
          type="single"
          variant="outline"
          size="sm"
          :spacing="1"
          class="grid w-full grid-cols-4"
        >
          <ToggleGroupItem
            v-for="l in UI_SIZE_LEVELS"
            :key="l.id"
            :value="l.id"
            class="text-body h-auto flex-col gap-1 py-2 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
          >
            <span class="text-title">{{ l.label }}</span>
            <span class="text-caption text-muted-foreground">{{ l.fontSize }}px</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <!-- 终端字体族 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">终端字体</span>
          <Button variant="ghost" size="xs" class="text-muted-foreground hover:text-foreground" @click="resetTerminalFont">
            重置
          </Button>
        </div>
        <Select v-model="selectedFontFamily">
          <SelectTrigger class="h-[var(--control-sm)] text-body">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="f in TERMINAL_FONT_OPTIONS" :key="f.family" :value="f.family">
              {{ f.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 终端行高 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">终端行高</span>
          <Button variant="ghost" size="xs" class="text-muted-foreground hover:text-foreground" @click="resetTerminalLineHeight">
            重置
          </Button>
        </div>
        <Slider
          :model-value="[terminalLineHeight]"
          :min="1"
          :max="1.5"
          :step="0.05"
          @update:model-value="(v) => v && (terminalLineHeight = v[0])"
        />
        <div class="text-caption text-muted-foreground tabular-nums text-right">{{ terminalLineHeight.toFixed(2) }}</div>
      </div>

      <!-- 滚动缓冲行数 -->
      <div class="space-y-2">
        <div class="text-caption text-muted-foreground">滚动缓冲行数</div>
        <ToggleGroup
          :model-value="String(terminalScrollback)"
          type="single"
          variant="outline"
          size="sm"
          :spacing="1"
          class="grid w-full grid-cols-5"
          @update:model-value="(v) => v && (terminalScrollback = Number(v))"
        >
          <ToggleGroupItem
            v-for="l in SCROLLBACK_LEVELS"
            :key="l.value"
            :value="String(l.value)"
            class="text-body h-auto py-2 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
          >
            {{ l.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <!-- 终端内边距 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">终端内边距</span>
          <Button variant="ghost" size="xs" class="text-muted-foreground hover:text-foreground" @click="resetTerminalPadding">
            重置
          </Button>
        </div>
        <Slider
          :model-value="[terminalPadding]"
          :min="0"
          :max="16"
          :step="1"
          @update:model-value="(v) => v && (terminalPadding = v[0])"
        />
        <div class="text-caption text-muted-foreground tabular-nums text-right">{{ terminalPadding }}px</div>
      </div>

      <!-- 安全:known_hosts 同步 -->
      <div class="flex items-center justify-between">
        <div class="space-y-0.5">
          <div class="text-caption text-foreground">同步到系统 known_hosts</div>
          <div class="text-caption text-muted-foreground">
            信任新主机时同时写入 ~/.ssh/known_hosts,供系统 SSH 客户端复用
          </div>
        </div>
        <Switch v-model:checked="syncKnownHostsToSystem" />
      </div>

      <!-- 预览:三态徽章对齐,统一用 bg-{color}/15 text-{color} 结构 -->
      <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
        <div class="text-caption mb-2 text-muted-foreground">预览</div>
        <div class="flex flex-wrap items-center gap-2">
          <Badge class="text-body rounded-md px-2.5 py-1">主色按钮</Badge>
          <Badge variant="secondary" class="text-body rounded-md bg-panel-2 px-2.5 py-1 text-foreground">普通按钮</Badge>
          <Badge class="text-body rounded-md bg-success/15 px-2.5 py-1 text-success">成功</Badge>
          <Badge variant="destructive" class="text-body rounded-md bg-destructive/15 px-2.5 py-1 text-destructive">危险</Badge>
        </div>
      </Card>
    </DialogContent>
  </Dialog>
</template>
