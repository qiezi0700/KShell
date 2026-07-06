import { computed, markRaw, ref, shallowRef } from 'vue'
import type { Component } from 'vue'
import { useStorage } from '@vueuse/core'
import { Server, KeyRound, Network, Activity } from '@lucide/vue'
import SessionsPanel from '@/components/sidebar/SessionsPanel.vue'
import KeysPanel from '@/components/sidebar/KeysPanel.vue'
import TunnelPanel from '@/components/tunnels/TunnelPanel.vue'
import MonitorSummary from '@/components/monitor/MonitorSummary.vue'

export interface SidebarPanelDef {
  key: string
  label: string
  icon: Component
  component: Component
  order?: number
  /** true 时渲染到底部 footer 区而非主面板区 */
  footer?: boolean
}

const items = shallowRef<SidebarPanelDef[]>([])

export function registerSidebarPanel(def: SidebarPanelDef) {
  items.value = [...items.value, markRaw(def)]
}

export const activePanel = ref<string>('sessions')

// 侧栏宽度可拖拽调整,持久化到 localStorage;范围 180–480px
export const sidebarWidth = useStorage('sidebar-width', 220)
export const sidebarResizing = ref(false)

export function setSidebarWidth(px: number) {
  sidebarWidth.value = Math.min(Math.max(Math.round(px), 180), 480)
}

const sorted = computed(() =>
  [...items.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
)
export const mainPanels = computed(() => sorted.value.filter((p) => !p.footer))
export const footerPanels = computed(() => sorted.value.filter((p) => p.footer))

export const currentPanel = computed(() =>
  mainPanels.value.find((p) => p.key === activePanel.value),
)

// 集中注册内置侧栏面板;新增面板只需在此 register
registerSidebarPanel({ key: 'sessions', label: '会话', icon: Server, component: SessionsPanel, order: 0 })
registerSidebarPanel({ key: 'keys', label: '密钥', icon: KeyRound, component: KeysPanel, order: 1 })
registerSidebarPanel({ key: 'tunnels', label: '隧道', icon: Network, component: TunnelPanel, order: 2 })
registerSidebarPanel({ key: 'monitor', label: '监控', icon: Activity, component: MonitorSummary, footer: true })
