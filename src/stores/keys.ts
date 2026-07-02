import { ref } from 'vue'
import {
  sshKeysList,
  sshKeyDelete,
  sshKeyRename,
  type SshKey,
} from '@/api/keys'

export const keys = ref<SshKey[]>([])
export const keyManagerDialogOpen = ref(false)

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
