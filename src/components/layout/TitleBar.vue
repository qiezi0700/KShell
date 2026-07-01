<script setup lang="ts">
import { Minus, Square, X } from 'lucide-vue-next'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function withWindow(op: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  if (op === 'minimize') await w.minimize()
  else if (op === 'toggleMaximize') await w.toggleMaximize()
  else await w.close()
}
const minimize = () => withWindow('minimize')
const toggleMaximize = () => withWindow('toggleMaximize')
const close = () => withWindow('close')

const menus = ['文件', '编辑', '视图', '工具', '帮助']
</script>

<template>
  <div
    data-tauri-drag-region
    class="flex h-8 shrink-0 items-center border-b border-border bg-titlebar"
  >
    <div data-tauri-drag-region class="flex h-full items-center gap-1.5 pl-2.5 pr-2">
      <span class="flex size-[18px] items-center justify-center rounded-[3px] bg-gradient-to-br from-primary to-violet-500 text-[11px] font-bold text-white">K</span>
      <span class="text-[12px] font-medium text-foreground">KShell</span>
    </div>

    <div data-tauri-drag-region class="flex h-full items-center gap-0.5 px-1">
      <button
        v-for="m in menus"
        :key="m"
        class="h-6 rounded-sm px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {{ m }}
      </button>
    </div>

    <div data-tauri-drag-region class="h-full flex-1" />

    <div class="flex h-full">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[46px] items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="minimize"
          >
            <Minus class="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>最小化</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[46px] items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="toggleMaximize"
          >
            <Square class="size-2.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>最大化</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[46px] items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
            @click="close"
          >
            <X class="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>关闭</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
