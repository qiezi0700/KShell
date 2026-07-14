import { markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import { TerminalSquare, FolderOpen, Boxes } from '@lucide/vue'
import type { StoredSession } from '@/api/sessions'
import { connectSession, quickConnect } from '@/stores/sessions'
import { addTab, nextTabId } from '@/stores/tabs'
import { sftpOpen } from '@/api/sftp'
import { toast } from '@/stores/toast'

export interface SessionAction {
  id: string
  label: string
  icon: Component
  /** 是否对该会话可用;省略则恒可用 */
  available?: (s: StoredSession) => boolean
  run: (s: StoredSession) => void | Promise<void>
}

const items = shallowRef<SessionAction[]>([])

export function registerSessionAction(a: SessionAction) {
  items.value = [...items.value, markRaw(a)]
}

export const sessionActions = items

// 主机公钥校验失败已由 host-key 弹框处理,此处静默
function silentHostKeyError(e: unknown) {
  const msg = typeof e === 'string' ? e : (e as any)?.message ?? String(e)
  if (msg.includes('主机公钥校验未通过')) return
  toast.error(msg, '连接失败')
}

// 集中注册会话级动作;新增功能(如 Docker)只需在此 register 即出现在右键菜单
registerSessionAction({
  id: 'connect-terminal',
  label: '连接终端',
  icon: TerminalSquare,
  run: async (s) => {
    try {
      await quickConnect(s)
    } catch (e) {
      silentHostKeyError(e)
    }
  },
})

registerSessionAction({
  id: 'open-sftp',
  label: '打开 SFTP',
  icon: FolderOpen,
  run: async (s) => {
    try {
      const sessionId = await connectSession(s)
      if (!sessionId) return
      const sftpId = await sftpOpen(sessionId)
      addTab({
        id: nextTabId('sftp'),
        type: 'sftp',
        title: `SFTP ${s.name || s.host}`,
        sessionId,
        sftpId,
        host: s.host,
        user: s.username,
        storedSessionId: s.id,
      })
    } catch (e) {
      silentHostKeyError(e)
    }
  },
})

registerSessionAction({
  id: 'open-docker',
  label: '打开 Docker',
  icon: Boxes,
  run: async (s) => {
    let sessionId: string | null
    try {
      sessionId = await connectSession(s)
      if (!sessionId) return
    } catch (e) {
      silentHostKeyError(e)
      return
    }
    addTab({
      id: nextTabId('docker'),
      type: 'docker',
      title: `Docker ${s.name || s.host}`,
      sessionId,
      host: s.host,
      user: s.username,
      storedSessionId: s.id,
    })
  },
})
