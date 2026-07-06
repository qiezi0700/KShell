import { computed, markRaw, ref, shallowRef } from 'vue'
import type { Component } from 'vue'
import { Server, KeyRound, Network, Activity, Zap } from '@lucide/vue'
import SessionsPanel from '@/components/sidebar/SessionsPanel.vue'
import KeysPanel from '@/components/sidebar/KeysPanel.vue'
import TunnelPanel from '@/components/tunnels/TunnelPanel.vue'
import MonitorSummary from '@/components/monitor/MonitorSummary.vue'
import SnippetsPanel from '@/components/sidebar/SnippetsPanel.vue'
import { settingsGet, settingsSet } from '@/api/settings'

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

// 侧栏宽度可拖拽调整,持久化到 SQLite settings;范围 180–480px
// ref 先用默认值,initSidebarWidth() 异步覆盖
export const sidebarWidth = ref(220)
export const sidebarResizing = ref(false)

let sidebarWidthReady = false

/** 从 SQLite 加载侧栏宽度;重复调用安全 */
export async function initSidebarWidth(): Promise<void> {
  if (sidebarWidthReady) return
  try {
    const raw = await settingsGet('sidebar-width')
    if (raw != null) {
      // useStorage 存数值时序列化为字符串,直接解析
      const n = Number(raw)
      if (Number.isFinite(n)) sidebarWidth.value = Math.min(Math.max(Math.round(n), 180), 480)
    }
  } catch {
    // 读取失败保持默认
  }
  sidebarWidthReady = true
}

export function setSidebarWidth(px: number) {
  const clamped = Math.min(Math.max(Math.round(px), 180), 480)
  sidebarWidth.value = clamped
  if (sidebarWidthReady) void settingsSet('sidebar-width', String(clamped))
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
registerSidebarPanel({ key: 'snippets', label: '指令', icon: Zap, component: SnippetsPanel, order: 2 })
registerSidebarPanel({ key: 'tunnels', label: '隧道', icon: Network, component: TunnelPanel, order: 3 })
registerSidebarPanel({ key: 'monitor', label: '监控', icon: Activity, component: MonitorSummary, footer: true })
