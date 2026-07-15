<script setup lang="ts">
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

import { settingsGet, settingsSet } from '@/api/settings'
import {
  sftpOpen,
  sftpClose,
  sftpList,
  sftpMkdir,
  sftpRm,
  sftpRename,
  sftpRmdir,
  sftpHome,
  localList,
  localListRoots,
  localMkdir,
  localRm,
  localRename as apiLocalRename,
  localRmdir,
  localHome,
  localSelectRoot,
  localCopy,
  localStat,
  sftpCopyFile,
  type RemoteEntry,
} from '@/api/sftp'
import { Button } from '@/components/ui/button'
import { openConfirm, openPrompt } from '@/stores/prompt'
import { activeTabId, closeTab } from '@/stores/tabs'
import { toast } from '@/stores/toast'
import { startUpload, startDownload, startUploadDir, startDownloadDir, startCopyRemoteDir } from '@/stores/transfers'

import FilePane from './FilePane.vue'
import FilePreviewDialog from './FilePreviewDialog.vue'
import type { FilePreviewTarget } from './filePreview'

const props = defineProps<{
  tabId: string
  sessionId: string
  sftpId: string | null
  host: string
  user: string
  closeTabOnOpenError?: boolean
}>()

const emit = defineEmits<{
  openError: [message: string]
}>()

// SFTP 会话
const sftpId = ref<string | null>(props.sftpId)

// 左右栏宽度比(本地栏百分比,默认 50)。持久化到 SQLite settings
// ref 先用默认值,onMounted 异步从 SQLite 加载真实值
const localWidthPct = ref(50)
let localWidthReady = false
const hDragging = ref(false)
const splitEl = ref<HTMLDivElement | null>(null)

// 本地栏状态
const localCwd = ref('')
const localRoot = ref('')
const localEntries = ref<RemoteEntry[]>([])
const localLoading = ref(false)

// 远端栏状态
const remoteCwd = ref('')
const remoteEntries = ref<RemoteEntry[]>([])
const remoteLoading = ref(false)

// 预览/编辑
const preview = ref<FilePreviewTarget | null>(null)

// 文件剪贴板(Ctrl+C/X/V)
const clip = ref<{ from: 'local' | 'remote'; path: string; entry: RemoteEntry; mode: 'copy' | 'cut' } | null>(null)
// 当前激活的栏(接收快捷键的目标)
const activeSide = ref<'local' | 'remote'>('local')
// 各栏选中条目
const selectedLocal = ref<RemoteEntry | null>(null)
const selectedRemote = ref<RemoteEntry | null>(null)

// 拖拽传输指示(OS 文件拖入高亮 + pane-to-pane 拖拽高亮共用)
const dragOver = ref<'local' | 'remote' | null>(null)

// Tauri v2 原生 drag-drop 事件的反注册函数(处理从资源管理器拖入的 OS 文件)
let unlistenDragDrop: UnlistenFn | null = null
let isUnmounted = false

function closeSftpLease(id: string) {
  void sftpClose(id).catch((error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error), 'SFTP 关闭失败')
  })
}

