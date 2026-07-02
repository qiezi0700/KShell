<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  FolderPlus,
  Home,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  FileText,
  Image as ImageIcon,
  Eye,
  Pencil,
  Trash2,
} from 'lucide-vue-next'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RemoteEntry } from '@/api/sftp'

const props = defineProps<{
  side: 'local' | 'remote'
  entries: RemoteEntry[]
  cwd: string
  loading: boolean
  host?: string
  user?: string
}>()

const emit = defineEmits<{
  navigate: [path: string]
  refresh: []
  mkdir: []
  home: []
  select: [entry: RemoteEntry | null]
  transfer: [entry: RemoteEntry]  // 双击触发传输
  preview: [entry: RemoteEntry]
  rename: [entry: RemoteEntry]
  delete: [entry: RemoteEntry]
  itemmousedown: [entry: RemoteEntry, event: MouseEvent]  // 条目按下,父组件用于启动 pane-to-pane 拖拽
}>()

const selected = ref<string | null>(null)
const pathInput = ref(props.cwd)

watch(() => props.cwd, (v) => { pathInput.value = v })

function breadcrumbs(): string[] {
  // 此电脑级别
  if (props.cwd === '') return ['']
  // 统一用 / 分隔;本地 Windows 路径也临时替换便于显示
  const p = props.cwd.replace(/\\/g, '/')
  const parts = p.split('/').filter(Boolean)
  const result: string[] = []
  // Windows 盘符保留
  const start = parts[0]?.endsWith(':') ? parts[0] : ''
  if (start) {
    result.push(start + '/')
    parts.shift()
  } else {
    result.push('/')
  }
  let cur = start ? start + '/' : '/'
  for (const part of parts) {
    cur = cur.endsWith('/') ? cur + part : cur + '/' + part
    result.push(cur)
  }
  return result
}

const crumbs = computed(() => breadcrumbs())

// 当前选中的条目对象(工具栏操作按钮基于此启用)
const selectedEntry = computed(() =>
  props.entries.find(e => e.name === selected.value) ?? null,
)

function onItemClick(e: RemoteEntry) {
  selected.value = e.name
  emit('select', e)
}

function clearSelect() {
  selected.value = null
  emit('select', null)
}

function onItemDblclick(e: RemoteEntry) {
  if (e.isDir) {
    // 此电脑级别(cwd 为空):盘符条目 name 形如 "C:",进入 "C:\"
    if (props.cwd === '') {
      emit('navigate', e.name + '\\')
      return
    }
    const sep = props.cwd.includes('\\') ? '\\' : '/'
    const base = props.cwd.endsWith(sep) ? props.cwd : props.cwd + sep
    emit('navigate', base + e.name)
  } else {
    // 文件:双击预览
    emit('preview', e)
  }
}

// 拖拽起步:把 side + entry 序列化进 dataTransfer,供 SftpView 的 onDrop 解析分派上传/下载
// (Windows + Tauri 原生 OLE 拦截下 HTML5 DnD 不可用,改由 mousedown 上报父组件模拟拖拽)
function onItemMouseDown(e: MouseEvent, entry: RemoteEntry) {
  emit('itemmousedown', entry, e)
}

function goUp() {
  const cwd = props.cwd
  if (cwd === '') return
  // 盘符根目录(如 D:\ 或 D:/):上一级是"此电脑"(空路径)
  if (/^[A-Za-z]:[\\\/]$/.test(cwd)) {
    emit('navigate', '')
    return
  }
  const sep = cwd.includes('\\') ? '\\' : '/'
  const idx = cwd.lastIndexOf(sep)
  // Unix 一级目录(如 /home):上级是 /
  if (sep === '/' && idx === 0) {
    emit('navigate', '/')
    return
  }
  if (idx <= 0) return
  const parent = cwd.slice(0, idx)
  // parent 是盘符(如 D:)→ 补分隔符变成 D:\
  if (/^[A-Za-z]:$/.test(parent)) {
    emit('navigate', parent + sep)
    return
  }
  emit('navigate', parent)
}

function onPathEnter() {
  emit('navigate', pathInput.value)
}

function iconFor(e: RemoteEntry) {
  if (e.isDir) return FolderIcon
  const ext = e.name.split('.').pop()?.toLowerCase()
  if (['txt', 'log', 'md', 'json', 'yaml', 'yml', 'toml', 'rs', 'ts', 'js', 'vue', 'py', 'go', 'c', 'cpp', 'h', 'sh'].includes(ext ?? '')) return FileText
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext ?? '')) return ImageIcon
  return FileIcon
}

