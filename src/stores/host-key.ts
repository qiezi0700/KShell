import type { UnlistenFn } from '@tauri-apps/api/event'

import {
  onHostKeyConfirm,
  onHostKeyMismatch,
  sshConfirmHost,
  sshRemoveKnownHost,
  type HostKeyConfirmPayload,
  type HostKeyMismatchPayload,
} from '@/api/ssh'
import { openConfirm } from '@/stores/prompt'
import { syncKnownHostsToSystem } from '@/stores/preferences'

let unlistenConfirm: UnlistenFn | null = null
let unlistenMismatch: UnlistenFn | null = null

/** 在 App.vue onMounted 时调用,注册主机公钥事件监听 */
export async function initHostKeyGuard(): Promise<void> {
  if (unlistenConfirm && unlistenMismatch) return
  unlistenConfirm = await onHostKeyConfirm(handleConfirm)
  unlistenMismatch = await onHostKeyMismatch(handleMismatch)
}

/** 在 App.vue onBeforeUnmount 时调用 */
export function destroyHostKeyGuard(): void {
  unlistenConfirm?.()
  unlistenMismatch?.()
  unlistenConfirm = null
  unlistenMismatch = null
}

/** 首次连接:弹确认框让用户决定是否信任该主机公钥 */
async function handleConfirm(p: HostKeyConfirmPayload): Promise<void> {
  const accept = await openConfirm({
    title: '确认主机指纹',
    message: `主机 ${p.host}:${p.port}\n密钥类型: ${p.keyType}\n指纹: ${p.fingerprint}\n\n首次连接此主机,是否信任并继续?`,
    confirmText: '信任并连接',
    cancelText: '拒绝',
  })
  await sshConfirmHost(p.confirmId, accept, syncKnownHostsToSystem.value).catch(() => {})
}

/** 公钥不匹配:连接已被后端拒绝,提示用户;用户可选择移除旧记录后重连 */
async function handleMismatch(p: HostKeyMismatchPayload): Promise<void> {
  const remove = await openConfirm({
    title: '服务器公钥不匹配',
    message: `主机 ${p.host}:${p.port} 的公钥与已信任记录不一致,连接已被拒绝。\n\n预期指纹: ${p.expectedFingerprint}\n实际指纹: ${p.actualFingerprint}\n\n可能存在中间人攻击,或服务器确实更换了密钥。如确认安全,可移除旧记录后重新连接。`,
    confirmText: '移除旧记录',
    cancelText: '关闭',
    destructive: true,
  })
  if (remove) {
    await sshRemoveKnownHost(p.host, p.port).catch(() => {})
  }
}