onMounted(async () => {
  // 异步从 SQLite 加载左右栏宽度比,加载完才允许回写
  void settingsGet('sftp-local-width-pct')
    .then((raw) => {
      if (raw != null) {
        const n = Number(raw)
        if (Number.isFinite(n)) localWidthPct.value = Math.min(Math.max(Math.round(n), 15), 85)
      }
    })
    .catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : String(e), '文件面板布局读取失败')
    })
    .finally(() => {
      localWidthReady = true
    })

  if (!sftpId.value) {
    try {
      const openedId = await sftpOpen(props.sessionId)
      if (isUnmounted) {
        closeSftpLease(openedId)
        return
      }
      sftpId.value = openedId
    } catch (e: unknown) {
      if (isUnmounted) return
      const message = e instanceof Error ? e.message : String(e)
      toast.error(message, 'SFTP 打开失败')
      emit('openError', message)
      if (props.closeTabOnOpenError !== false) closeTab(props.tabId)
      return
    }
  }
  const readySftpId = sftpId.value
  if (!readySftpId || isUnmounted) return
  // 本地授权与远端会话相互独立，本地目录异常不能阻断远端文件管理。
  try {
    localRoot.value = await localHome(readySftpId)
    localCwd.value = localRoot.value
  } catch (error: unknown) {
    toast.warning(
      error instanceof Error ? error.message : String(error),
      '请选择本地工作目录',
    )
  }
  try {
    remoteCwd.value = await sftpHome(readySftpId)
  } catch {
    remoteCwd.value = '/'
  }
  if (isUnmounted) return
  await Promise.all([refreshLocal(), refreshRemote()])
  if (isUnmounted) return
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)

  // 监听系统级文件拖入(拖 Windows 资源管理器里的文件到窗口)。
  // WebView 的 DOM drop 事件在 Tauri v2 里拿不到真实磁盘路径,必须走这个 API。
  // 只对本组件可见的双栏容器做命中测试,拖到其他标签页/侧边栏时忽略。
  try {
    const dragDropUnlisten = await getCurrentWebview().onDragDropEvent(event => {
      const p = event.payload
      if (p.type === 'enter' || p.type === 'over') {
        dragOver.value = hitTestSide(p.position)
      } else if (p.type === 'leave') {
        dragOver.value = null
      } else if (p.type === 'drop') {
        const side = hitTestSide(p.position)
        dragOver.value = null
        if (side && p.paths.length > 0) {
          void handleExternalDrop(side, p.paths)
        }
      }
    })
    if (isUnmounted) {
      dragDropUnlisten()
    } else {
      unlistenDragDrop = dragDropUnlisten
    }
  } catch (error: unknown) {
    if (!isUnmounted) {
      toast.error(error instanceof Error ? error.message : String(error), '系统拖拽监听失败')
    }
  }
})

onBeforeUnmount(() => {
  isUnmounted = true
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
  unlistenDragDrop?.()
  if (hDragging.value) onHUp()
  const leaseId = sftpId.value
  sftpId.value = null
  if (leaseId) closeSftpLease(leaseId)
})

// ============================================================
// 本地栏操作
// ============================================================

async function refreshLocal() {
  if (!sftpId.value) return
  localLoading.value = true
  try {
    localEntries.value = localCwd.value
      ? await localList(sftpId.value, localCwd.value)
      : await localListRoots(sftpId.value)
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : String(e), '读取目录失败')
  } finally {
    localLoading.value = false
  }
}

async function localNavigate(path: string) {
  if (!sftpId.value || localLoading.value) return
  localLoading.value = true
  try {
    const entries = path
      ? await localList(sftpId.value, path)
      : await localListRoots(sftpId.value)
    localCwd.value = path
    localEntries.value = entries
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : String(error), '读取目录失败')
  } finally {
    localLoading.value = false
  }
}

async function goLocalHome() {
  if (localRoot.value) await localNavigate(localRoot.value)
}

async function selectLocalRoot(suggestedPath?: string) {
  if (!sftpId.value) return
  try {
    const selected = await localSelectRoot(sftpId.value, suggestedPath)
    if (!selected) return
    localRoot.value = selected
    await localNavigate(selected)
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : String(error), '本地目录授权失败')
  }
}

async function localMkdirAction() {
  const name = await openPrompt({ title: '新建目录', placeholder: '目录名' })
  if (!name) return
  const path = joinPath(localCwd.value, name)
  try {
    if (!sftpId.value) return
    await localMkdir(sftpId.value, path)
    await refreshLocal()
  } catch (e: any) {
    toast.error(String(e), '创建失败')
  }
}

