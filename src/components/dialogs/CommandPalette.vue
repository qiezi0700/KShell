<script setup lang="ts">
import { ref, computed, watch, nextTick, shallowRef } from 'vue'
import {
  Plus,
  KeyRound,
  Activity,
  Download,
  Upload,
  Eye,
  EyeOff,
  Trash2,
  PanelLeft,
  PanelBottom,
  Monitor,
  Server,
  FolderOpen,
  Settings,
  HelpCircle,
  RotateCw,
} from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { openNewConnection } from '@/stores/dialogs'
import { openKeyManager } from '@/stores/keys'
import { monitorDialogOpen } from '@/stores/monitor'
import { sidebarVisible, statusBarVisible, clearTerminal, clearScrollback } from '@/stores/ui'
import { tabs, activeTabId, closeTab } from '@/stores/tabs'
import { importSessions, exportSessions } from '@/stores/sessions'
import { toast } from '@/stores/toast'
import { commandPaletteOpen } from '@/stores/command-palette'

// ============================================================
// 命令定义
// ============================================================

interface Command {
  id: string
  label: string
  category: string
  icon: any
  shortcut?: string[]
  disabled?: () => boolean
  action: () => void
}

const hasActiveTerminal = () =>
  activeTabId.value != null && tabs.value.find((t) => t.id === activeTabId.value)?.type === 'terminal'

const commands = shallowRef<Command[]>([
  // 连接
  { id: 'new-conn', label: '新建 SSH 连接', category: '连接', icon: Plus, shortcut: ['Ctrl', 'N'], action: () => openNewConnection() },
  { id: 'close-tab', label: '关闭当前标签', category: '连接', icon: Trash2, shortcut: ['Ctrl', 'W'], disabled: () => !activeTabId.value, action: () => { if (activeTabId.value) closeTab(activeTabId.value) } },

  // 视图
  { id: 'toggle-sidebar', label: '切换侧边栏', category: '视图', icon: PanelLeft, shortcut: ['Ctrl', 'B'], action: () => sidebarVisible.value = !sidebarVisible.value },
  { id: 'toggle-statusbar', label: '切换状态栏', category: '视图', icon: PanelBottom, action: () => statusBarVisible.value = !statusBarVisible.value },

  // 工具
  { id: 'monitor', label: '服务器监控', category: '工具', icon: Activity, disabled: () => !hasActiveTerminal(), action: () => monitorDialogOpen.value = true },
  { id: 'key-manager', label: 'SSH 密钥库', category: '工具', icon: KeyRound, action: () => openKeyManager() },
  { id: 'import', label: '导入会话配置', category: '工具', icon: Download, action: () => importSessions() },
  { id: 'export', label: '导出会话配置', category: '工具', icon: Upload, action: () => exportSessions() },

  // 终端
  { id: 'clear-terminal', label: '清屏', category: '终端', icon: RotateCw, disabled: () => !hasActiveTerminal(), action: () => clearTerminal() },
  { id: 'clear-scrollback', label: '清除滚动缓冲', category: '终端', icon: EyeOff, disabled: () => !hasActiveTerminal(), action: () => clearScrollback() },

  // 标签切换
  ...tabs.value.map((t) => ({
    id: `switch-${t.id}`,
    label: `切换到: ${t.title}`,
    category: '标签',
    icon: t.type === 'terminal' ? Server : t.type === 'sftp' ? FolderOpen : Activity,
    action: () => activeTabId.value = t.id,
  })),
])

// tabs 变化时重建命令列表
watch(tabs, () => {
  const staticCmds = commands.value.filter((c) => !c.id.startsWith('switch-'))
  const tabCmds = tabs.value.map((t) => ({
    id: `switch-${t.id}`,
    label: `切换到: ${t.title}`,
    category: '标签',
    icon: t.type === 'terminal' ? Server : t.type === 'sftp' ? FolderOpen : Activity,
    action: () => activeTabId.value = t.id,
  }))
  commands.value = [...staticCmds, ...tabCmds]
}, { deep: true })

// ============================================================
// 搜索 + 键盘导航
// ============================================================

const query = ref('')
const selectedIdx = ref(0)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  return commands.value.filter((c) =>
    c.label.toLowerCase().includes(q) ||
    c.category.toLowerCase().includes(q),
  )
})

watch(query, () => {
  selectedIdx.value = 0
})

const open = commandPaletteOpen

const inputEl = ref<HTMLInputElement | null>(null)

watch(open, (v) => {
  if (v) {
    query.value = ''
    selectedIdx.value = 0
    nextTick(() => inputEl.value?.focus())
  }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIdx.value = Math.min(selectedIdx.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    executeSelected()
  } else if (e.key === 'Escape') {
    open.value = false
  }
}

function executeSelected() {
  const cmd = filtered.value[selectedIdx.value]
  if (!cmd || cmd.disabled?.()) return
  open.value = false
  cmd.action()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="command-palette max-w-[560px] gap-0 overflow-hidden p-0 [&_[data-slot=dialog-close]]:hidden"
      @pointer-down-outside="open = false"
    >
      <DialogTitle class="sr-only">命令面板</DialogTitle>

      <!-- 搜索框 -->
      <div class="flex items-center gap-2 border-b border-border px-3" :style="{ height: 'var(--size-row-lg)' }">
        <input
          ref="inputEl"
          v-model="query"
          placeholder="输入命令名称搜索…"
          class="text-body flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          @keydown="onKeydown"
        />
        <kbd class="text-caption inline-flex h-[18px] items-center rounded-sm border border-border bg-panel-2 px-1 font-mono text-muted-foreground">ESC</kbd>
      </div>

      <!-- 命令列表 -->
      <div class="max-h-[360px] overflow-y-auto py-1">
        <div v-if="filtered.length === 0" class="text-body py-6 text-center text-muted-foreground">
          没有匹配的命令
        </div>

        <template v-else>
          <template v-for="(cmd, idx) in filtered" :key="cmd.id">
            <!-- 分类分隔(首个或分类变化时) -->
            <div
              v-if="idx === 0 || filtered[idx - 1].category !== cmd.category"
              class="text-caption px-3 pb-1 pt-2 text-muted-foreground/70"
            >{{ cmd.category }}</div>

            <button
              class="text-body flex w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none"
              :class="[
                cmd.disabled?.() ? 'opacity-40' : '',
                selectedIdx === idx
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-muted/50',
              ]"
              @mouseenter="selectedIdx = idx"
              @click="executeSelected"
            >
              <component :is="cmd.icon" class="size-3.5 shrink-0" />
              <span class="flex-1 truncate">{{ cmd.label }}</span>
              <span v-if="cmd.shortcut" class="flex items-center gap-0.5">
                <kbd
                  v-for="k in cmd.shortcut"
                  :key="k"
                  class="text-caption inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border bg-panel-2 px-1 font-mono text-muted-foreground"
                >{{ k }}</kbd>
              </span>
            </button>
          </template>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
