<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import { useMagicKeys, whenever } from '@vueuse/core'
import { onBeforeUnmount, onMounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { tabs, activeTabId, closeTab, type Tab } from '@/stores/tabs'
import { getTabView } from '@/stores/tab-views'
import { openNewConnection } from '@/stores/dialogs'
import { copyTerminalSelection } from '@/stores/ui'
import { openCommandPalette } from '@/stores/command-palette'
import { importSessions } from '@/stores/sessions'

// 暴露给模板:按 tab 类型查注册表取视图定义
function viewOf(tab: Tab) {
  return getTabView(tab.type)
}

const shortcuts = [
  ['Ctrl', 'N', '新建连接'],
  ['Ctrl', 'T', '新建标签'],
  ['Ctrl', 'W', '关闭标签'],
  ['Ctrl', 'K', '命令面板'],
]

// 全局快捷键(在 WorkArea 层级监听)
// Ctrl+B 由 SidebarProvider 内置处理,此处不再重复监听
const keys = useMagicKeys()
whenever(keys['Ctrl+N'], () => openNewConnection())
whenever(keys['Ctrl+T'], () => openNewConnection())
whenever(keys['Ctrl+W'], () => {
  if (activeTabId.value) closeTab(activeTabId.value)
})
// Ctrl+K 命令面板
whenever(keys['Ctrl+K'], () => {
  openCommandPalette()
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

// 阻止 WebView 默认行为:
// - F5 / Ctrl+R / Ctrl+Shift+R / Cmd+R:刷新会打断 SSH 会话
// - Ctrl+Shift+C:WebView 默认打开 DevTools,改为终端复制选区
function preventWebViewShortcut(e: KeyboardEvent) {
  if (
    e.key === 'F5' ||
    ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))
  ) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    e.stopPropagation()
    copyTerminalSelection()
  }
}

onMounted(() => {
  window.addEventListener('keydown', preventWebViewShortcut, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', preventWebViewShortcut, { capture: true })
})
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-background">
    <div class="flex shrink-0 border-b border-border bg-titlebar" :style="{ height: 'var(--size-tabbar)' }">
      <Tabs
        :model-value="activeTabId ?? ''"
        class="min-w-0 flex-1"
        @update:model-value="(v: string | number) => { if (typeof v === 'string' && v !== '') activeTabId = v }"
      >
        <TabsList class="h-full w-full justify-start gap-0 overflow-x-auto border-b-0 bg-transparent px-0 pt-0">
          <TabsTrigger
            v-for="tab in tabs"
            :key="tab.id"
            :value="tab.id"
            as-child
            :class="cn(
              'group relative flex h-full min-w-[120px] max-w-[200px] cursor-pointer items-center gap-2 rounded-none border-r border-border py-0 pl-3 pr-2',
              'text-body text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              'data-[state=active]:mb-0 data-[state=active]:border-b-0 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_2px_0_var(--color-primary)]',
            )"
          >
            <div class="flex h-full w-full items-center gap-2">
              <component
                :is="viewOf(tab)?.icon"
                :class="cn('size-3.5 shrink-0', activeTabId === tab.id && 'text-primary')"
              />
              <span class="flex-1 truncate">{{ tab.title }}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                @click.stop="closeTab(tab.id)"
              >
                <X class="size-3.5" />
              </Button>
            </div>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            class="h-full w-[var(--size-tabbar)] rounded-none px-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="openNewConnection()"
          >
            <Plus class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>新建标签</TooltipContent>
      </Tooltip>
    </div>

    <div class="relative min-h-0 flex-1">
      <div v-if="tabs.length === 0" class="flex h-full items-center justify-center px-6">
        <div class="max-w-[480px] text-center">
          <div class="mb-4 font-mono text-[64px] leading-none tracking-[-6px] text-primary">›_</div>
          <h2 class="mb-2 text-[22px] font-medium tracking-tight text-foreground">KShell</h2>
          <p class="text-ui mb-6 text-muted-foreground">选择左侧会话开始连接,或新建一个连接。</p>

          <div class="mb-8 flex justify-center gap-2">
            <Button variant="default" @click="openNewConnection()">
              <Plus />
              新建 SSH 连接
            </Button>
            <Button variant="outline" @click="importSessions()">导入配置</Button>
          </div>

          <div class="text-body grid grid-cols-2 gap-x-6 gap-y-2.5 text-muted-foreground">
            <div v-for="s in shortcuts" :key="s[2]" class="flex items-center gap-1.5">
              <span class="flex items-center gap-0.5">
                <kbd
                  v-for="k in s.slice(0, -1)"
                  :key="k"
                  class="text-caption inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border bg-panel-2 px-1 font-mono font-medium tracking-normal normal-case text-foreground"
                >{{ k }}</kbd>
              </span>
              <span>{{ s[s.length - 1] }}</span>
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
          <component
            v-if="viewOf(tab)"
            :is="viewOf(tab)?.component"
            :tab="tab"
          />
          <div v-else class="text-body flex h-full items-center justify-center text-muted-foreground">
            该标签类型暂未实现
          </div>
        </div>
      </template>
    </div>
  </main>
</template>