async function localDelete(e: RemoteEntry) {
  const ok = await openConfirm({
    title: '确认删除',
    message: e.isDir
      ? `删除目录 ${e.name} 及其全部内容?此操作不可撤销。`
      : `删除文件 ${e.name}?`,
    destructive: true,
    confirmText: '删除',
  })
  if (!ok) return
  const path = joinPath(localCwd.value, e.name)
  try {
    if (!sftpId.value) return
    if (e.isDir) await localRmdir(sftpId.value, path)
    else await localRm(sftpId.value, path)
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
    if (!sftpId.value) return
    await apiLocalRename(sftpId.value, oldPath, newPath)
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
  const clamped = Math.max(15, Math.min(85, Math.round(pct)))
  localWidthPct.value = clamped
}

function onHUp() {
  const shouldPersist = hDragging.value && localWidthReady
  hDragging.value = false
  document.removeEventListener('mousemove', onHDrag)
  document.removeEventListener('mouseup', onHUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (shouldPersist) {
    void settingsSet('sftp-local-width-pct', String(localWidthPct.value)).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : String(e), '文件面板布局保存失败')
    })
  }
}

// ============================================================
// 传输
// ============================================================

/** 本地条目双击/右键 → 上传到远端当前目录。目录走递归上传。opts.onDone 用于跟随动作 */
async function uploadFromLocal(e: RemoteEntry, opts?: { onDone?: (success: boolean) => void }) {
  if (!sftpId.value) return
  const localPath = joinPath(localCwd.value, e.name)
  const cb = opts?.onDone ? { onDone: (d: { success: boolean }) => opts.onDone!(d.success) } : undefined
  if (e.isDir) {
    await startUploadDir(sftpId.value, localPath, remoteCwd.value, e.name, cb)
  } else {
    await startUpload(sftpId.value, localPath, remoteCwd.value, e.name, e.size, cb)
  }
}

/** 远端条目双击/右键 → 下载到本地当前目录。目录走递归下载 */
async function downloadFromRemote(e: RemoteEntry, opts?: { onDone?: (success: boolean) => void }) {
  if (!sftpId.value) return
  const remotePath = joinPath(remoteCwd.value, e.name)
  const cb = opts?.onDone ? { onDone: (d: { success: boolean }) => opts.onDone!(d.success) } : undefined
  if (e.isDir) {
    await startDownloadDir(sftpId.value, remotePath, localCwd.value, e.name, cb)
  } else {
    await startDownload(sftpId.value, remotePath, localCwd.value, e.name, e.size, cb)
  }
}

// ============================================================
// pane-to-pane 拖拽(鼠标事件模拟,绕过 Tauri 原生 OLE 拦截)
// ============================================================

// 当前鼠标按下态:记录源栏 + 条目 + 起点,尚未确定是否进入拖拽
const press = ref<{ side: 'local' | 'remote'; entry: RemoteEntry; x: number; y: number } | null>(null)
// 已进入拖拽态:超过移动阈值后置位,显示拖影
const dragging = ref<{ side: 'local' | 'remote'; entry: RemoteEntry } | null>(null)
// 拖影跟随光标的坐标
const ghost = ref<{ x: number; y: number; name: string } | null>(null)
// 进入拖拽态的最小移动距离(像素),避免误判点击
const DRAG_THRESHOLD = 4

// FilePane 条目 mousedown 时触发:记录按下态,等待 mousemove 判定
function onItemMouseDown(side: 'local' | 'remote', entry: RemoteEntry, e: MouseEvent) {
  // 左键且非右键菜单区域才启动
  if (e.button !== 0) return
  press.value = { side, entry, x: e.clientX, y: e.clientY }
}

