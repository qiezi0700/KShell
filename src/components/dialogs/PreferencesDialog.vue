<script setup lang="ts">
import { ref, computed } from 'vue'
import { Sun, Moon, Monitor, Minus, Plus } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Switch } from '@/components/ui/switch'
import { themeMode, themeColorId, themeColors, fontSize, syncKnownHostsToSystem, type ThemeMode } from '@/stores/preferences'

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
    <DialogContent class="max-w-[440px]">
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
          :spacing="1"
          class="grid w-full grid-cols-3 gap-2"
          @update:model-value="(v) => v && (themeMode = v as ThemeMode)"
        >
          <ToggleGroupItem
            v-for="m in modes"
            :key="m.id"
            :value="m.id"
            class="text-body flex-col gap-1.5 py-3 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
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

      <!-- 字体大小 -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-caption text-muted-foreground">字体大小</span>
          <Button variant="ghost" size="xs" class="text-muted-foreground hover:text-foreground" @click="resetFont">
            重置
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            class="text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            :disabled="fontSize <= MIN_FONT"
            @click="decFont"
          >
            <Minus class="size-3.5" />
          </Button>
          <Slider
            :model-value="[fontSize]"
            :min="MIN_FONT"
            :max="MAX_FONT"
            :step="1"
            class="flex-1"
            @update:model-value="(v) => { if (v?.[0] != null) fontSize = v[0] }"
          />
          <Button
            variant="outline"
            size="icon"
            class="text-muted-foreground hover:bg-panel-2 hover:text-foreground"
            :disabled="fontSize >= MAX_FONT"
            @click="incFont"
          >
            <Plus class="size-3.5" />
          </Button>
          <span class="text-body w-12 text-right font-mono tabular-nums text-foreground">{{ fontSize }}px</span>
        </div>
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
