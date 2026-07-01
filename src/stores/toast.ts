import { ref } from 'vue'

export type ToastType = 'error' | 'success' | 'info' | 'warning'

export interface ToastItem {
  id: number
  type: ToastType
  title: string
  message: string
}

const items = ref<ToastItem[]>([])
let seq = 0

function push(type: ToastType, message: string, title?: string, duration = 4000) {
  const id = ++seq
  items.value = [...items.value, { id, type, title: title ?? defaultTitle(type), message }]
  // 错误提示停留更久
  const ttl = type === 'error' ? Math.max(duration, 6000) : duration
  setTimeout(() => dismiss(id), ttl)
}

function defaultTitle(type: ToastType): string {
  switch (type) {
    case 'error': return '错误'
    case 'success': return '成功'
    case 'warning': return '警告'
    case 'info': return '提示'
  }
}

function dismiss(id: number) {
  items.value = items.value.filter(t => t.id !== id)
}

export const toastItems = items

export const toast = {
  error: (message: string, title?: string) => push('error', message, title),
  success: (message: string, title?: string) => push('success', message, title),
  info: (message: string, title?: string) => push('info', message, title),
  warning: (message: string, title?: string) => push('warning', message, title),
  dismiss,
}