function onWindowMouseMove(e: MouseEvent) {
  if (!press.value) return
  // 未进入拖拽态:判定是否越过阈值
  if (!dragging.value) {
    const dx = e.clientX - press.value.x
    const dy = e.clientY - press.value.y
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
    // 进入拖拽态,锁定 user-select 防止文字选中
    dragging.value = { side: press.value.side, entry: press.value.entry }
    document.body.style.userSelect = 'none'
  }
  // 更新拖影 + 命中栏高亮
  ghost.value = { x: e.clientX, y: e.clientY, name: dragging.value.entry.name }
  dragOver.value = hitTestSideCss(e.clientX, e.clientY)
}

function onWindowMouseUp(_e: MouseEvent) {
  // 先结算拖拽
  if (dragging.value) {
    const target = dragOver.value
    const from = dragging.value.side
    const entry = dragging.value.entry
    // 跨栏才传输;同栏忽略
    if (target && target !== from) {
      if (from === 'local' && target === 'remote') void uploadFromLocal(entry)
      else if (from === 'remote' && target === 'local') void downloadFromRemote(entry)
    }
  }
  press.value = null
  dragging.value = null
  ghost.value = null
  dragOver.value = null
  document.body.style.userSelect = ''
}

/**
 * CSS 像素命中测试(pane-to-pane 用;OS 文件拖入用 hitTestSide 处理物理像素)。
 * 左半属本地栏、右半属远端栏,以 localWidthPct 划分。
 */
function hitTestSideCss(x: number, y: number): 'local' | 'remote' | null {
  const el = splitEl.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
  const boundary = r.left + (r.width * localWidthPct.value) / 100
  return x < boundary ? 'local' : 'remote'
}

// ============================================================
// OS 文件拖入(Tauri 原生 onDragDropEvent,提供真实磁盘路径)
// ============================================================

/**
 * 命中测试:Tauri 传来的 position 是物理像素(相对窗口左上角),
 * 需除以 devicePixelRatio 换算成 CSS 像素后再与 splitEl 的 rect 比较。
 * 左半属本地栏、右半属远端栏,以 localWidthPct 划分。
 */
function hitTestSide(pos: { x: number; y: number }): 'local' | 'remote' | null {
  const el = splitEl.value
  if (!el) return null
  const dpr = window.devicePixelRatio || 1
  const x = pos.x / dpr
  const y = pos.y / dpr
  const r = el.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
  const boundary = r.left + (r.width * localWidthPct.value) / 100
  return x < boundary ? 'local' : 'remote'
}

/** 从 OS 拖入的绝对路径中截取文件名(兼容 \ 与 /) */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

/**
 * 处理系统级文件拖入。
 * 落到远端栏 → 上传到当前远端 cwd;落到本地栏 → 复制到当前本地 cwd。
 * 目录暂不支持(需要递归 walk,统一给 toast 提示后跳过)。
 */
async function handleExternalDrop(side: 'local' | 'remote', paths: string[]) {
  if (side === 'remote' && !sftpId.value) {
    toast.error('SFTP 会话未就绪', '拖拽上传失败')
    return
  }
  // 此电脑级不允许"复制到当前目录",直接拒绝
  if (side === 'local' && localCwd.value === '') {
    toast.warning('此电脑级不支持接收拖入文件,请先进入具体盘符', '拖拽')
    return
  }

  let ok = 0
  let skipped = 0
  const errors: string[] = []

  for (const p of paths) {
    let stat
    try {
      if (!sftpId.value) return
      stat = await localStat(sftpId.value, p)
    } catch (e: any) {
      errors.push(`${basename(p)}: ${String(e)}`)
      continue
    }
    try {
      if (side === 'remote') {
        if (stat.isDir) {
          await startUploadDir(sftpId.value!, p, remoteCwd.value, stat.name)
        } else {
          await startUpload(sftpId.value!, p, remoteCwd.value, stat.name, stat.size)
        }
      } else {
        // 本地复制:若源与目标同目录,加"副本"后缀避免覆盖自身
        const dst = joinPath(localCwd.value, stat.name)
        const finalDst =
          dst.toLowerCase() === p.toLowerCase()
            ? joinPath(localCwd.value, deriveCopyName(stat.name))
            : dst
        await localCopy(sftpId.value, p, finalDst)
      }
      ok++
    } catch (e: any) {
      errors.push(`${stat.name}: ${String(e)}`)
    }
  }

  if (side === 'local') await refreshLocal()
  // 远端上传是异步任务,不阻塞刷新;完成事件会自动更新传输面板

  if (ok > 0) {
    toast.success(
      side === 'remote' ? `已开始上传 ${ok} 个条目` : `已复制 ${ok} 个条目到本地`,
      '拖拽',
    )
  }
  if (skipped > 0) {
    toast.warning(`已跳过 ${skipped} 个条目`, '拖拽')
  }
  if (errors.length > 0) {
    toast.error(errors.slice(0, 3).join('\n'), '部分条目失败')
  }
}

