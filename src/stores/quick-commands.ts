import { ref } from 'vue'
import {
  listQuickCommands,
  upsertQuickCommand,
  deleteQuickCommand,
  type QuickCommand,
} from '@/api/settings'

/**
 * 快捷指令:所有 SSH 终端共享同一份列表,持久化到 SQLite(quick_commands 表)。
 * - label:必填,列表主标题
 * - description:选填,一句话说明命令含义,避免时间久了忘记
 * - command:实际发送到终端的内容
 * - builtin 非 0 为系统内置(首次建库时 Rust seed),不可删除/编辑
 *
 * App.vue 在渲染主 UI 前调用 initQuickCommands() 从 SQLite 加载列表。
 */
export type { QuickCommand }

export const quickCommands = ref<QuickCommand[]>([])

let qcReady = false

/** 从 SQLite 加载快捷指令列表;重复调用安全(只生效一次) */
export async function initQuickCommands(): Promise<void> {
  if (qcReady) return
  try {
    quickCommands.value = await listQuickCommands()
  } catch {
    quickCommands.value = []
  }
  qcReady = true
}

export async function addQuickCommand(command: string, label?: string, description?: string) {
  const cmd = command.trim()
  if (!cmd) return
  const l = (label ?? '').trim()
  const item = await upsertQuickCommand({
    label: l || cmd,
    description: (description ?? '').trim(),
    command: cmd,
  })
  quickCommands.value.push(item)
}

export async function removeQuickCommand(id: string) {
  await deleteQuickCommand(id)
  quickCommands.value = quickCommands.value.filter((c) => c.id !== id)
}

export async function updateQuickCommand(
  id: string,
  patch: Partial<Pick<QuickCommand, 'label' | 'description' | 'command'>>,
) {
  const idx = quickCommands.value.findIndex((c) => c.id === id)
  if (idx === -1) return
  const cur = quickCommands.value[idx]
  const updated = await upsertQuickCommand({
    id: cur.id,
    label: patch.label !== undefined ? patch.label.trim() || cur.command : cur.label,
    description: patch.description !== undefined ? patch.description.trim() : cur.description,
    command: patch.command !== undefined ? patch.command.trim() || cur.command : cur.command,
    sort: cur.sort,
    builtin: cur.builtin,
  })
  quickCommands.value[idx] = updated
}
