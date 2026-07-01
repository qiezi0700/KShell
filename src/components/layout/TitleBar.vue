<script setup lang="ts">
import { ref } from 'vue'
import { Minus, Square, X, Github } from 'lucide-vue-next'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import AboutDialog from '@/components/dialogs/AboutDialog.vue'
import ShortcutsDialog from '@/components/dialogs/ShortcutsDialog.vue'
import PreferencesDialog from '@/components/dialogs/PreferencesDialog.vue'
import { openNewConnection } from '@/stores/dialogs'
import { openConfirm } from '@/stores/prompt'
import { tabs } from '@/stores/tabs'
import { sidebarVisible, statusBarVisible, clearTerminal, clearScrollback } from '@/stores/ui'

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

const aboutRef = ref<InstanceType<typeof AboutDialog> | null>(null)
const shortcutsRef = ref<InstanceType<typeof ShortcutsDialog> | null>(null)
const prefsRef = ref<InstanceType<typeof PreferencesDialog> | null>(null)

async function openAbout() {
  aboutRef.value?.open()
}

async function openShortcuts() {
  shortcutsRef.value?.open()
}

async function openPreferences() {
  prefsRef.value?.open()
}

async function openGithub() {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open('https://github.com/anomalyco/opencode')
  }
}

async function quitApp() {
  const activeCount = tabs.value.filter((t) => t.type === 'terminal').length
  if (activeCount > 0) {
    const ok = await openConfirm({
      title: '退出 KShell',
      message: `当前有 ${activeCount} 个活跃连接,确定退出吗?`,
      confirmText: '退出',
      cancelText: '取消',
      destructive: true,
    })
    if (!ok) return
  }
  await withWindow('close')
}
</script>

<template>
  <div
    data-tauri-drag-region
    class="flex shrink-0 items-center border-b border-border bg-titlebar"
    :style="{ height: 'var(--size-titlebar)' }"
  >
    <div data-tauri-drag-region class="flex h-full items-center gap-1.5 pl-2.5 pr-2">
      <span class="flex items-center justify-center rounded-[3px] bg-gradient-to-br from-primary to-violet-500 font-bold text-white" :style="{ width: 'var(--size-icon-sm)', height: 'var(--size-icon-sm)', fontSize: 'var(--text-xs)' }">K</span>
      <span class="font-medium text-foreground" :style="{ fontSize: 'var(--text-sm)' }">KShell</span>
    </div>

    <div data-tauri-drag-region class="flex h-full items-center gap-0.5 px-1">
      <!-- 文件 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" :style="{ height: 'var(--size-row-sm)', fontSize: 'var(--text-sm)' }">
            文件
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem @select="openNewConnection()">
            新建连接…
            <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            导入会话…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            导出会话…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="quitApp()">
            退出
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 编辑 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" :style="{ height: 'var(--size-row-sm)', fontSize: 'var(--text-sm)' }">
            编辑
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem @select="clearTerminal()">
            清屏
          </DropdownMenuItem>
          <DropdownMenuItem @select="clearScrollback()">
            清除滚动缓冲
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="openPreferences()">
            偏好设置…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 视图 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" :style="{ height: 'var(--size-row-sm)', fontSize: 'var(--text-sm)' }">
            视图
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem @select="sidebarVisible = !sidebarVisible">
            {{ sidebarVisible ? '隐藏' : '显示' }}侧边栏
            <DropdownMenuShortcut>Ctrl+B</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem @select="statusBarVisible = !statusBarVisible">
            {{ statusBarVisible ? '隐藏' : '显示' }}状态栏
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 工具 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" :style="{ height: 'var(--size-row-sm)', fontSize: 'var(--text-sm)' }">
            工具
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled>
            命令面板…
            <DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            管理已知主机…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            设置…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- 帮助 -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="rounded-sm px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground" :style="{ height: 'var(--size-row-sm)', fontSize: 'var(--text-sm)' }">
            帮助
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem @select="openAbout()">
            关于 KShell
          </DropdownMenuItem>
          <DropdownMenuItem @select="openGithub()">
            <Github class="size-3.5" />
            GitHub 仓库
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="openShortcuts()">
            快捷键参考
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div data-tauri-drag-region class="h-full flex-1" />

    <div class="flex h-full">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            :style="{ width: 'var(--size-control)' }"
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
            class="flex h-full items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            :style="{ width: 'var(--size-control)' }"
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
            class="flex h-full items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
            :style="{ width: 'var(--size-control)' }"
            @click="close"
          >
            <X class="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>关闭</TooltipContent>
      </Tooltip>
    </div>

    <AboutDialog ref="aboutRef" />
    <ShortcutsDialog ref="shortcutsRef" />
    <PreferencesDialog ref="prefsRef" />
  </div>
</template>
