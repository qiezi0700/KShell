import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import {
  onTransferProgress,
  onTransferDone,
  sftpUpload,
  sftpDownload,
  sftpUploadDir,
  sftpDownloadDir,
  sftpCopyDir,
  sftpCancelTransfer,
  type TransferProgress,
  type TransferDone,
} from '@/api/sftp'
import type { UnlistenFn } from '@tauri-apps/api/event'

export type TransferDirection = 'upload' | 'download' | 'uploadDir' | 'downloadDir' | 'copyRemote'
export type TransferStatus = 'pending' | 'transferring' | 'done' | 'error' | 'cancelled'

/** 可选的传输启动参数。onDone 用于"完成后自动删源"这类跟随动作,回调抛错不会影响其它监听 */
export interface StartOptions {
  onDone?: (d: TransferDone) => void
}

export interface TransferItem {
  id: string
  direction: TransferDirection
  sftpId: string
  localPath: string
  remotePath: string
  name: string
  total: number
  transferred: number
  speed: number
  status: TransferStatus
  error: string | null
}

/** 每个任务的完成回调表,done 事件到达后触发一次并清理 */
const doneCallbacks = new Map<string, (d: TransferDone) => void>()

const items = ref<TransferItem[]>([])
const unlisteners = new Map<string, UnlistenFn[]>()

export const transfersRef = items
export const activeCount = computed(
  () => items.value.filter(t => t.status === 'transferring' || t.status === 'pending').length,
)

function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/')) return dir + name
  return `${dir}/${name}`
}

/** 添加一个传输任务并启动。返回 transfer id 供调用方追踪 */
export async function startUpload(
  sftpId: string,
  localPath: string,
  remoteDir: string,
  fileName: string,
  size: number,
  opts?: StartOptions,
): Promise<string> {
  const id = uuidv4()
  const remotePath = joinPath(remoteDir, fileName)
  const item: TransferItem = {
    id,
    direction: 'upload',
    sftpId,
    localPath,
    remotePath,
    name: fileName,
    total: size,
    transferred: 0,
    speed: 0,
    status: 'pending',
    error: null,
  }
  items.value = [item, ...items.value]
  if (opts?.onDone) doneCallbacks.set(id, opts.onDone)
  await runTransfer(item)
  return id
}

