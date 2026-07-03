import { computed, markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import { TerminalSquare, FolderOpen, Boxes } from 'lucide-vue-next'
import type { TabType } from '@/stores/tabs'
import TerminalTabView from '@/components/terminal/TerminalTabView.vue'
import SftpTabView from '@/components/sftp/SftpTabView.vue'
import DockerTabView from '@/components/docker/DockerTabView.vue'

export interface TabViewDef {
  type: TabType
  icon: Component
  component: Component
}

const items = shallowRef<TabViewDef[]>([])

export function registerTabView(def: TabViewDef) {
  items.value = [...items.value, markRaw(def)]
}

const byType = computed(() => {
  const m = new Map<TabType, TabViewDef>()
  for (const it of items.value) m.set(it.type, it)
  return m
})

export function getTabView(type: TabType): TabViewDef | undefined {
  return byType.value.get(type)
}

// 启动时集中注册内置 tab 视图;新增 tab 类型只需在此 register
registerTabView({ type: 'terminal', icon: TerminalSquare, component: TerminalTabView })
registerTabView({ type: 'sftp', icon: FolderOpen, component: SftpTabView })
registerTabView({ type: 'docker', icon: Boxes, component: DockerTabView })
