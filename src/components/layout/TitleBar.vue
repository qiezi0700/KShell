<script setup lang="ts">
import { ref, computed } from 'vue'
import { Minus, Square, X } from '@lucide/vue'
import GithubIcon from '@/components/ui/GithubIcon.vue'
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
import KnownHostsDialog from '@/components/dialogs/KnownHostsDialog.vue'
import { openNewConnection } from '@/stores/dialogs'
import { openConfirm } from '@/stores/prompt'
import { tabs, activeTabId } from '@/stores/tabs'
import { sidebarVisible, statusBarVisible, clearTerminal, clearScrollback } from '@/stores/ui'
import { monitorDialogOpen } from '@/stores/monitor'
import { openKeyManager } from '@/stores/keys'
import { openCommandPalette } from '@/stores/command-palette'
import { importSessions, exportSessions } from '@/stores/sessions'
import { isMac, modKey } from '@/lib/platform'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// 当前是否有活跃终端会话(决定"服务器监控"菜单是否可用)
const hasActiveTerminal = computed(
  () => activeTabId.value != null && tabs.value.find((t) => t.id === activeTabId.value)?.type === 'terminal',
)

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
const knownHostsRef = ref<InstanceType<typeof KnownHostsDialog> | null>(null)

async function openAbout() {
  aboutRef.value?.open()
}

async function openShortcuts() {
  shortcutsRef.value?.open()
}

async function openPreferences() {
  prefsRef.value?.open()
}

async function openKnownHosts() {
  knownHostsRef.value?.open()
}

async function openGithub() {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open('https://github.com/qiezi0700/KShell')
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
    <!-- macOS 交通灯占位:overlay 模式下需左侧留白避免遮挡 -->
    <div v-if="isMac" data-tauri-drag-region class="h-full shrink-0" :style="{ width: '78px' }" />

    <div data-tauri-drag-region class="flex h-full items-center gap-1.5 pl-2.5 pr-2">
      <span class="flex items-center justify-center rounded-sm bg-gradient-to-br from-primary to-violet-500 font-semibold text-white" :style="{ width: 'var(--size-icon-sm)', height: 'var(--size-icon-sm)', fontSize: 'var(--text-xs)' }">K</span>
      <span class="text-title text-foreground">KShell</span>
    </div>

    <div data-tauri-drag-region class="flex h-full items-center gap-0.5 px-1.5">
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
            <DropdownMenuShortcut>{{ modKey }}+N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="importSessions()">
            导入会话…
          </DropdownMenuItem>
          <DropdownMenuItem @select="exportSessions()">
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
            <DropdownMenuShortcut>{{ modKey }}+B</DropdownMenuShortcut>
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
          <DropdownMenuItem @select="openCommandPalette()">
            命令面板…
            <DropdownMenuShortcut>{{ modKey }}+K</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!hasActiveTerminal" @select="monitorDialogOpen = true">
            服务器监控…
          </DropdownMenuItem>
          <DropdownMenuItem @select="openKeyManager()">
            SSH 密钥库…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="openKnownHosts()">
            管理已知主机…
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
            <GithubIcon class="size-3.5" />
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

    <!-- Windows/Linux 自定义窗口按钮;macOS 使用原生交通灯 -->
    <div v-if="!isMac" class="flex h-full">
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[var(--size-control)] items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="minimize"
          >
            <Minus class="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>最小化</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[var(--size-control)] items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="toggleMaximize"
          >
            <Square class="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>最大化</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex h-full w-[var(--size-control)] items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
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
    <KnownHostsDialog ref="knownHostsRef" />
  </div>
</template>
