import { ref } from 'vue'
import { activeTabId } from '@/stores/tabs'
import { watch } from 'vue'

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

// 活跃 tab 变化时由 TerminalSplit 重新注册;这里仅暴露读写接口
export function setActiveTerminalSender(fn: Sender | null) {
  sender.value = fn
}

export function getActiveTerminalSender(): Sender | null {
  return sender.value
}

/** 活跃 tab 是否为终端类型(可发送指令);用于侧栏按钮禁用判断 */
export const canSendToTerminal = ref(false)

/**
 * 绑定 activeTabId 变化,由 TerminalSplit 调用:
 * 当 tab 切到当前终端时调 bind(true),切走时调 bind(false)。
 * 非 terminal tab 活跃时 canSendToTerminal 为 false。
 */
export function useActiveTerminalBinding(tabId: string, isTerminal: boolean) {
  watch(
    activeTabId,
    (cur) => {
      if (cur === tabId && isTerminal) {
        canSendToTerminal.value = true
      } else {
        // 切走时:只有当前是本 tab 持有的发送权才清空
        if (canSendToTerminal.value && cur !== tabId) {
          canSendToTerminal.value = false
          sender.value = null
        }
      }
    },
    { immediate: true },
  )
}
