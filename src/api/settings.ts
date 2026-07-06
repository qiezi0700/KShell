import { invoke } from '@tauri-apps/api/core'

/**
 * 快捷指令项,与后端 store::QuickCommand 对齐。
 * builtin 非 0 为系统内置(不可删除/编辑),0 为用户自定义。
 */
export interface QuickCommand {
  id: string
  label: string
  description: string
  command: string
  sort: number
  builtin: number
}

// ---- 设置 KV ----

/** 读取一个设置项;不存在返回 null */
export function settingsGet(key: string): Promise<string | null> {
  return invoke('settings_get', { key })
}

/** 写入一个设置项(已存在则覆盖) */
export function settingsSet(key: string, value: string): Promise<void> {
  return invoke('settings_set', { key, value })
}

// ---- 快捷指令 ----

export function listQuickCommands(): Promise<QuickCommand[]> {
  return invoke('quick_commands_list')
}

/**
 * upsert 快捷指令。id 为空串代表新建,后端补 uuid 后返回完整项。
 * 内置项(builtin 非 0)禁止修改。
 */
export function upsertQuickCommand(
  item: Partial<QuickCommand> & { label: string; command: string },
): Promise<QuickCommand> {
  const payload: QuickCommand = {
    id: item.id ?? '',
    label: item.label,
    description: item.description ?? '',
    command: item.command,
    sort: item.sort ?? 0,
    builtin: item.builtin ?? 0,
  }
  return invoke('quick_command_upsert', { item: payload })
}

/** 删除快捷指令;内置项不可删,后端返回错误字符串 */
export function deleteQuickCommand(id: string): Promise<void> {
  return invoke('quick_command_delete', { id })
}
