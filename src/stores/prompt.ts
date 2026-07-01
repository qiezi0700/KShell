import { ref, shallowRef } from 'vue'

// 命令式 confirm/prompt。挂到 App.vue 的 ConfirmDialog/PromptDialog 观察这里的 state
// 并把用户交互结果 resolve 回来。避免使用浏览器原生 window.confirm/prompt。

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作:确认按钮红色。 */
  destructive?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void
}
interface PromptState extends PromptOptions {
  resolve: (v: string | null) => void
}

export const confirmState = shallowRef<ConfirmState | null>(null)
export const promptState = shallowRef<PromptState | null>(null)
export const confirmOpen = ref(false)
export const promptOpen = ref(false)

/** 弹一个确认框,返回用户是否点确认。取消或关闭均返回 false。 */
export function openConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value = { ...opts, resolve }
    confirmOpen.value = true
  })
}

/** 弹一个文本输入框。取消返回 null,确认返回字符串(可能为空)。 */
export function openPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    promptState.value = { ...opts, resolve }
    promptOpen.value = true
  })
}

export function resolveConfirm(value: boolean) {
  const s = confirmState.value
  confirmOpen.value = false
  confirmState.value = null
  s?.resolve(value)
}

export function resolvePrompt(value: string | null) {
  const s = promptState.value
  promptOpen.value = false
  promptState.value = null
  s?.resolve(value)
}
