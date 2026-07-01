<script setup lang="ts">
import { Plus, X, TerminalSquare, FolderOpen, Activity, Container } from 'lucide-vue-next'
import { useMagicKeys, whenever } from '@vueuse/core'
import { onMounted, watchEffect } from 'vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import Terminal from '@/components/terminal/Terminal.vue'
import { tabs, activeTabId, closeTab } from '@/stores/tabs'
import { openNewConnection } from '@/stores/dialogs'

const iconMap = {
  terminal: TerminalSquare,
  sftp: FolderOpen,
  monitor: Activity,
  docker: Container,
} as const

const shortcuts = [
  ['Ctrl', 'N', '新建连接'],
  ['Ctrl', 'T', '新建标签'],
  ['Ctrl', 'W', '关闭标签'],
  ['Ctrl', 'K', '命令面板'],
]

// 全局快捷键(在 WorkArea 层级监听)
const keys = useMagicKeys()
whenever(keys['Ctrl+N'], () => openNewConnection())
whenever(keys['Ctrl+T'], () => openNewConnection())
whenever(keys['Ctrl+W'], () => {
  if (activeTabId.value) closeTab(activeTabId.value)
})
// Ctrl+K 命令面板:先放占位,避免 keydown 透传到 xterm
whenever(keys['Ctrl+K'], () => {
  // TODO: 命令面板
  console.log('[kshell] command palette')
})

// Tab 切换:Ctrl+PgUp/PgDown
whenever(keys['Ctrl+PageDown'], () => {
  if (!tabs.value.length) return
  const idx = tabs.value.findIndex((t) => t.id === activeTabId.value)
  const next = tabs.value[(idx + 1) % tabs.value.length]
  if (next) activeTabId.value = next.id
})
whenever(keys['Ctrl+PageUp'], () => {
  if (!tabs.value.length) return
  const idx = tabs.value.findIndex((t) => t.id === activeTabId.value)
  const prev = tabs.value[(idx - 1 + tabs.value.length) % tabs.value.length]
  if (prev) activeTabId.value = prev.id
})

// 把空状态提示里的"命令面板"改成未实现警告
watchEffect(() => {
  // 占位,用于让上面的 keys reactive
})

// 阻止 WebView 默认刷新行为:F5 / Ctrl+R / Ctrl+Shift+R / Cmd+R
// 这些快捷键在桌面客户端里会打断当前 SSH 会话与前端状态。
onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    if (
      e.key === 'F5' ||
      ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))
    ) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  window.addEventListener('keydown', handler, { capture: true })
  return () => window.removeEventListener('keydown', handler, { capture: true })
})
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-background">
    <div class="flex h-[30px] shrink-0 border-b border-border bg-titlebar">
      <div class="flex flex-1 overflow-x-auto">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="cn(
            'group flex h-full min-w-[120px] max-w-[200px] cursor-pointer items-center gap-1.5 border-r border-border pl-3 pr-2 text-[12px]',
            activeTabId === tab.id
              ? 'bg-background text-foreground shadow-[inset_0_2px_0_var(--color-primary)]'
              : 'text-muted-foreground hover:text-foreground',
          )"
          @click="activeTabId = tab.id"
        >
          <component
            :is="iconMap[tab.type]"
            :class="cn('size-3.5 shrink-0', activeTabId === tab.id && 'text-primary')"
          />
          <span class="flex-1 truncate">{{ tab.title }}</span>
          <button
            class="flex size-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            @click.stop="closeTab(tab.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="flex w-[30px] items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="openNewConnection()"
          >
            <Plus class="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>新建标签</TooltipContent>
      </Tooltip>
    </div>

    <div class="relative min-h-0 flex-1">
      <div v-if="tabs.length === 0" class="flex h-full items-center justify-center">
        <div class="max-w-[480px] text-center">
          <div class="mb-3 font-mono text-[56px] leading-none tracking-[-4px] text-primary">›_</div>
          <h2 class="mb-2 text-[24px] font-medium text-foreground">KShell</h2>
          <p class="mb-5 text-muted-foreground">选择左侧会话开始连接,或新建一个连接。</p>

          <div class="mb-8 flex justify-center gap-2">
            <Button variant="default" @click="openNewConnection()">
              <Plus />
              新建 SSH 连接
            </Button>
            <Button variant="outline">导入配置</Button>
          </div>

          <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
            <div v-for="s in shortcuts" :key="s[2]">
              <kbd
                v-for="k in s.slice(0, -1)"
                :key="k"
                class="mr-1 inline-block rounded-[3px] border border-border bg-panel-2 px-1.5 py-px font-mono text-[10px] text-foreground"
              >{{ k }}</kbd>
              {{ s[s.length - 1] }}
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <div
          v-for="tab in tabs"
          v-show="activeTabId === tab.id"
          :key="tab.id"
          class="absolute inset-0"
        >
          <Terminal
            v-if="tab.type === 'terminal'"
            :tab-id="tab.id"
            :session-id="tab.sessionId"
            :channel-id="tab.channelId"
          />
        </div>
      </template>
    </div>
  </main>
</template>
