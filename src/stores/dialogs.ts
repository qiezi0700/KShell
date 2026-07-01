import { ref } from 'vue'
import type { StoredSession } from '@/api/sessions'

export const showNewConnection = ref(false)

/**
 * 打开新建连接弹窗时的预填数据。null 表示全新连接。
 * 双击已保存会话时,注入这里以复用同一个对话框输入凭据即可连。
 */
export const newConnectionPrefill = ref<StoredSession | null>(null)

export function openNewConnection(prefill?: StoredSession | null) {
  newConnectionPrefill.value = prefill ?? null
  showNewConnection.value = true
}
