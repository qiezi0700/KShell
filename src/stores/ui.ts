import { ref } from 'vue'
import { tabs } from './tabs'

// 布局可见性
export const sidebarVisible = ref(true)
export const statusBarVisible = ref(true)

// 终端操作:通过递增计数触发,Terminal.vue watch 执行
export const clearTerminalTrigger = ref(0)
export const clearScrollbackTrigger = ref(0)

export function clearTerminal() {
  if (!tabs.value.some((t) => t.type === 'terminal')) return
  clearTerminalTrigger.value++
}

export function clearScrollback() {
  if (!tabs.value.some((t) => t.type === 'terminal')) return
  clearScrollbackTrigger.value++
}
