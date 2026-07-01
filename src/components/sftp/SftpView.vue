<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import {
  Loader2,
  Save,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import FilePane from './FilePane.vue'
import {
  sftpOpen,
  sftpClose,
  sftpList,
  sftpMkdir,
  sftpRm,
  sftpRename,
  sftpRmdir,
  sftpHome,
  sftpReadFile,
  sftpWriteFile,
  localList,
  localMkdir,
  localRm,
  localRename as apiLocalRename,
  localRmdir,
  localHome,
  localReadFile,
  localWriteFile,
  localCopy,
  sftpCopyFile,
  type RemoteEntry,
} from '@/api/sftp'
import { openConfirm, openPrompt } from '@/stores/prompt'
import { toast } from '@/stores/toast'
import { startUpload, startDownload } from '@/stores/transfers'
import { closeTab } from '@/stores/tabs'

const props = defineProps<{
  tabId: string
  sessionId: string
  sftpId: string | null
  host: string
  user: string
}>()

// SFTP 会话
const sftpId = ref<string | null>(props.sftpId)

// 左右栏宽度比(本地栏百分比,默认 50)
const localWidthPct = ref(50)
const hDragging = ref(false)
const splitEl = ref<HTMLDivElement | null>(null)

// 本地栏状态
const localCwd = ref('')
const localEntries = ref<RemoteEntry[]>([])
const localLoading = ref(false)

// 远端栏状态
const remoteCwd = ref('')
const remoteEntries = ref<RemoteEntry[]>([])
const remoteLoading = ref(false)

// 预览/编辑
const preview = ref<{ name: string; path: string; side: 'local' | 'remote'; content: string; dirty: boolean } | null>(null)
const saving = ref(false)

// 文件剪贴板(Ctrl+C/X/V)
const clip = ref<{ from: 'local' | 'remote'; path: string; entry: RemoteEntry; mode: 'copy' | 'cut' } | null>(null)
// 当前激活的栏(接收快捷键的目标)
const activeSide = ref<'local' | 'remote'>('local')
// 各栏选中条目
const selectedLocal = ref<RemoteEntry | null>(null)
const selectedRemote = ref<RemoteEntry | null>(null)
// FilePane 实例引用(用于互关右键菜单)
const localPaneRef = ref<ComponentPublicInstance<{ closeMenu: () => void }> | null>(null)
const remotePaneRef = ref<ComponentPublicInstance<{ closeMenu: () => void }> | null>(null)

// 拖拽传输指示
const dragOver = ref<'local' | 'remote' | null>(null)

onMounted(async () => {
  if (!sftpId.value) {
    try {
      sftpId.value = await sftpOpen(props.sessionId)
    } catch (e: any) {
      toast.error(typeof e === 'string' ? e : e?.message ?? String(e), 'SFTP 打开失败')
      closeTab(props.tabId)
      return
    }
  }
  // 初始化两个栏的家目录
  try {
    localCwd.value = await localHome()
  } catch {
    localCwd.value = 'C:\\'
  }
  try {
    remoteCwd.value = await sftpHome(sftpId.value)
  } catch {
    remoteCwd.value = '/'
  }
  await Promise.all([refreshLocal(), refreshRemote()])
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(async () => {
  window.removeEventListener('keydown', onKeydown)
  if (hDragging.value) onHUp()
  if (sftpId.value) {
    try { await sftpClose(sftpId.value) } catch {}
  }
})

// ============================================================
// 本地栏操作
// ============================================================

async function refreshLocal() {
  // 注意:localCwd 为空串表示"此电脑"级(枚举盘符),不能用 falsy 判断跳过刷新,
  // 否则从盘符根 goUp 到此电脑时列表不会更新。
  if (localCwd.value == null) return
  localLoading.value = true
  try {
    localEntries.value = await localList(localCwd.value)
  } catch (e: any) {
    toast.error(String(e), '读取目录失败')
  } finally {
    localLoading.value = false
  }
}

async function localNavigate(path: string) {
  localCwd.value = path
  await refreshLocal()
}

async function goLocalHome() {
  try {
    localCwd.value = await localHome()
  } catch {
    localCwd.value = 'C:\\'
  }
  await refreshLocal()
}

async function localMkdirAction() {
  const name = await openPrompt({ title: '新建目录', placeholder: '目录名' })
  if (!name) return
  const path = joinPath(localCwd.value, name)
  try {
    await localMkdir(path)
    await refreshLocal()
  } catch (e: any) {
    toast.error(String(e), '创建失败')
  }
}

async function localDelete(e: RemoteEntry) {
  const ok = await openConfirm({
    title: '确认删除',
    message: `删除 ${e.isDir ? '目录' : '文件'}: ${e.name}?`,
    destructive: true,
    confirmText: '删除',
  })
  if (!ok) return
  const path = joinPath(localCwd.value, e.name)
  try {
    if (e.isDir) await localRmdir(path)
    else await localRm(path)
    await refreshLocal()
  } catch (err: any) {
    toast.error(String(err), '删除失败')
  }
}

async function localRename(e: RemoteEntry) {
  const name = await openPrompt({ title: '重命名', defaultValue: e.name })
  if (!name || name === e.name) return
  const oldPath = joinPath(localCwd.value, e.name)
  const newPath = joinPath(localCwd.value, name)
  try {
    await apiLocalRename(oldPath, newPath)
    await refreshLocal()
  } catch (err: any) {
    toast.error(String(err), '重命名失败')
  }
}

// ============================================================
// 远端栏操作
// ============================================================

async function refreshRemote() {
  if (!sftpId.value || !remoteCwd.value) return
  remoteLoading.value = true
  try {
    remoteEntries.value = await sftpList(sftpId.value, remoteCwd.value)
  } catch (e: any) {
    toast.error(String(e), '读取目录失败')
  } finally {
    remoteLoading.value = false
  }
}

async function remoteNavigate(path: string) {
  remoteCwd.value = path
  await refreshRemote()
}

async function goRemoteHome() {
  if (!sftpId.value) return
  try {
    remoteCwd.value = await sftpHome(sftpId.value)
  } catch {
    remoteCwd.value = '/'
  }
  await refreshRemote()
}

async function remoteMkdirAction() {
  if (!sftpId.value) return
  const name = await openPrompt({ title: '新建目录', placeholder: '目录名' })
  if (!name) return
  const path = joinPath(remoteCwd.value, name)
  try {
    await sftpMkdir(sftpId.value, path)
    await refreshRemote()
  } catch (e: any) {
    toast.error(String(e), '创建失败')
  }
}

async function remoteDelete(e: RemoteEntry) {
  const ok = await openConfirm({
    title: '确认删除',
    message: `删除远端 ${e.isDir ? '目录' : '文件'}: ${e.name}?`,
    destructive: true,
    confirmText: '删除',
  })
  if (!ok) return
  if (!sftpId.value) return
  const path = joinPath(remoteCwd.value, e.name)
  try {
    if (e.isDir) await sftpRmdir(sftpId.value, path)
    else await sftpRm(sftpId.value, path)
    await refreshRemote()
  } catch (err: any) {
    toast.error(String(err), '删除失败')
  }
}

async function remoteRename(e: RemoteEntry) {
  if (!sftpId.value) return
  const name = await openPrompt({ title: '重命名', defaultValue: e.name })
  if (!name || name === e.name) return
  const oldPath = joinPath(remoteCwd.value, e.name)
  const newPath = joinPath(remoteCwd.value, name)
  try {
    await sftpRename(sftpId.value, oldPath, newPath)
    await refreshRemote()
  } catch (err: any) {
    toast.error(String(err), '重命名失败')
  }
}

// ============================================================
// 左右栏宽度拖拽
// ============================================================

function onHDividerDown(e: MouseEvent) {
  e.preventDefault()
  hDragging.value = true
  document.addEventListener('mousemove', onHDrag)
  document.addEventListener('mouseup', onHUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onHDrag(e: MouseEvent) {
  if (!hDragging.value || !splitEl.value) return
  const rect = splitEl.value.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  // 限制 15%-85%
  localWidthPct.value = Math.max(15, Math.min(85, Math.round(pct)))
}

function onHUp() {
  hDragging.value = false
  document.removeEventListener('mousemove', onHDrag)
  document.removeEventListener('mouseup', onHUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

// ============================================================
// 传输
// ============================================================

/** 本地文件双击 → 上传到远端当前目录 */
async function uploadFromLocal(e: RemoteEntry) {
  if (!sftpId.value || e.isDir) return
  const localPath = joinPath(localCwd.value, e.name)
  await startUpload(sftpId.value, localPath, remoteCwd.value, e.name, e.size)
}

/** 远端文件双击 → 下载到本地当前目录 */
async function downloadFromRemote(e: RemoteEntry) {
  if (!sftpId.value || e.isDir) return
  const remotePath = joinPath(remoteCwd.value, e.name)
  await startDownload(sftpId.value, remotePath, localCwd.value, e.name, e.size)
}

// 拖拽:local → remote(上传),remote → local(下载)
function onDragStart(e: DragEvent, side: 'local' | 'remote', entry: RemoteEntry) {
  e.dataTransfer?.setData('text/plain', JSON.stringify({ side, entry }))
}

function onDragOver(e: DragEvent, side: 'local' | 'remote') {
  e.preventDefault()
  dragOver.value = side
}

function onDragLeave() {
  dragOver.value = null
}

async function onDrop(e: DragEvent, side: 'local' | 'remote') {
  e.preventDefault()
  dragOver.value = null
  const raw = e.dataTransfer?.getData('text/plain')
  if (!raw) return
  const { side: fromSide, entry } = JSON.parse(raw) as { side: string; entry: RemoteEntry }
  if (entry.isDir) return // 目录暂不支持拖拽传输(需递归,后续实现)

  if (fromSide === 'local' && side === 'remote') {
    await uploadFromLocal(entry)
  } else if (fromSide === 'remote' && side === 'local') {
    await downloadFromRemote(entry)
  }
}

// ============================================================
// 预览
// ============================================================

async function previewFile(side: 'local' | 'remote', e: RemoteEntry) {
  if (e.isDir) return
  try {
    let bytes: number[]
    if (side === 'remote') {
      if (!sftpId.value) return
      bytes = await sftpReadFile(sftpId.value, joinPath(remoteCwd.value, e.name))
    } else {
      bytes = await localReadFile(joinPath(localCwd.value, e.name))
    }
    const buf = new Uint8Array(bytes)
    // 含 NUL 字节视为二进制,不预览
    if (buf.includes(0)) {
      toast.info('该文件是二进制文件,不支持文本预览。', '无法预览')
      return
    }
    const content = new TextDecoder().decode(buf)
    preview.value = { name: e.name, path: joinPath(side === 'remote' ? remoteCwd.value : localCwd.value, e.name), side, content, dirty: false }
  } catch (err: any) {
    toast.error(String(err), '预览失败')
  }
}

async function savePreview() {
  if (!preview.value || saving.value) return
  saving.value = true
  try {
    const bytes = Array.from(new TextEncoder().encode(preview.value.content))
    if (preview.value.side === 'remote') {
      if (!sftpId.value) return
      await sftpWriteFile(sftpId.value, preview.value.path, bytes)
      await refreshRemote()
    } else {
      await localWriteFile(preview.value.path, bytes)
      await refreshLocal()
    }
    preview.value.dirty = false
  } catch (err: any) {
    toast.error(String(err), '保存失败')
  } finally {
    saving.value = false
  }
}

function onPreviewInput() {
  if (preview.value) preview.value.dirty = true
}

// ============================================================
// Ctrl+C / X / V 文件操作
// ============================================================

function onKeydown(e: KeyboardEvent) {
  // 输入框/文本域中不拦截
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'c') { e.preventDefault(); doCopy() }
  else if (k === 'x') { e.preventDefault(); doCut() }
  else if (k === 'v') { e.preventDefault(); void doPaste() }
}

function doCopy() {
  const sel = activeSide.value === 'local' ? selectedLocal.value : selectedRemote.value
  if (!sel) {
    toast.info('请先选中一个文件或目录', '未选中条目')
    return
  }
  const dir = activeSide.value === 'local' ? localCwd.value : remoteCwd.value
  clip.value = { from: activeSide.value, path: joinPath(dir, sel.name), entry: sel, mode: 'copy' }
  toast.info(`已复制:${sel.name}`, '剪贴板')
}

function doCut() {
  const sel = activeSide.value === 'local' ? selectedLocal.value : selectedRemote.value
  if (!sel) {
    toast.info('请先选中一个文件或目录', '未选中条目')
    return
  }
  const dir = activeSide.value === 'local' ? localCwd.value : remoteCwd.value
  clip.value = { from: activeSide.value, path: joinPath(dir, sel.name), entry: sel, mode: 'cut' }
  toast.info(`已剪切:${sel.name}`, '剪贴板')
}

async function doPaste() {
  if (!clip.value) {
    toast.info('剪贴板为空,请先复制或剪切', '无内容可粘贴')
    return
  }
  const { from, path: srcPath, entry, mode } = clip.value
  const to = activeSide.value
  if (entry.isDir) {
    toast.warning('目录的复制/剪切暂未实现,请使用拖拽传输。', '暂不支持')
    return
  }
  try {
    if (from === to) {
      // 同栏:copy → 副本,cut → 同目录无意义
      const dir = to === 'local' ? localCwd.value : remoteCwd.value
      if (mode === 'cut') {
        toast.info('源与目标在同一目录,已忽略', '无需剪切')
        return
      }
      const newName = deriveCopyName(entry.name)
      const dstPath = joinPath(dir, newName)
      if (to === 'local') await localCopy(srcPath, dstPath)
      else { if (!sftpId.value) return; await sftpCopyFile(sftpId.value, srcPath, dstPath) }
      toast.success(`已粘贴为 ${newName}`, '粘贴完成')
    } else {
      // 跨栏:传输
      if (from === 'local' && to === 'remote') await uploadFromLocal(entry)
      else if (from === 'remote' && to === 'local') await downloadFromRemote(entry)
      if (mode === 'cut') {
        // 删除源(不经确认,剪切是用户意图)
        if (from === 'local') await localRm(srcPath)
        else { if (!sftpId.value) return; await sftpRm(sftpId.value, srcPath) }
      }
      toast.success(
        `${mode === 'cut' ? '已移动' : '已开始传输'}:${entry.name}`,
        mode === 'cut' ? '剪切完成' : '粘贴',
      )
    }
    if (to === 'local') await refreshLocal()
    else await refreshRemote()
    if (from !== to && mode === 'cut') {
      if (from === 'local') await refreshLocal()
      else await refreshRemote()
    }
    if (mode === 'cut') clip.value = null
  } catch (err: any) {
    toast.error(String(err), '粘贴失败')
  }
}

/** 生成副本文件名,如 a.txt → a (副本).txt;a → a (副本) */
function deriveCopyName(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return name.slice(0, dot) + ' (副本)' + name.slice(dot)
  return name + ' (副本)'
}

// ============================================================
// 辅助
// ============================================================

function joinPath(dir: string, name: string): string {
  // 本地 Windows 用 \,远端用 /。根据 dir 末尾分隔符判断
  const sep = dir.includes('\\') ? '\\' : '/'
  if (dir.endsWith(sep)) return dir + name
  return dir + sep + name
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 双栏 -->
    <div ref="splitEl" class="relative flex min-h-0 flex-1">
      <!-- 本地栏 -->
      <div
        class="flex shrink-0 flex-col overflow-hidden"
        :style="{ width: localWidthPct + '%' }"
        :class="dragOver === 'local' && 'ring-1 ring-primary ring-inset'"
        @dragover="onDragOver($event, 'local')"
        @dragleave="onDragLeave"
        @drop="onDrop($event, 'local')"
        @mousedown="activeSide = 'local'"
      >
        <div class="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1 text-[11px] font-medium">
          <span>本地</span>
          <span class="text-muted-foreground">{{ localCwd }}</span>
        </div>
        <FilePane
          ref="localPaneRef"
          side="local"
          :entries="localEntries"
          :cwd="localCwd"
          :loading="localLoading"
          @navigate="localNavigate"
          @refresh="refreshLocal"
          @mkdir="localMkdirAction"
          @home="goLocalHome"
          @transfer="uploadFromLocal"
          @preview="previewFile('local', $event)"
          @rename="localRename"
          @delete="localDelete"
          @select="selectedLocal = $event"
          @menuopen="remotePaneRef?.closeMenu()"
        />
      </div>

      <!-- 左右分隔条(可拖拽调宽) -->
      <div
        class="group relative w-[3px] shrink-0 cursor-col-resize bg-border hover:bg-primary/50"
        @mousedown="onHDividerDown"
      >
        <div class="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 group-hover:bg-primary" />
      </div>

      <!-- 远端栏 -->
      <div
        class="flex min-w-0 flex-1 flex-col overflow-hidden"
        :class="dragOver === 'remote' && 'ring-1 ring-primary ring-inset'"
        @dragover="onDragOver($event, 'remote')"
        @dragleave="onDragLeave"
        @drop="onDrop($event, 'remote')"
        @mousedown="activeSide = 'remote'"
      >
        <div class="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1 text-[11px] font-medium">
          <span>远端 {{ user }}@{{ host }}</span>
          <span class="text-muted-foreground">{{ remoteCwd }}</span>
        </div>
        <FilePane
          ref="remotePaneRef"
          side="remote"
          :entries="remoteEntries"
          :cwd="remoteCwd"
          :loading="remoteLoading"
          @navigate="remoteNavigate"
          @refresh="refreshRemote"
          @mkdir="remoteMkdirAction"
          @home="goRemoteHome"
          @transfer="downloadFromRemote"
          @preview="previewFile('remote', $event)"
          @rename="remoteRename"
          @delete="remoteDelete"
          @select="selectedRemote = $event"
          @menuopen="localPaneRef?.closeMenu()"
        />
      </div>
    </div>

    <!-- 预览/编辑对话框 -->
    <Dialog :open="!!preview" @update:open="(v) => { if (!v) preview = null }">
      <DialogContent v-if="preview" class="flex max-h-[85vh] flex-col gap-2 p-4 sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <span>{{ preview.name }}</span>
            <span v-if="preview.dirty" class="text-[11px] text-muted-foreground">未保存</span>
          </DialogTitle>
        </DialogHeader>
        <textarea
          v-model="preview.content"
          @input="onPreviewInput"
          spellcheck="false"
          class="h-[60vh] w-full resize-none rounded-md bg-muted/50 p-3 font-mono text-[12px] leading-5 outline-none focus:ring-1 focus:ring-primary"
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="sm" @click="preview = null">关闭</Button>
          <Button size="sm" :disabled="!preview.dirty || saving" @click="savePreview">
            <Loader2 v-if="saving" class="size-3.5 animate-spin" />
            <Save v-else class="size-3.5" />
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