export async function startDownload(
  sftpId: string,
  remotePath: string,
  localDir: string,
  fileName: string,
  size: number,
  opts?: StartOptions,
): Promise<string> {
  const id = uuidv4()
  const localPath = joinPath(localDir, fileName).replace(/\//g, '\\')
  const item: TransferItem = {
    id,
    direction: 'download',
    sftpId,
    localPath,
    remotePath,
    name: fileName,
    total: size,
    transferred: 0,
    speed: 0,
    status: 'pending',
    error: null,
  }
  items.value = [item, ...items.value]
  if (opts?.onDone) doneCallbacks.set(id, opts.onDone)
  await runTransfer(item)
  return id
}

/** 递归上传目录。total 初始未知,后端首个 progress 事件会带上聚合总字节 */
export async function startUploadDir(
  sftpId: string,
  localDir: string,
  remoteParent: string,
  dirName: string,
  opts?: StartOptions,
): Promise<string> {
  const id = uuidv4()
  const remotePath = joinPath(remoteParent, dirName)
  const item: TransferItem = {
    id,
    direction: 'uploadDir',
    sftpId,
    localPath: localDir,
    remotePath,
    name: dirName + '/',
    total: 0,
    transferred: 0,
    speed: 0,
    status: 'pending',
    error: null,
  }
  items.value = [item, ...items.value]
  if (opts?.onDone) doneCallbacks.set(id, opts.onDone)
  await runTransfer(item)
  return id
}

/** 递归下载目录 */
export async function startDownloadDir(
  sftpId: string,
  remoteDir: string,
  localParent: string,
  dirName: string,
  opts?: StartOptions,
): Promise<string> {
  const id = uuidv4()
  const localPath = joinPath(localParent, dirName).replace(/\//g, '\\')
  const item: TransferItem = {
    id,
    direction: 'downloadDir',
    sftpId,
    localPath,
    remotePath: remoteDir,
    name: dirName + '/',
    total: 0,
    transferred: 0,
    speed: 0,
    status: 'pending',
    error: null,
  }
  items.value = [item, ...items.value]
  if (opts?.onDone) doneCallbacks.set(id, opts.onDone)
  await runTransfer(item)
  return id
}

/** 远端目录递归复制(同一 SFTP 会话内 src→dst)。走后端后台任务,进度/取消同上传下载 */
export async function startCopyRemoteDir(
  sftpId: string,
  srcPath: string,
  dstPath: string,
  displayName: string,
  opts?: StartOptions,
): Promise<string> {
  const id = uuidv4()
  const item: TransferItem = {
    id,
    direction: 'copyRemote',
    sftpId,
    localPath: srcPath,
    remotePath: dstPath,
    name: displayName + '/',
    total: 0,
    transferred: 0,
    speed: 0,
    status: 'pending',
    error: null,
  }
  items.value = [item, ...items.value]
  if (opts?.onDone) doneCallbacks.set(id, opts.onDone)
  await runTransfer(item)
  return id
}

async function runTransfer(item: TransferItem) {
  const update = (patch: Partial<TransferItem>) => {
    const idx = items.value.findIndex(t => t.id === item.id)
    if (idx >= 0) items.value[idx] = { ...items.value[idx], ...patch }
  }

  update({ status: 'transferring' })

  const onProgress = await onTransferProgress(item.id, (p: TransferProgress) => {
    update({ transferred: p.transferred, total: p.total, speed: p.speed })
  })
  const onDone = await onTransferDone(item.id, d => {
    update({
      status: d.success ? 'done' : d.cancelled ? 'cancelled' : 'error',
      error: d.error,
      speed: 0,
    })
    const cb = doneCallbacks.get(item.id)
    if (cb) {
      doneCallbacks.delete(item.id)
      try { cb(d) } catch { /* 回调抛错不能影响传输队列 */ }
    }
    cleanup(item.id)
  })
  unlisteners.set(item.id, [onProgress, onDone])

  try {
    switch (item.direction) {
      case 'upload':
        await sftpUpload({ sftpId: item.sftpId, transferId: item.id }, item.localPath, item.remotePath)
        break
      case 'download':
        await sftpDownload({ sftpId: item.sftpId, transferId: item.id }, item.remotePath, item.localPath)
        break
      case 'uploadDir':
        await sftpUploadDir(item.sftpId, item.localPath, item.remotePath, item.id)
        break
      case 'downloadDir':
        await sftpDownloadDir(item.sftpId, item.remotePath, item.localPath, item.id)
        break
      case 'copyRemote':
        await sftpCopyDir(item.sftpId, item.localPath, item.remotePath, item.id)
        break
    }
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message ?? String(e)
    update({ status: 'error', error: msg })
    doneCallbacks.delete(item.id)
    cleanup(item.id)
  }
}

function cleanup(id: string) {
  unlisteners.get(id)?.forEach(fn => fn())
  unlisteners.delete(id)
}

/** 清除已完成/失败/取消的任务(保留进行中的) */
export function clearFinished() {
  const finished = items.value.filter(t => t.status === 'done' || t.status === 'error' || t.status === 'cancelled')
  finished.forEach(t => cleanup(t.id))
  items.value = items.value.filter(t => t.status === 'transferring' || t.status === 'pending')
}

/**
 * 请求取消一个进行中的传输。
 * 后端置位 cancel token,当前分块循环结束后返回;done 事件会带 cancelled=true。
 * 已结束的任务调用无副作用。
 */
export async function cancelTransfer(id: string): Promise<void> {
  const item = items.value.find(t => t.id === id)
  if (!item) return
  if (item.status !== 'transferring' && item.status !== 'pending') return
  try {
    await sftpCancelTransfer(id)
  } catch {
    // 忽略后端不存在等错误
  }
}

/** 从队列中移除单条已结束的任务(进行中需先取消) */
export function removeTransfer(id: string) {
  const item = items.value.find(t => t.id === id)
  if (!item) return
  if (item.status === 'transferring' || item.status === 'pending') return
  cleanup(id)
  doneCallbacks.delete(id)
  items.value = items.value.filter(t => t.id !== id)
}