function fmtSize(n: number) {
  if (n === 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function fmtDate(s: string) {
  if (!s) return ''
  try {
    const d = new Date(s)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

// 此电脑级(cwd 为空):条目是盘符伪目录,不允许改名/删除;空白处也不能新建目录
const isThisPcLevel = computed(() => props.side === 'local' && props.cwd === '')
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 工具栏 -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
      <span
        class="text-caption shrink-0 rounded-sm px-1.5 py-0.5"
        :class="side === 'local' ? 'bg-panel-2 text-muted-foreground' : 'bg-primary/15 text-primary'"
      >{{ side === 'local' ? '本地' : `${user}@${host}` }}</span>
      <Button variant="ghost" size="icon-sm" @click="goUp" title="上级">
        <ArrowUp />
      </Button>
      <Button variant="ghost" size="icon-sm" @click="emit('home')" title="家目录">
        <Home />
      </Button>
      <Button variant="ghost" size="icon-sm" @click="emit('refresh')" title="刷新">
        <RefreshCw />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :disabled="isThisPcLevel"
        @click="emit('mkdir')"
        title="新建目录"
      >
        <FolderPlus />
      </Button>
      <Input
        v-model="pathInput"
        class="text-body flex-1"
        :style="{ height: 'var(--size-row-sm)' }"
        @keydown.enter="onPathEnter"
      />
      <!-- 条目操作按钮:基于当前选中条目启用 -->
      <div class="flex items-center gap-0.5 border-l border-border pl-1 ml-1">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!selectedEntry"
          :title="side === 'local' ? '上传到远端' : '下载到本地'"
          @click="selectedEntry && emit('transfer', selectedEntry)"
        >
          <ArrowRight v-if="side === 'local'" />
          <ArrowLeft v-else />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!selectedEntry || selectedEntry.isDir"
          title="预览"
          @click="selectedEntry && !selectedEntry.isDir && emit('preview', selectedEntry)"
        >
          <Eye />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!selectedEntry || isThisPcLevel"
          title="重命名"
          @click="selectedEntry && emit('rename', selectedEntry)"
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="!selectedEntry || isThisPcLevel"
          title="删除"
          @click="selectedEntry && emit('delete', selectedEntry)"
        >
          <Trash2 class="text-destructive" />
        </Button>
      </div>
    </div>

    <!-- 面包屑:chevron + button 成对出现,首项前不带 chevron -->
    <div class="text-body flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 text-muted-foreground" :style="{ height: 'var(--size-row-sm)' }">
      <template v-for="(c, i) in crumbs" :key="i">
        <ChevronRight v-if="i > 0" class="size-3.5 shrink-0 opacity-60" />
        <Button
          variant="ghost"
          size="xs"
          class="shrink-0"
          @click="emit('navigate', c)"
        >{{ c === '' ? '此电脑' : (c.split('/').filter(Boolean).pop() || '/') }}</Button>
      </template>
    </div>

    <!-- 文件列表 -->
    <ScrollArea class="flex-1">
      <div
        class="text-body select-none"
        @click="clearSelect"
      >
        <div
          v-if="loading"
          class="py-8 text-center text-muted-foreground"
        >加载中…</div>
        <div
          v-else-if="entries.length === 0"
          class="py-8 text-center text-muted-foreground"
        >空目录</div>
        <div
          v-for="e in entries"
          :key="e.name"
          :class="cn(
            'flex cursor-pointer items-center gap-2 px-2 hover:bg-panel-2',
            selected === e.name && 'bg-primary/15 hover:bg-primary/15',
          )"
          :style="{ height: 'var(--size-row-list)' }"
          draggable="false"
          @click.stop="onItemClick(e)"
          @dblclick="onItemDblclick(e)"
          @mousedown.stop="onItemMouseDown($event, e)"
        >
          <component :is="iconFor(e)" :class="cn('size-4 shrink-0', e.isDir ? 'text-warning' : 'text-muted-foreground')" />
          <span :class="cn('flex-1 truncate', e.isDir && 'font-medium')">{{ e.name }}</span>
          <span class="text-caption w-24 shrink-0 text-right font-normal tracking-normal normal-case font-mono tabular-nums text-muted-foreground whitespace-nowrap">{{ fmtSize(e.size) }}</span>
          <span class="text-caption w-32 shrink-0 text-right font-normal tracking-normal normal-case font-mono tabular-nums text-muted-foreground whitespace-nowrap">{{ fmtDate(e.modified) }}</span>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
