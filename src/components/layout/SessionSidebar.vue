<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, FolderPlus, Download, ChevronRight, Folder, Server, Trash2, Pencil, KeyRound } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { openNewConnection } from '@/stores/dialogs'
import { openKeyManager } from '@/stores/keys'
import TunnelPanel from '@/components/tunnels/TunnelPanel.vue'
import MonitorSummary from '@/components/monitor/MonitorSummary.vue'
import {
  groupTree,
  quickConnect,
  refreshAll,
  removeGroup,
  removeSession,
  saveGroup,
} from '@/stores/sessions'
import { openConfirm, openPrompt } from '@/stores/prompt'
import { toast } from '@/stores/toast'
import { activeStoredSessionIds } from '@/stores/tabs'
import type { StoredSession } from '@/api/sessions'
import { DEFAULT_GROUP_NAME } from '@/stores/sessions'

const expanded = ref<Record<string, boolean>>({})
const selectedId = ref<string | null>(null)
const query = ref('')
const activeTab = ref('sessions')

/** 是否是系统内置默认分组(不可重命名/删除) */
function isDefaultGroup(name: string) {
  return name === DEFAULT_GROUP_NAME
}

onMounted(async () => {
  await refreshAll()
  for (const node of groupTree.value) {
    expanded.value[node.group.id || '__orphan__'] = true
  }
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return groupTree.value
  return groupTree.value
    .map((node) => ({
      ...node,
      sessions: node.sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q),
      ),
    }))
    .filter((node) => node.sessions.length > 0)
})

function nodeKey(gid: string) {
  return gid || '__orphan__'
}

function toggle(gid: string) {
  const k = nodeKey(gid)
  expanded.value[k] = !expanded.value[k]
}

/** 双击会话:用已保存凭据直连 */
async function onSessionDblclick(s: StoredSession) {
  selectedId.value = s.id
  try {
    await quickConnect(s)
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as any)?.message ?? String(e)
    // 公钥校验失败已由 host-key 弹框处理
    if (msg.includes('主机公钥校验未通过')) return
    toast.error(msg, '连接失败')
  }
}

/** 单击"编辑"按钮:打开对话框走编辑模式 */
async function editSession(s: StoredSession) {
  selectedId.value = s.id
  openNewConnection(s)
}

async function newGroup() {
  const name = await openPrompt({
    title: '新建分组',
    placeholder: '例如 生产环境',
    confirmText: '创建',
  })
  if (!name || !name.trim()) return
  try {
    await saveGroup(name.trim())
  } catch (e) {
    toast.error(String(e), '创建失败')
  }
}

async function renameGroup(id: string, oldName: string) {
  if (!id || isDefaultGroup(oldName)) return
  const name = await openPrompt({
    title: '重命名分组',
    defaultValue: oldName,
    confirmText: '保存',
  })
  if (!name || name.trim() === '' || name.trim() === oldName) return
  try {
    await saveGroup(name.trim(), id)
  } catch (e) {
    toast.error(String(e), '重命名失败')
  }
}

