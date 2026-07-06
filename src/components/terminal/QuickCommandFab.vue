<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { Zap, Plus, Trash2, Send, X, Pencil } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  quickCommands,
  addQuickCommand,
  removeQuickCommand,
  updateQuickCommand,
} from '@/stores/quick-commands'

/**
 * offsetRight:FAB 距右边缘的偏移量。默认 3.5rem,给右侧的 SFTP 圆钮让位;
 * 当不带 SFTP 时(如 exec 终端),外层传 0.75rem 让 FAB 贴右
 */
const props = withDefaults(
  defineProps<{ offsetRight?: string }>(),
  { offsetRight: '3.5rem' },
)

const emit = defineEmits<{ send: [command: string] }>()

const open = ref(false)
const rootEl = ref<HTMLDivElement | null>(null)
// 表单模式:null=关闭;有值=编辑该 id;showForm 单独标记新增(editingId 为 null 且 showForm)
const editingId = ref<string | null>(null)
const showForm = ref(false)
const draftLabel = ref('')
const draftDesc = ref('')
const draftCmd = ref('')
// Textarea 组件的 ref;原生 <textarea> 通过 $el 暴露
const cmdInputEl = ref<{ $el?: HTMLTextAreaElement } | null>(null)

const formTitle = computed(() => (editingId.value ? '编辑指令' : '新增指令'))

onClickOutside(rootEl, () => {
  open.value = false
  resetForm()
})

function resetForm() {
  showForm.value = false
  editingId.value = null
  draftLabel.value = ''
  draftDesc.value = ''
  draftCmd.value = ''
}

function toggleOpen() {
  open.value = !open.value
  if (!open.value) resetForm()
}

async function openAdd() {
  editingId.value = null
  draftLabel.value = ''
  draftDesc.value = ''
  draftCmd.value = ''
  showForm.value = true
  await nextTick()
  cmdInputEl.value?.$el?.focus()
}

async function openEdit(id: string) {
  const c = quickCommands.value.find((x) => x.id === id)
  if (!c) return
  editingId.value = id
  // 若 label 与 command 相同,别名视作空
  draftLabel.value = c.label === c.command ? '' : c.label
  draftDesc.value = c.description ?? ''
  draftCmd.value = c.command
  showForm.value = true
  await nextTick()
  cmdInputEl.value?.$el?.focus()
}

function submitForm() {
  const cmd = draftCmd.value.trim()
  if (!cmd) return
  if (editingId.value) {
    updateQuickCommand(editingId.value, {
      label: draftLabel.value,
      description: draftDesc.value,
      command: cmd,
    })
  } else {
    addQuickCommand(cmd, draftLabel.value, draftDesc.value)
  }
  resetForm()
}

function runCommand(cmd: string) {
  emit('send', cmd)
  open.value = false
}
</script>

<template>
  <div ref="rootEl" class="absolute bottom-3 z-10" :style="{ right: props.offsetRight }">
    <!-- 展开的快捷指令面板:定位在 FAB 上方 -->
    <div
      v-if="open"
      class="absolute bottom-11 right-0 flex w-96 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg ring-1 ring-black/5"
    >
      <!-- 面板标题 -->
      <div class="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div class="flex items-center gap-1.5 text-body font-medium">
          <Zap class="size-3.5 text-primary" />
          <span>快捷指令</span>
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="showForm && !editingId"
              @click="openAdd"
            >
              <Plus class="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新增快捷指令</TooltipContent>
        </Tooltip>
      </div>

      <!-- 新增 / 编辑表单;两种模式复用同一表单 -->
      <div
        v-if="showForm"
        class="flex flex-col gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-2"
      >
        <div class="text-caption text-muted-foreground">{{ formTitle }}</div>
        <Input
          v-model="draftLabel"
          size="sm"
          placeholder="别名(可选,默认用指令内容)"
        />
        <Input
          v-model="draftDesc"
          size="sm"
          placeholder="描述(可选,一句话说明用途)"
        />
        <!--
          Textarea 支持多行长命令输入,Ctrl+Enter 提交,Esc 取消。
          field-sizing-content 会根据内容自动伸缩,配合 max-h 避免过高
        -->
        <Textarea
          ref="cmdInputEl"
          v-model="draftCmd"
          placeholder="指令内容(Ctrl+Enter 保存,Esc 取消)"
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

      <!-- 指令列表:max-height 约 10 行,内容少时自动收缩,超出再滚动;命令允许换行完整展示,不再 truncate -->
      <div class="max-h-[320px] min-h-0 overflow-y-auto py-1">
        <div
          v-if="quickCommands.length === 0 && !showForm"
          class="px-3 py-4 text-center text-caption text-muted-foreground"
        >
          还没有快捷指令,点右上角 + 新建一条
        </div>
        <!--
          每条布局:
          - 顶行:发送图标 + 别名 + 右侧 hover 出现横排的编辑/删除按钮
          - 下方:描述(可选,muted 小字)
          - 再下:命令内容(仅当 label != command 时展示,允许多行完整显示)
          编辑/删除按钮和别名同一行,不会撑高整行
        -->
        <div
          v-for="c in quickCommands"
          :key="c.id"
          class="group relative flex items-start gap-1 px-1.5 py-0.5"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            @click="runCommand(c.command)"
          >
            <Send class="mt-0.5 size-3 shrink-0 text-muted-foreground group-hover:text-primary" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <!-- 别名 + 操作按钮同一行 -->
              <div class="flex items-center gap-1">
                <span class="text-body min-w-0 flex-1 truncate">{{ c.label }}</span>
                <!-- 预留右侧操作区宽度,避免 hover 时按钮出现挤压文本导致抖动 -->
                <span class="inline-block w-[3.75rem] shrink-0" aria-hidden="true" />
              </div>
              <!-- 描述:提醒命令用途,时间久了也不会忘 -->
              <span
                v-if="c.description"
                class="whitespace-pre-wrap text-caption text-muted-foreground/90"
              >
                {{ c.description }}
              </span>
              <!-- 命令内容:允许换行完整显示;pre-wrap 保留原格式,break-all 避免超宽 -->
              <span
                v-if="c.label !== c.command"
                class="whitespace-pre-wrap break-all font-mono text-caption text-muted-foreground"
              >
                {{ c.command }}
              </span>
            </div>
          </button>
          <!-- 操作按钮:hover 时出现,绝对定位在右上角与"别名"同高,不占布局 -->
          <div class="absolute right-2 top-1.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  @click.stop="openEdit(c.id)"
                >
                  <Pencil class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="hover:bg-destructive/20 hover:text-destructive"
                  @click.stop="removeQuickCommand(c.id)"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- FAB 圆钮 -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-full border border-border bg-popover text-foreground shadow-md ring-1 ring-black/5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="open && 'bg-primary text-primary-foreground hover:bg-primary/90'"
          @click="toggleOpen"
        >
          <Zap class="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">快捷指令</TooltipContent>
    </Tooltip>
  </div>
</template>
