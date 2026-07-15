import { nextTick, ref, shallowRef } from 'vue'

// 命令式 confirm/prompt/passwordPrompt。挂到 App.vue 的对应 Dialog 观察这里的 state
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

export interface PasswordPromptOptions {
  title: string
  message?: string
  /** 占位提示 */
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void
}
interface PromptState extends PromptOptions {
  resolve: (v: string | null) => void
}
interface PasswordPromptState extends PasswordPromptOptions {
  resolve: (v: string | null) => void
}
export interface MultiPromptOptions {
  title: string
  message?: string
  /** 每个输入框的配置 */
  prompts: { label: string; echo: boolean }[]
  confirmText?: string
  cancelText?: string
}

interface MultiPromptState extends MultiPromptOptions {
  resolve: (v: string[] | null) => void
}

export const confirmState = shallowRef<ConfirmState | null>(null)
export const promptState = shallowRef<PromptState | null>(null)
export const passwordPromptState = shallowRef<PasswordPromptState | null>(null)
export const multiPromptState = shallowRef<MultiPromptState | null>(null)
export const confirmOpen = ref(false)
export const promptOpen = ref(false)
export const passwordPromptOpen = ref(false)
export const multiPromptOpen = ref(false)

const confirmQueue: ConfirmState[] = []
const promptQueue: PromptState[] = []
const passwordPromptQueue: PasswordPromptState[] = []
const multiPromptQueue: MultiPromptState[] = []

function presentNextConfirm() {
  if (confirmState.value || confirmQueue.length === 0) return
  confirmState.value = confirmQueue.shift() ?? null
  confirmOpen.value = confirmState.value != null
}

function presentNextPrompt() {
  if (promptState.value || promptQueue.length === 0) return
  promptState.value = promptQueue.shift() ?? null
  promptOpen.value = promptState.value != null
}

function presentNextPasswordPrompt() {
  if (passwordPromptState.value || passwordPromptQueue.length === 0) return
  passwordPromptState.value = passwordPromptQueue.shift() ?? null
  passwordPromptOpen.value = passwordPromptState.value != null
}

function presentNextMultiPrompt() {
  if (multiPromptState.value || multiPromptQueue.length === 0) return
  multiPromptState.value = multiPromptQueue.shift() ?? null
  multiPromptOpen.value = multiPromptState.value != null
}

function scheduleNext(present: () => void) {
  void nextTick(present)
}

/** 弹一个确认框,返回用户是否点确认。取消或关闭均返回 false。 */
export function openConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmQueue.push({ ...opts, resolve })
    presentNextConfirm()
  })
}

/** 弹一个文本输入框。取消返回 null,确认返回字符串(可能为空)。 */
export function openPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    promptQueue.push({ ...opts, resolve })
    presentNextPrompt()
  })
}

/** 弹一个密码输入框(掩码显示)。取消返回 null,确认返回字符串。 */
export function openPasswordPrompt(opts: PasswordPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    passwordPromptQueue.push({ ...opts, resolve })
    presentNextPasswordPrompt()
  })
}

/** 弹一个多输入框对话框(用于 keyboard-interactive)。取消返回 null,确认返回字符串数组。 */
export function openMultiPrompt(opts: MultiPromptOptions): Promise<string[] | null> {
  return new Promise((resolve) => {
    multiPromptQueue.push({ ...opts, resolve })
    presentNextMultiPrompt()
  })
}

export function resolveMultiPrompt(value: string[] | null) {
  const s = multiPromptState.value
  multiPromptOpen.value = false
  multiPromptState.value = null
  s?.resolve(value)
  scheduleNext(presentNextMultiPrompt)
}

export function resolveConfirm(value: boolean) {
  const s = confirmState.value
  confirmOpen.value = false
  confirmState.value = null
  s?.resolve(value)
  scheduleNext(presentNextConfirm)
}

export function resolvePrompt(value: string | null) {
  const s = promptState.value
  promptOpen.value = false
  promptState.value = null
  s?.resolve(value)
  scheduleNext(presentNextPrompt)
}

export function resolvePasswordPrompt(value: string | null) {
  const s = passwordPromptState.value
  passwordPromptOpen.value = false
  passwordPromptState.value = null
  s?.resolve(value)
  scheduleNext(presentNextPasswordPrompt)
}
