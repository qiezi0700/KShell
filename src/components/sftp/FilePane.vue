<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  ArrowUp,
  ArrowLeft,
  RefreshCw,
  FolderPlus,
  Home,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  FileText,
  Image as ImageIcon,
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
  menuopen: []
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

// 右键菜单
const menu = ref<{ x: number; y: number; entry: RemoteEntry | null } | null>(null)

function onContextmenu(ev: MouseEvent, e: RemoteEntry | null) {
  ev.preventDefault()
  menu.value = { x: ev.clientX, y: ev.clientY, entry: e }
  if (e) selected.value = e.name
  emit('menuopen')
}

function closeMenu() {
  menu.value = null
}

// 此电脑级(cwd 为空):条目是盘符伪目录,不允许改名/删除;空白处也不能新建目录
const isThisPcLevel = computed(() => props.side === 'local' && props.cwd === '')

const menuItems = computed(() => {
  const e = menu.value?.entry
  const items: { label: string; action: () => void; danger?: boolean }[] = []
  if (e) {
    if (!e.isDir) {
      items.push({ label: '传输到对端', action: () => { emit('transfer', e!); closeMenu() } })
      items.push({ label: '预览', action: () => { emit('preview', e!); closeMenu() } })
    }
    if (!isThisPcLevel.value) {
      items.push({ label: '重命名', action: () => { emit('rename', e!); closeMenu() } })
      items.push({ label: '删除', action: () => { emit('delete', e!); closeMenu() }, danger: true })
    }
  } else {
    if (!isThisPcLevel.value) {
      items.push({ label: '新建目录', action: () => { emit('mkdir'); closeMenu() } })
    }
    items.push({ label: '刷新', action: () => { emit('refresh'); closeMenu() } })
  }
  return items
})

// 暴露 menu 关闭方法给父组件(点击空白处)
defineExpose({ closeMenu })
</script>

<template>
  <div class="flex h-full flex-col" @click="closeMenu">
    <!-- 工具栏 -->
    <div class="flex items-center gap-1 border-b border-border px-2 py-1">
      <Button variant="ghost" size="icon" class="size-6" @click="goUp" title="上级">
        <ArrowUp class="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" class="size-6" @click="emit('home')" title="家目录">
        <Home class="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" class="size-6" @click="emit('refresh')" title="刷新">
        <RefreshCw class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-6"
        :disabled="isThisPcLevel"
        @click="emit('mkdir')"
        title="新建目录"
      >
        <FolderPlus class="size-3.5" />
      </Button>
      <Input
        v-model="pathInput"
        class="h-6 text-[11px]"
        @keydown.enter="onPathEnter"
      />
    </div>

    <!-- 面包屑:chevron + button 成对出现,首项前不带 chevron -->
    <div class="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      <template v-for="(c, i) in crumbs" :key="i">
        <ChevronRight v-if="i > 0" class="size-3 shrink-0" />
        <button
          class="shrink-0 rounded px-1 hover:bg-muted hover:text-foreground"
          @click="emit('navigate', c)"
        >{{ c === '' ? '此电脑' : (c.split('/').filter(Boolean).pop() || '/') }}</button>
      </template>
    </div>

    <!-- 文件列表 -->
    <ScrollArea class="flex-1">
      <div
        class="select-none text-[12px]"
        @contextmenu="onContextmenu($event, null)"
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
            'flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-muted/50',
            selected === e.name && 'bg-primary/10',
          )"
          draggable="true"
          @click="onItemClick(e)"
          @dblclick="onItemDblclick(e)"
          @contextmenu="onContextmenu($event, e)"
        >
          <component :is="iconFor(e)" class="size-4 shrink-0 text-muted-foreground" />
          <span class="flex-1 truncate">{{ e.name }}</span>
          <span class="w-20 shrink-0 text-right text-[10px] text-muted-foreground">{{ fmtSize(e.size) }}</span>
          <span class="w-28 shrink-0 text-right text-[10px] text-muted-foreground">{{ fmtDate(e.modified) }}</span>
        </div>
      </div>
    </ScrollArea>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="menu"
        class="fixed z-50 min-w-[120px] rounded-md border border-border bg-popover py-1 text-[12px] shadow-md"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @click.stop
      >
        <button
          v-for="item in menuItems"
          :key="item.label"
          :class="cn(
            'block w-full px-3 py-1 text-left hover:bg-muted',
            item.danger && 'text-destructive hover:bg-destructive/10',
          )"
          @click="item.action"
        >{{ item.label }}</button>
      </div>
    </Teleport>
  </div>
</template>
