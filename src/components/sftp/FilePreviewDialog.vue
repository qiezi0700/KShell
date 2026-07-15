<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  Check,
  Copy,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
} from '@lucide/vue'

import {
  localReadFile,
  localWriteFile,
  sftpReadFile,
  sftpWriteFile,
} from '@/api/sftp'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { highlightCode } from '@/lib/highlight'
import { openConfirm } from '@/stores/prompt'
import { toast } from '@/stores/toast'

import {
  decodePreviewBytes,
  encodePreviewText,
  formatPreviewSize,
  type FilePreviewTarget,
  type PreviewEncoding,
} from './filePreview'

const props = defineProps<{
  target: FilePreviewTarget | null
  sftpId: string | null
}>()

const emit = defineEmits<{
  close: []
  saved: [target: FilePreviewTarget]
}>()

const mode = ref<'view' | 'edit'>('view')
const content = ref('')
const originalContent = ref('')
const encoding = ref<PreviewEncoding>('UTF-8')
const highlighted = ref('')
const loading = ref(false)
const saving = ref(false)
const copied = ref(false)
const confirmingClose = ref(false)
const error = ref<string | null>(null)
let loadSequence = 0
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

const isDirty = computed(() => content.value !== originalContent.value)
const sourceLabel = computed(() => props.target?.side === 'remote' ? '远端文件' : '本地文件')
const encodingLabel = computed(() => loading.value ? '?????' : encoding.value)

onBeforeUnmount(() => {
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
})

watch(
  () => props.target,
  (target) => {
    loadSequence++
    copied.value = false
    mode.value = 'view'
    content.value = ''
    originalContent.value = ''
    highlighted.value = ''
    encoding.value = 'UTF-8'
    error.value = null
    if (target) void loadFile(target, loadSequence)
  },
  { immediate: true },
)

async function loadFile(target: FilePreviewTarget, sequence = ++loadSequence) {
  loading.value = true
  error.value = null
  try {
    let bytes: number[]
    if (target.side === 'remote') {
      const id = props.sftpId
      if (!id) throw new Error('SFTP 会话未就绪。')
      bytes = await sftpReadFile(id, target.path)
    } else {
      if (!props.sftpId) throw new Error('SFTP 会话未就绪')
      bytes = await localReadFile(props.sftpId, target.path)
    }

    if (sequence !== loadSequence || props.target?.path !== target.path) return
    const decoded = decodePreviewBytes(new Uint8Array(bytes))
    content.value = decoded.content
    originalContent.value = decoded.content
    encoding.value = decoded.encoding
    highlighted.value = highlightCode(decoded.content, target.name)
  } catch (cause: unknown) {
    if (sequence !== loadSequence) return
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function switchMode(nextMode: 'view' | 'edit') {
  mode.value = nextMode
  if (nextMode === 'view' && props.target) {
    highlighted.value = highlightCode(content.value, props.target.name)
  }
}

async function copyContent() {
  if (!content.value) return
  try {
    await navigator.clipboard.writeText(content.value)
    copied.value = true
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer)
    copyFeedbackTimer = setTimeout(() => {
      copied.value = false
      copyFeedbackTimer = null
    }, 1200)
  } catch (cause: unknown) {
    toast.error(cause instanceof Error ? cause.message : String(cause), '复制失败')
  }
}

async function saveFile() {
  const target = props.target
  if (!target || saving.value || !isDirty.value) return

  saving.value = true
  try {
    const bytes = Array.from(encodePreviewText(content.value, encoding.value))
    if (target.side === 'remote') {
      const id = props.sftpId
      if (!id) throw new Error('SFTP 会话未就绪。')
      await sftpWriteFile(id, target.path, bytes)
    } else {
      if (!props.sftpId) throw new Error('SFTP 会话未就绪')
      await localWriteFile(props.sftpId, target.path, bytes)
    }
    if (props.target?.path !== target.path) return
    originalContent.value = content.value
    highlighted.value = highlightCode(content.value, target.name)
    toast.success(`已保存 ${target.name}`, '文件保存')
    emit('saved', target)
  } catch (cause: unknown) {
    toast.error(cause instanceof Error ? cause.message : String(cause), '保存失败')
  } finally {
    saving.value = false
  }
}

async function requestClose() {
  if (confirmingClose.value) return
  if (saving.value) {
    toast.info('文件正在保存，请稍候。', '暂时无法关闭')
    return
  }
  if (isDirty.value) {
    confirmingClose.value = true
    try {
      const confirmed = await openConfirm({
        title: '放弃未保存的修改？',
        message: `${props.target?.name ?? '当前文件'} 的修改尚未保存，关闭后将无法恢复。`,
        destructive: true,
        confirmText: '放弃修改',
      })
      if (!confirmed) return
    } finally {
      confirmingClose.value = false
    }
  }
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() !== 's' || mode.value !== 'edit') return
  event.preventDefault()
  void saveFile()
}
</script>

