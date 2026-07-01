import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import {
  onTransferProgress,
  onTransferDone,
  sftpUpload,
  sftpDownload,
  sftpCancelTransfer,
  type TransferProgress,
} from '@/api/sftp'
import type { UnlistenFn } from '@tauri-apps/api/event'

export type TransferDirection = 'upload' | 'download'
export type TransferStatus = 'pending' | 'transferring' | 'done' | 'error' | 'cancelled'

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

/** 添加一个传输任务并启动 */
export async function startUpload(
  sftpId: string,
  localPath: string,
  remoteDir: string,
  fileName: string,
  size: number,
): Promise<void> {
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
  await runTransfer(item)
}

export async function startDownload(
  sftpId: string,
  remotePath: string,
  localDir: string,
  fileName: string,
  size: number,
): Promise<void> {
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
  await runTransfer(item)
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
    cleanup(item.id)
  })
  unlisteners.set(item.id, [onProgress, onDone])

  try {
    if (item.direction === 'upload') {
      await sftpUpload({ sftpId: item.sftpId, transferId: item.id }, item.localPath, item.remotePath)
    } else {
      await sftpDownload({ sftpId: item.sftpId, transferId: item.id }, item.remotePath, item.localPath)
    }
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message ?? String(e)
    update({ status: 'error', error: msg })
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