// ============================================================
// 预览
// ============================================================

function previewFile(side: 'local' | 'remote', entry: RemoteEntry) {
  if (entry.isDir) return
  const cwd = side === 'remote' ? remoteCwd.value : localCwd.value
  preview.value = {
    name: entry.name,
    path: joinPath(cwd, entry.name),
    side,
    size: entry.size,
  }
}

async function onPreviewSaved(target: FilePreviewTarget) {
  if (target.side === 'remote') await refreshRemote()
  else await refreshLocal()
}

function closePreview() {
  preview.value = null
}

// ============================================================
// Ctrl+C / X / V 文件操作
// ============================================================

function onKeydown(e: KeyboardEvent) {
  if (activeTabId.value !== props.tabId || preview.value) return
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
  try {
    if (from === to) {
      // 同栏
      const dir = to === 'local' ? localCwd.value : remoteCwd.value
      if (mode === 'cut') {
        // 同目录剪切无意义(跨目录同栏当前 UI 无法表达,只能靠切换 cwd 后再粘贴,
        // 但那时 clip.path 已经含原目录,dir !== 原目录,才落到复制/移动分支;
        // 此处 dir === 原目录才是"同目录",忽略)
        const srcDir = srcPath.slice(0, srcPath.lastIndexOf(dir.includes('\\') ? '\\' : '/'))
        if (srcDir === dir) {
          toast.info('源与目标在同一目录,已忽略', '无需剪切')
          return
        }
        // 同栏跨目录剪切优先使用重命名,避免目录复制中途留下半成品
        const dstPath = joinPath(dir, entry.name)
        if (to === 'local') {
          if (!sftpId.value) return
          await localCopy(sftpId.value, srcPath, dstPath)
          if (entry.isDir) await localRmdir(sftpId.value, srcPath)
          else await localRm(sftpId.value, srcPath)
          toast.success(`已移动:${entry.name}`, '剪切完成')
        } else {
          if (!sftpId.value) return
          await sftpRename(sftpId.value, srcPath, dstPath)
          toast.success(`已移动:${entry.name}`, '剪切完成')
        }
      } else {
        // 复制:同目录加"副本"后缀
        const newName = deriveCopyName(entry.name)
        const dstPath = joinPath(dir, newName)
        if (to === 'local') {
          if (!sftpId.value) return
          await localCopy(sftpId.value, srcPath, dstPath)
          toast.success(`已粘贴为 ${newName}`, '粘贴完成')
        } else {
          if (!sftpId.value) return
          if (entry.isDir) {
            await startCopyRemoteDir(sftpId.value, srcPath, dstPath, newName, {
              onDone: async d => {
                if (d.success) await refreshRemote()
              },
            })
            toast.info(`已开始复制到 ${newName}`, '粘贴')
          } else {
            await sftpCopyFile(sftpId.value, srcPath, dstPath)
            toast.success(`已粘贴为 ${newName}`, '粘贴完成')
          }
        }
      }
    } else {
      // 跨栏:走传输管线。剪切时用 onDone 在传输成功后删源,失败/取消不删
      const cutCb = mode === 'cut'
        ? {
            onDone: async (success: boolean) => {
              if (!success) return
              try {
                if (from === 'local') {
                  if (!sftpId.value) return
                  if (entry.isDir) await localRmdir(sftpId.value, srcPath)
                  else await localRm(sftpId.value, srcPath)
                  await refreshLocal()
                } else if (sftpId.value) {
                  if (entry.isDir) await sftpRmdir(sftpId.value, srcPath)
                  else await sftpRm(sftpId.value, srcPath)
                  await refreshRemote()
                }
              } catch (e: unknown) {
                toast.error(String(e), '删除源失败')
              }
            },
          }
        : undefined
      if (from === 'local' && to === 'remote') await uploadFromLocal(entry, cutCb)
      else if (from === 'remote' && to === 'local') await downloadFromRemote(entry, cutCb)
      toast.success(
        `${mode === 'cut' ? '已开始移动' : '已开始传输'}:${entry.name}`,
        mode === 'cut' ? '剪切' : '粘贴',
      )
    }
    if (to === 'local') await refreshLocal()
    else await refreshRemote()
    if (from !== to && mode === 'cut') {
      if (from === 'local') await refreshLocal()
      else await refreshRemote()
    }
    if (mode === 'cut') clip.value = null
  } catch (err: unknown) {
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
        @mousedown="activeSide = 'local'"
      >
        <FilePane
          side="local"
          :entries="localEntries"
          :cwd="localCwd"
          :root="localRoot"
          :loading="localLoading"
          @navigate="localNavigate"
          @refresh="refreshLocal"
          @mkdir="localMkdirAction"
          @home="goLocalHome"
          @select-root="selectLocalRoot"
          @transfer="uploadFromLocal"
          @preview="previewFile('local', $event)"
          @rename="localRename"
          @delete="localDelete"
          @select="selectedLocal = $event"
          @itemmousedown="(entry, ev) => onItemMouseDown('local', entry, ev)"
        />
      </div>

      <!-- 左右分隔条(可拖拽调宽) -->
      <div
        class="group relative w-px shrink-0 cursor-col-resize bg-border hover:bg-primary/60 transition-colors"
        @mousedown="onHDividerDown"
      >
        <div class="absolute left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-panel-3 opacity-0 transition-opacity group-hover:opacity-100 group-hover:bg-primary" />
      </div>

      <!-- 远端栏 -->
      <div
        class="flex min-w-0 flex-1 flex-col overflow-hidden"
        :class="dragOver === 'remote' && 'ring-1 ring-primary ring-inset'"
        @mousedown="activeSide = 'remote'"
      >
        <FilePane
          side="remote"
          :entries="remoteEntries"
          :cwd="remoteCwd"
          :loading="remoteLoading"
          :host="host"
          :user="user"
          @navigate="remoteNavigate"
          @refresh="refreshRemote"
          @mkdir="remoteMkdirAction"
          @home="goRemoteHome"
          @transfer="downloadFromRemote"
          @preview="previewFile('remote', $event)"
          @rename="remoteRename"
          @delete="remoteDelete"
          @select="selectedRemote = $event"
          @itemmousedown="(entry, ev) => onItemMouseDown('remote', entry, ev)"
        />
      </div>
    </div>

    <!-- pane-to-pane 拖影(跟随光标) -->
    <Teleport to="body">
      <div
        v-if="ghost"
        class="text-body pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 shadow-md"
        :style="{ left: ghost.x + 12 + 'px', top: ghost.y + 12 + 'px' }"
      >{{ ghost.name }}</div>
    </Teleport>

    <!-- 预览/编辑对话框 -->
    <FilePreviewDialog
      :target="preview"
      :sftp-id="sftpId"
      @close="closePreview"
      @saved="onPreviewSaved"
    />
  </div>
</template>
