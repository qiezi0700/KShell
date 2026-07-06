<script setup lang="ts">
import { ref, computed } from 'vue'
import { Zap, Plus, Trash2, Send, X, Pencil, Search, Terminal } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  quickCommands,
  addQuickCommand,
  removeQuickCommand,
  updateQuickCommand,
} from '@/stores/quick-commands'
import { canSendToTerminal, getActiveTerminalSender } from '@/stores/active-terminal'
import { toast } from '@/stores/toast'
import { openConfirm } from '@/stores/prompt'

const keyword = ref('')
// 表单模式:null=关闭;有值=编辑该 id;showForm 单独标记新增
const editingId = ref<string | null>(null)
const showForm = ref(false)
const draftLabel = ref('')
const draftDesc = ref('')
const draftCmd = ref('')

const formTitle = computed(() => (editingId.value ? '编辑指令' : '新增指令'))

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return quickCommands.value
  return quickCommands.value.filter(
    (c) =>
      c.label.toLowerCase().includes(kw) ||
      c.command.toLowerCase().includes(kw) ||
      c.description.toLowerCase().includes(kw),
  )
})

function resetForm() {
  showForm.value = false
  editingId.value = null
  draftLabel.value = ''
  draftDesc.value = ''
  draftCmd.value = ''
}

function openAdd() {
  editingId.value = null
  draftLabel.value = ''
  draftDesc.value = ''
  draftCmd.value = ''
  showForm.value = true
}

function openEdit(id: string) {
  const c = quickCommands.value.find((x) => x.id === id)
  if (!c) return
  editingId.value = id
  // 若 label 与 command 相同,别名视作空
  draftLabel.value = c.label === c.command ? '' : c.label
  draftDesc.value = c.description ?? ''
  draftCmd.value = c.command
  showForm.value = true
}

async function submitForm() {
  const cmd = draftCmd.value.trim()
  if (!cmd) return
  try {
    if (editingId.value) {
      await updateQuickCommand(editingId.value, {
        label: draftLabel.value,
        description: draftDesc.value,
        command: cmd,
      })
    } else {
      await addQuickCommand(cmd, draftLabel.value, draftDesc.value)
    }
    resetForm()
  } catch (e) {
    toast.error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e), '保存失败')
  }
}

async function confirmDelete(id: string, label: string) {
  const ok = await openConfirm({
    title: '删除指令',
    message: `确定删除「${label}」吗?`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await removeQuickCommand(id)
  } catch (e) {
    toast.error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e), '删除失败')
  }
}

function sendToTerminal(cmd: string) {
  const sender = getActiveTerminalSender()
  if (!sender) {
    toast.warning('请先打开一个终端标签')
    return
  }
  sender(cmd)
  toast.info('已发送到终端')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 工具栏 -->
    <div class="border-b border-sidebar-border px-2 py-1.5">
      <div class="flex items-center gap-1 pb-1.5">
        <div class="relative flex-1">
          <Search class="absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="keyword"
            placeholder="搜索指令…"
            class="h-7 pl-6 text-body"
          />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="openAdd"><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent>新增指令</TooltipContent>
        </Tooltip>
      </div>
      <!-- 活跃终端状态提示 -->
      <div class="flex items-center gap-1 text-caption" :class="canSendToTerminal ? 'text-success' : 'text-muted-foreground'">
        <Terminal class="size-3" />
        <span>{{ canSendToTerminal ? '已连接活跃终端' : '未连接终端(发送禁用)' }}</span>
      </div>
    </div>

    <!-- 新增 / 编辑表单 -->
    <div
      v-if="showForm"
      class="flex flex-col gap-1.5 border-b border-sidebar-border bg-muted/30 px-2 py-2"
    >
      <div class="text-caption text-muted-foreground">{{ formTitle }}</div>
      <Input
        v-model="draftLabel"
        size="sm"
        placeholder="别名(可选)"
      />
      <Input
        v-model="draftDesc"
        size="sm"
        placeholder="描述(可选)"
      />
      <Textarea
        v-model="draftCmd"
        placeholder="指令内容(Ctrl+Enter 保存)"
        class="min-h-16 max-h-40 py-1.5 text-sm font-mono"
        @keydown.enter.ctrl.prevent="submitForm"
        @keydown.esc.prevent="resetForm"
      />
      <div class="flex items-center justify-end gap-1">
        <Button variant="ghost" size="xs" @click="resetForm">
          <X class="size-3" />
          取消
        </Button>
        <Button size="xs" :disabled="!draftCmd.trim()" @click="submitForm">
          保存
        </Button>
      </div>
    </div>

    <!-- 指令列表 -->
    <div class="flex-1 overflow-y-auto p-1">
      <div
        v-if="filtered.length === 0 && !showForm"
        class="text-body px-3 py-6 text-center text-muted-foreground"
      >
        {{ keyword ? '无匹配指令' : '暂无指令,点上方 + 新建' }}
      </div>

      <ContextMenu v-for="c in filtered" :key="c.id" class="block">
        <ContextMenuTrigger as-child>
          <button
            class="group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
            :disabled="!canSendToTerminal"
            @click="sendToTerminal(c.command)"
          >
            <Send class="mt-0.5 size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <div class="flex items-center gap-1">
                <span class="text-body min-w-0 flex-1 truncate">{{ c.label }}</span>
                <Badge v-if="c.builtin" variant="secondary" class="text-caption">内置</Badge>
              </div>
              <span
                v-if="c.description"
                class="truncate text-caption text-muted-foreground/90"
              >
                {{ c.description }}
              </span>
              <span
                v-if="c.label !== c.command"
                class="truncate font-mono text-caption text-muted-foreground"
              >
                {{ c.command }}
              </span>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem :disabled="!canSendToTerminal" @select="sendToTerminal(c.command)">
            <Send class="size-3.5" /> 发送到终端
          </ContextMenuItem>
          <ContextMenuItem v-if="!c.builtin" @select="openEdit(c.id)">
            <Pencil class="size-3.5" /> 编辑
          </ContextMenuItem>
          <ContextMenuSeparator v-if="!c.builtin" />
          <ContextMenuItem
            v-if="!c.builtin"
            variant="destructive"
            @select="confirmDelete(c.id, c.label)"
          >
            <Trash2 class="size-3.5" /> 删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </div>
</template>
