<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, FolderPlus, Download, ChevronRight, Folder, Server, Trash2, Pencil } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { openNewConnection } from '@/stores/dialogs'
import {
  groupTree,
  quickConnect,
  refreshAll,
  removeGroup,
  removeSession,
  saveGroup,
} from '@/stores/sessions'
import { openConfirm, openPrompt } from '@/stores/prompt'
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
    await openConfirm({
      title: '连接失败',
      message: msg,
      confirmText: '知道了',
      cancelText: '关闭',
    })
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
    await openConfirm({ title: '创建失败', message: String(e), confirmText: '知道了' })
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
    await openConfirm({ title: '重命名失败', message: String(e), confirmText: '知道了' })
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
    await openConfirm({ title: '删除失败', message: String(e), confirmText: '知道了' })
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
    await openConfirm({ title: '删除失败', message: String(e), confirmText: '知道了' })
  }
}
</script>

<template>
  <aside class="flex w-[220px] min-w-[180px] shrink-0 flex-col border-r border-border bg-sidebar">
    <Tabs v-model="activeTab" class="flex-1 min-h-0">
      <TabsList>
        <TabsTrigger value="sessions">会话</TabsTrigger>
        <TabsTrigger value="keys">密钥</TabsTrigger>
        <TabsTrigger value="tunnels">隧道</TabsTrigger>
      </TabsList>

      <TabsContent value="sessions" class="flex flex-col">
        <div class="flex items-center gap-0.5 border-b border-border px-1.5 py-1.5">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" @click="openNewConnection()"><Plus /></Button>
            </TooltipTrigger>
            <TooltipContent>新建连接</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" @click="newGroup"><FolderPlus /></Button>
            </TooltipTrigger>
            <TooltipContent>新建分组</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" disabled><Download /></Button>
            </TooltipTrigger>
            <TooltipContent>导入(待实现)</TooltipContent>
          </Tooltip>
          <div class="flex-1 pl-1">
            <Input v-model="query" placeholder="搜索会话…" />
          </div>
        </div>

        <ScrollArea class="flex-1">
          <div class="py-1">
            <div
              v-if="filtered.length === 0"
              class="px-3 py-6 text-center text-[11px] text-muted-foreground"
            >
              {{ query ? '没有匹配的会话' : '暂无会话,点上方 + 新建一个' }}
            </div>
            <template v-for="node in filtered" :key="node.group.id || '__orphan__'">
              <div
                class="group flex h-6 cursor-pointer items-center gap-1.5 px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                @click="toggle(node.group.id)"
              >
                <ChevronRight
                  class="size-3 shrink-0 transition-transform"
                  :class="expanded[nodeKey(node.group.id)] && 'rotate-90'"
                />
                <Folder class="size-3.5 shrink-0 text-warning" />
                <span class="flex-1 truncate">{{ node.group.name }}</span>
                <span class="text-[11px] text-muted-foreground/70">{{ node.sessions.length }}</span>
                <template v-if="node.group.id && !isDefaultGroup(node.group.name)">
                  <button
                    class="hidden size-4 items-center justify-center rounded-sm hover:bg-background/60 group-hover:flex"
                    @click.stop="renameGroup(node.group.id, node.group.name)"
                    title="重命名"
                  ><Pencil class="size-3" /></button>
                  <button
                    class="hidden size-4 items-center justify-center rounded-sm hover:bg-destructive/20 hover:text-destructive group-hover:flex"
                    @click.stop="delGroup(node.group.id, node.group.name)"
                    title="删除分组"
                  ><Trash2 class="size-3" /></button>
                </template>
              </div>
              <template v-if="expanded[nodeKey(node.group.id)]">
                <div
                  v-for="child in node.sessions"
                  :key="child.id"
                  :title="`${child.username}@${child.host}:${child.port}(双击连接)`"
                  :class="cn(
                    'group flex h-6 cursor-pointer items-center gap-1.5 pl-7 pr-2 text-[12px]',
                    selectedId === child.id
                      ? 'bg-primary/20 text-foreground'
                      : 'text-foreground hover:bg-muted',
                  )"
                  @click="selectedId = child.id"
                  @dblclick="onSessionDblclick(child)"
                >
                  <Server
                    :class="cn(
                      'size-3 shrink-0',
                      activeStoredSessionIds.has(child.id) ? 'text-success' : 'text-muted-foreground',
                    )"
                  />
                  <span
                    :class="cn(
                      'flex-1 truncate',
                      activeStoredSessionIds.has(child.id) && 'text-foreground',
                    )"
                  >{{ child.name }}</span>
                  <span class="font-mono text-[10px] text-muted-foreground">{{ child.host }}</span>
                  <button
                    class="hidden size-4 items-center justify-center rounded-sm hover:bg-muted-foreground/20 hover:text-foreground group-hover:flex"
                    @click.stop="editSession(child)"
                    title="编辑"
                  ><Pencil class="size-3" /></button>
                  <button
                    class="hidden size-4 items-center justify-center rounded-sm hover:bg-destructive/20 hover:text-destructive group-hover:flex"
                    @click.stop="delSession(child)"
                    title="删除会话"
                  ><Trash2 class="size-3" /></button>
                </div>
              </template>
            </template>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="keys" class="p-3 text-[12px] text-muted-foreground">
        密钥管理(待实现)
      </TabsContent>
      <TabsContent value="tunnels" class="p-3 text-[12px] text-muted-foreground">
        端口隧道(待实现)
      </TabsContent>
    </Tabs>
  </aside>
</template>
