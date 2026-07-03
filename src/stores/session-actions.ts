import { markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import { TerminalSquare, FolderOpen, Boxes } from 'lucide-vue-next'
import type { StoredSession } from '@/api/sessions'
import { connectSession, quickConnect } from '@/stores/sessions'
import { addTab, nextTabId } from '@/stores/tabs'
import { sftpOpen } from '@/api/sftp'
import { sshDisconnect } from '@/api/ssh'
import { dockerAvailable } from '@/api/docker'
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
    let sessionId: string
    try {
      sessionId = await connectSession(s)
    } catch (e) {
      silentHostKeyError(e)
      return
    }
    // 打开 tab 前先检测远端 docker 是否可用,不可用则断开并提示,避免空 tab
    try {
      const ok = await dockerAvailable(sessionId)
      if (!ok) {
        await sshDisconnect(sessionId).catch(() => {})
        toast.warning('远端未安装 docker 或当前用户无权限,请确认已加入 docker 组')
        return
      }
    } catch (e) {
      await sshDisconnect(sessionId).catch(() => {})
      toast.error(typeof e === 'string' ? e : (e as Error)?.message ?? String(e), 'Docker 检测失败')
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
