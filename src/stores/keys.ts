import { ref } from 'vue'
import {
  sshKeysList,
  sshKeyDelete,
  sshKeyRename,
  type SshKey,
} from '@/api/keys'

export const keys = ref<SshKey[]>([])
export const keyManagerDialogOpen = ref(false)
/** 打开弹窗时自动展开的子面板:generate / import / view / none */
export const keyManagerInitialMode = ref<'none' | 'generate' | 'import'>('none')
/** 打开弹窗时自动查看公钥的密钥 ID */
export const keyManagerInitialViewId = ref<string | null>(null)

/** 刷新密钥库列表 */
export async function refreshKeys() {
  try {
    keys.value = await sshKeysList()
  } catch {
    // 静默忽略,调用方自行处理错误
  }
}

/** 删除密钥并刷新列表 */
export async function deleteKey(id: string) {
  await sshKeyDelete(id)
  await refreshKeys()
}

/** 重命名密钥并刷新列表 */
export async function renameKey(id: string, name: string) {
  await sshKeyRename(id, name)
  await refreshKeys()
}

/** 打开密钥管理弹窗 */
export function openKeyManager() {
  refreshKeys()
  keyManagerDialogOpen.value = true
}

/** 打开弹窗并直接展开生成表单 */
export function openKeyManagerGenerate() {
  keyManagerInitialMode.value = 'generate'
  openKeyManager()
}

/** 打开弹窗并直接展开导入表单 */
export function openKeyManagerImport() {
  keyManagerInitialMode.value = 'import'
  openKeyManager()
}

/** 打开弹窗并自动查看指定密钥的公钥 */
export function openKeyManagerViewKey(id: string) {
  keyManagerInitialViewId.value = id
  openKeyManager()
}

const ALGORITHM_LABELS: Record<string, string> = {
  'ed25519': 'ED25519',
  'rsa-2048': 'RSA 2048',
  'rsa-3072': 'RSA 3072',
  'rsa-4096': 'RSA 4096',
  'rsa': 'RSA',
  'ecdsa-p256': 'ECDSA P256',
  'ecdsa-p384': 'ECDSA P384',
  'ecdsa-p521': 'ECDSA P521',
}

/** 算法标识转可读标签 */
export function algoLabel(algo: string): string {
  return ALGORITHM_LABELS[algo] ?? algo.toUpperCase()
}

/** 指纹截短显示 */
export function shortFp(fp: string): string {
  if (fp.length > 24) return fp.slice(0, 20) + '…'
  return fp
}