async function delGroup(id: string, name: string) {
  if (!id || isDefaultGroup(name)) return
  const ok = await openConfirm({
    title: `删除分组「${name}」?`,
    message: '其中的会话会移到"未分组"分类。',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return
  try {
    await removeGroup(id)
  } catch (e) {
    toast.error(String(e), '删除失败')
  }
}

async function delSession(s: StoredSession) {
  const ok = await openConfirm({
    title: `删除会话「${s.name}」?`,
    message: '此操作不可撤销。',
    confirmText: '删除',
    destructive: true,
  })
  if (!ok) return
  try {
    await removeSession(s.id)
  } catch (e) {
    toast.error(String(e), '删除失败')
  }
}
</script>

<template>
  <Sidebar
    collapsible="offcanvas"
    class="border-r border-sidebar-border"
  >
    <SidebarHeader class="border-b border-sidebar-border px-0 py-0">
      <Tabs v-model="activeTab" class="min-h-0">
        <TabsList class="flex w-full justify-start gap-0 border-b-0 px-1 pt-0">
          <TabsTrigger
            v-for="t in [
              { value: 'sessions', label: '会话' },
              { value: 'keys', label: '密钥' },
              { value: 'tunnels', label: '隧道' },
            ]"
            :key="t.value"
            :value="t.value"
            class="rounded-none px-2.5 py-1.5 text-body text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground data-[state=active]:mb-0 data-[state=active]:border-b-0 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_2px_0_var(--color-primary)]"
          >{{ t.label }}</TabsTrigger>
        </TabsList>
      </Tabs>
    </SidebarHeader>

    <SidebarContent class="px-0">
      <!-- 会话 -->
      <div v-show="activeTab === 'sessions'" class="flex min-h-0 flex-1 flex-col">
        <div class="flex items-center gap-1 border-b border-sidebar-border px-2 py-1.5">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" @click="openNewConnection()"><Plus /></Button>
            </TooltipTrigger>
            <TooltipContent>新建连接</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" @click="newGroup"><FolderPlus /></Button>
            </TooltipTrigger>
            <TooltipContent>新建分组</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon-sm" disabled><Download /></Button>
            </TooltipTrigger>
            <TooltipContent>导入(待实现)</TooltipContent>
          </Tooltip>
          <div class="flex-1 pl-1">
            <Input v-model="query" placeholder="搜索会话…" />
          </div>
        </div>

        <div class="flex-1 overflow-y-auto py-1">
          <div
            v-if="filtered.length === 0"
            class="text-body px-3 py-6 text-center text-muted-foreground"
          >
            {{ query ? '没有匹配的会话' : '暂无会话,点上方 + 新建一个' }}
          </div>

          <SidebarGroup v-for="node in filtered" :key="node.group.id || '__orphan__'" class="relative p-1">
            <ContextMenu>
              <ContextMenuTrigger as-child>
                <SidebarGroupLabel
                  as-child
                >
                  <button
                    class="text-body flex w-full cursor-pointer items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    :style="{ height: 'var(--size-row-md)' }"
                    @click="toggle(node.group.id)"
                  >
                    <ChevronRight
                      class="size-3.5 shrink-0 transition-transform"
                      :class="expanded[nodeKey(node.group.id)] && 'rotate-90'"
                    />
                    <Folder class="size-3.5 shrink-0 text-warning" />
                    <span class="flex-1 truncate text-left font-medium">{{ node.group.name }}</span>
                    <span class="text-caption font-normal tabular-nums text-muted-foreground/70">{{ node.sessions.length }}</span>
                  </button>
                </SidebarGroupLabel>
              </ContextMenuTrigger>
              <ContextMenuContent v-if="node.group.id && !isDefaultGroup(node.group.name)">
                <ContextMenuItem @select="renameGroup(node.group.id, node.group.name)">
                  <Pencil class="size-3.5" /> 重命名分组
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" @select="delGroup(node.group.id, node.group.name)">
                  <Trash2 class="size-3.5" /> 删除分组
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            <SidebarGroupContent v-show="expanded[nodeKey(node.group.id)]">
              <SidebarMenu class="gap-0.5">
                <SidebarMenuItem
                  v-for="child in node.sessions"
                  :key="child.id"
                >
                  <ContextMenu>
                    <ContextMenuTrigger as-child>
                      <SidebarMenuButton
                        as-child
                        :is-active="selectedId === child.id"
                        :tooltip="`${child.username}@${child.host}:${child.port}(双击连接)`"
                        size="sm"
                        class="pl-7"
                      >
                        <button
                          class="text-body"
                          @click="selectedId = child.id"
                          @dblclick="onSessionDblclick(child)"
                        >
                          <Server
                            :class="cn(
                              'size-3.5',
                              activeStoredSessionIds.has(child.id) ? 'text-success' : 'text-muted-foreground',
                            )"
                          />
                          <span class="flex-1 truncate">{{ child.name }}</span>
                          <span class="text-caption font-normal tracking-normal normal-case font-mono text-muted-foreground">{{ child.host }}</span>
                        </button>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem @select="editSession(child)">
                        <Pencil class="size-3.5" /> 编辑会话
                      </ContextMenuItem>
                      <ContextMenuItem @select="onSessionDblclick(child)">
                        <Server class="size-3.5" /> 连接
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" @select="delSession(child)">
                        <Trash2 class="size-3.5" /> 删除会话
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </div>

      <!-- 密钥 -->
      <div v-show="activeTab === 'keys'" class="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <Button variant="outline" size="sm" @click="openKeyManager()">
          <KeyRound class="size-3.5" />
          打开密钥库管理
        </Button>
      </div>

      <!-- 隧道 -->
      <div v-show="activeTab === 'tunnels'" class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TunnelPanel />
      </div>
    </SidebarContent>

    <SidebarFooter class="p-0">
      <MonitorSummary />
    </SidebarFooter>
  </Sidebar>
</template>
