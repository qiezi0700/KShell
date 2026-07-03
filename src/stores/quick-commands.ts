import { useStorage } from '@vueuse/core'

/**
 * 快捷指令:所有 SSH 终端共享同一份列表,持久化到 localStorage
 * - label:必填,列表主标题
 * - description:选填,一句话说明命令含义,避免时间久了忘记
 * - command:实际发送到终端的内容
 */
export interface QuickCommand {
  id: string
  label: string
  description: string
  command: string
}

export const quickCommands = useStorage<QuickCommand[]>('kshell.quick-commands', [])

export function addQuickCommand(command: string, label?: string, description?: string) {
  const cmd = command.trim()
  if (!cmd) return
  const l = (label ?? '').trim()
  quickCommands.value.push({
    id: crypto.randomUUID(),
    label: l || cmd,
    description: (description ?? '').trim(),
    command: cmd,
  })
}

export function removeQuickCommand(id: string) {
  quickCommands.value = quickCommands.value.filter((c) => c.id !== id)
}

export function updateQuickCommand(
  id: string,
  patch: Partial<Pick<QuickCommand, 'label' | 'description' | 'command'>>,
) {
  const idx = quickCommands.value.findIndex((c) => c.id === id)
  if (idx === -1) return
  const cur = quickCommands.value[idx]
  quickCommands.value[idx] = {
    ...cur,
    label: patch.label !== undefined ? patch.label.trim() || cur.command : cur.label,
    description: patch.description !== undefined ? patch.description.trim() : cur.description,
    command: patch.command !== undefined ? patch.command.trim() || cur.command : cur.command,
  }
}
