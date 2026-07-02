import { markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import { Activity } from 'lucide-vue-next'
import type { Tab } from '@/stores/tabs'
import { monitorDialogOpen } from '@/stores/monitor'

export interface StatusAction {
  id: string
  icon: Component
  label: (tab: Tab) => string
  /** 是否对当前活跃 tab 显示;tab 为 null 表示无活跃标签 */
  visible: (tab: Tab | null) => boolean
  run: (tab: Tab) => void
}

const items = shallowRef<StatusAction[]>([])

export function registerStatusAction(a: StatusAction) {
  items.value = [...items.value, markRaw(a)]
}

export const statusActions = items

// 集中注册状态栏动作;新增功能(如 Docker 概览)只需在此 register
registerStatusAction({
  id: 'monitor',
  icon: Activity,
  label: () => '服务器监控',
  visible: (tab) => tab?.type === 'terminal',
  run: () => {
    monitorDialogOpen.value = true
  },
})
