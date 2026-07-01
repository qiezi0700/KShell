import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ============================================================
// 类型定义
// ============================================================

export interface RemoteEntry {
  name: string
  isDir: boolean
  isSymlink: boolean
  size: number
  modified: string
  permissions: number
}

export type LocalEntry = RemoteEntry

export interface TransferProgress {
  transferId: string
  transferred: number
  total: number
  speed: number
}

export interface TransferDone {
  transferId: string
  success: boolean
  error: string | null
}

// ============================================================
// SFTP 会话管理
// ============================================================

/** 在已连接的 SSH 会话上打开 SFTP channel */
export function sftpOpen(sessionId: string): Promise<string> {
  return invoke<string>('sftp_open', { sessionId })
}

/** 关闭 SFTP 会话 */
export function sftpClose(sftpId: string): Promise<void> {
  return invoke('sftp_close', { sftpId })
}

// ============================================================
// 远端文件操作
// ============================================================

export function sftpList(sftpId: string, path: string): Promise<RemoteEntry[]> {
  return invoke<RemoteEntry[]>('sftp_list', { sftpId, path })
}

export function sftpMkdir(sftpId: string, path: string): Promise<void> {
  return invoke('sftp_mkdir', { sftpId, path })
}

export function sftpRmdir(sftpId: string, path: string): Promise<void> {
  return invoke('sftp_rmdir', { sftpId, path })
}

export function sftpRm(sftpId: string, path: string): Promise<void> {
  return invoke('sftp_rm', { sftpId, path })
}

export function sftpRename(sftpId: string, oldPath: string, newPath: string): Promise<void> {
  return invoke('sftp_rename', { sftpId, oldPath, newPath })
}

export function sftpChmod(sftpId: string, path: string, mode: number): Promise<void> {
  return invoke('sftp_chmod', { sftpId, path, mode })
}

export function sftpStat(sftpId: string, path: string): Promise<RemoteEntry> {
  return invoke<RemoteEntry>('sftp_stat', { sftpId, path })
}

/** 读取文件内容(预览用) */
export function sftpReadFile(sftpId: string, path: string): Promise<number[]> {
  return invoke<number[]>('sftp_read_file', { sftpId, path })
}

/** 写入远端文件(保存编辑) */
export function sftpWriteFile(sftpId: string, path: string, content: number[]): Promise<void> {
  return invoke<void>('sftp_write_file', { sftpId, path, content })
}

/** 复制远端文件(单文件) */
export function sftpCopyFile(sftpId: string, oldPath: string, newPath: string): Promise<void> {
  return invoke<void>('sftp_copy_file', { sftpId, oldPath, newPath })
}

/** 获取远端家目录 */
export function sftpHome(sftpId: string): Promise<string> {
  return invoke<string>('sftp_home', { sftpId })
}

// ============================================================
// 本地文件操作
// ============================================================

export function localList(path: string): Promise<LocalEntry[]> {
  return invoke<LocalEntry[]>('local_list', { path })
}

export function localMkdir(path: string): Promise<void> {
  return invoke('local_mkdir', { path })
}

export function localRmdir(path: string): Promise<void> {
  return invoke('local_rmdir', { path })
}

export function localRm(path: string): Promise<void> {
  return invoke('local_rm', { path })
}

export function localRename(oldPath: string, newPath: string): Promise<void> {
  return invoke('local_rename', { oldPath, newPath })
}

export function localHome(): Promise<string> {
  return invoke<string>('local_home')
}

/** 读取本地路径元数据(用于拖拽前判断是否为目录、取大小) */
export function localStat(path: string): Promise<LocalEntry> {
  return invoke<LocalEntry>('local_stat', { path })
}

export function localReadFile(path: string): Promise<number[]> {
  return invoke<number[]>('local_read_file', { path })
}

/** 写入本地文件(保存编辑) */
export function localWriteFile(path: string, content: number[]): Promise<void> {
  return invoke<void>('local_write_file', { path, content })
}

/** 复制本地文件(单文件) */
export function localCopy(oldPath: string, newPath: string): Promise<void> {
  return invoke<void>('local_copy', { oldPath, newPath })
}

// ============================================================
// 传输(上传/下载,带进度 + 断点续传)
// ============================================================

export interface TransferOptions {
  sftpId: string
  transferId: string
  offset?: number
}

/** 上传:本地 → 远端 */
export function sftpUpload(
  opts: TransferOptions,
  localPath: string,
  remotePath: string,
): Promise<void> {
  return invoke('sftp_upload', {
    sftpId: opts.sftpId,
    localPath,
    remotePath,
    transferId: opts.transferId,
    offset: opts.offset ?? 0,
  })
}

/** 下载:远端 → 本地 */
export function sftpDownload(
  opts: TransferOptions,
  remotePath: string,
  localPath: string,
): Promise<void> {
  return invoke('sftp_download', {
    sftpId: opts.sftpId,
    remotePath,
    localPath,
    transferId: opts.transferId,
    offset: opts.offset ?? 0,
  })
}

export function sftpCancelTransfer(transferId: string): Promise<void> {
  return invoke('sftp_cancel_transfer', { transferId })
}

// ============================================================
// 事件监听
// ============================================================

/** 监听传输进度 */
export function onTransferProgress(
  transferId: string,
  handler: (p: TransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TransferProgress>(`sftp://transfer/${transferId}/progress`, e => {
    handler(e.payload)
  })
}

/** 监听传输完成 */
export function onTransferDone(
  transferId: string,
  handler: (d: TransferDone) => void,
): Promise<UnlistenFn> {
  return listen<TransferDone>(`sftp://transfer/${transferId}/done`, e => {
    handler(e.payload)
  })
}
