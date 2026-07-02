<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, FolderPlus, Download, Upload, ChevronRight, Folder, Server, Trash2, Pencil } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toast'
import { openNewConnection } from '@/stores/dialogs'
import { sessionActions } from '@/stores/session-actions'
import {
  groupTree,
  quickConnect,
  refreshAll,
  removeGroup,
  removeSession,
  saveGroup,
  importSessions,
  exportSessions,
  DEFAULT_GROUP_NAME,
} from '@/stores/sessions'
import { openConfirm, openPrompt } from '@/stores/prompt'
import { activeStoredSessionIds } from '@/stores/tabs'
import type { StoredSession } from '@/api/sessions'

const expanded = ref<Record<string, boolean>>({})
const selectedId = ref<string | null>(null)
const query = ref('')

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
  if (!name || name.trim() === '') return
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
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="border-b border-sidebar-border px-2 py-1.5">
      <div class="flex items-center gap-1 pb-1.5">
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
            <Button variant="ghost" size="icon-sm" @click="importSessions"><Download /></Button>
          </TooltipTrigger>
          <TooltipContent>导入会话</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="exportSessions"><Upload /></Button>
          </TooltipTrigger>
          <TooltipContent>导出会话</TooltipContent>
        </Tooltip>
      </div>
      <Input v-model="query" placeholder="搜索会话…" />
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
            <button
              class="text-body flex w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
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
                  <button
                    class="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
                    :class="selectedId === child.id && 'border-sidebar-border bg-sidebar-accent'"
                    @click="selectedId = child.id"
                    @dblclick="onSessionDblclick(child)"
                  >
                    <Server
                      :class="cn(
                        'size-3.5 shrink-0',
                        activeStoredSessionIds.has(child.id) ? 'text-success' : 'text-muted-foreground',
                      )"
                    />
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="text-body truncate font-medium">{{ child.name }}</span>
                      <div class="text-caption truncate font-mono text-muted-foreground/80">
                        {{ child.username }}@{{ child.host }}:{{ child.port }}
                      </div>
                    </div>
                    <span
                      v-if="activeStoredSessionIds.has(child.id)"
                      class="size-1.5 shrink-0 rounded-full bg-success"
                    />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem v-for="a in sessionActions" :key="a.id" @select="a.run(child)">
                    <component :is="a.icon" class="size-3.5" /> {{ a.label }}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem @select="editSession(child)">
                    <Pencil class="size-3.5" /> 编辑会话
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
</template>
