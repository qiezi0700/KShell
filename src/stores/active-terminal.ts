import { ref } from 'vue'

/**
 * 活跃终端命令发送注册表。
 *
 * 侧栏「代码片段」面板需要把指令发送到当前活跃的终端,
 * 但终端组件实例不在侧栏的作用域内,无法直接引用。
 * 这里用一个轻量 store 做桥接:TerminalSplit 在活跃时
 * 注册自己的 sendCommand,切走时注销。
 *
 * tab 类型为 terminal 才有 sendCommand(含 exec 终端);
 * 其他类型(sftp/docker)活跃时注册为 null,侧栏发送按钮自动禁用。
 */

type Sender = (cmd: string) => void

const sender = ref<Sender | null>(null)
let ownerTabId: string | null = null

export function setActiveTerminalSender(tabId: string, fn: Sender) {
  ownerTabId = tabId
  sender.value = fn
  canSendToTerminal.value = true
}

export function clearActiveTerminalSender(tabId: string) {
  if (ownerTabId !== tabId) return
  ownerTabId = null
  sender.value = null
  canSendToTerminal.value = false
}

export function getActiveTerminalSender(): Sender | null {
  return sender.value
}

/** 活跃 tab 是否为终端类型(可发送指令);用于侧栏按钮禁用判断 */
export const canSendToTerminal = ref(false)