<template>
  <Dialog :open="!!target" @update:open="(open) => { if (!open) void requestClose() }">
    <DialogContent
      class="flex h-[min(86vh,820px)] w-[min(92vw,1100px)] max-w-none grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      @keydown="onKeydown"
    >
      <DialogHeader class="border-b border-border px-5 py-4 pr-12">
        <DialogTitle class="flex min-w-0 items-center gap-2 text-sm font-medium">
          <FileText class="size-4 shrink-0 text-primary" />
          <span class="truncate">{{ target?.name }}</span>
          <span
            v-if="isDirty"
            class="text-caption shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 font-normal tracking-normal normal-case text-warning"
          >未保存</span>
          <Button
            variant="ghost"
            size="sm"
            class="ml-auto shrink-0"
            :disabled="loading || !!error || !content"
            :title="copied ? '已复制全部内容' : '复制全部内容'"
            @click="copyContent"
          >
            <Check v-if="copied" class="text-success" />
            <Copy v-else />
            {{ copied ? '已复制' : '复制全部' }}
          </Button>
        </DialogTitle>
        <DialogDescription class="mt-1 flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
          <span class="shrink-0">{{ sourceLabel }}</span>
          <span class="text-border">•</span>
          <span class="shrink-0">{{ encodingLabel }}</span>
          <span class="text-border">•</span>
          <span class="shrink-0">{{ formatPreviewSize(target?.size ?? 0) }}</span>
          <span class="text-border">•</span>
          <span class="truncate font-mono" :title="target?.path">{{ target?.path }}</span>
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 bg-panel-2">
        <div v-if="loading" class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 class="size-5 animate-spin text-primary" />
          <span class="text-body">正在读取文件…</span>
        </div>
        <div v-else-if="error" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <FileText class="size-8 text-muted-foreground" />
          <div>
            <div class="text-body font-medium text-foreground">无法预览此文件</div>
            <div class="mt-1 max-w-xl text-caption text-muted-foreground">{{ error }}</div>
          </div>
          <Button v-if="target" variant="secondary" size="sm" @click="loadFile(target)">
            <RefreshCw />
            重新加载
          </Button>
        </div>
        <div v-else-if="mode === 'view'" class="h-full overflow-auto p-4 selection:bg-primary/25">
          <pre class="m-0 min-w-max select-text whitespace-pre"><code class="hljs text-body font-mono leading-5" v-html="highlighted" /></pre>
        </div>
        <Textarea
          v-else
          v-model="content"
          spellcheck="false"
          class="text-body h-full w-full resize-none rounded-none border-0 bg-panel-2 p-4 font-mono leading-5 shadow-none [field-sizing:fixed] focus-visible:border-0 focus-visible:ring-0"
        />
      </div>

      <div class="flex items-center justify-between border-t border-border bg-card px-4 py-3">
        <div class="flex items-center gap-1 rounded-md bg-panel-2 p-0.5">
          <Button
            size="sm"
            :variant="mode === 'view' ? 'secondary' : 'ghost'"
            :disabled="loading || !!error"
            @click="switchMode('view')"
          >
            <Eye />
            查看
          </Button>
          <Button
            size="sm"
            :variant="mode === 'edit' ? 'secondary' : 'ghost'"
            :disabled="loading || !!error"
            @click="switchMode('edit')"
          >
            <Pencil />
            编辑
          </Button>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="mode === 'edit'" class="hidden text-caption text-muted-foreground sm:inline">Ctrl+S 保存</span>
          <Button variant="ghost" size="sm" @click="requestClose">关闭</Button>
          <Button
            v-if="mode === 'edit'"
            size="sm"
            :disabled="!isDirty || saving"
            @click="saveFile"
          >
            <Loader2 v-if="saving" class="animate-spin" />
            <Save v-else />
            {{ saving ? '保存中' : '保存' }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
