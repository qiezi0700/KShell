import { settingsSet, upsertQuickCommand } from '@/api/settings'

/**
 * 一次性迁移:把老 localStorage 中的偏好 / 布局 / 快捷指令搬到 SQLite。
 * - 已迁移过(存在 kshell-settings-migrated 标记)则直接跳过。
 * - 迁移完毕清除老 key,保证只跑一次。
 * - 新装用户无老 key,本函数为空操作。
 *
 * localStorage 中 useStorage 存的值格式:
 * - 数值/字符串:直接是序列化后的字符串(如 "220" / "\"abc\"")
 * - quick-commands:JSON 数组字符串
 */
const MIGRATED_FLAG = 'kshell-settings-migrated'

// 老 localStorage key → SQLite settings key 的映射
const KV_KEYS: Array<[string, string]> = [
  ['kshell-preferences', 'kshell-preferences'],
  ['sidebar-width', 'sidebar-width'],
  ['terminal-sftp-height-pct', 'terminal-sftp-height-pct'],
  ['sftp-local-width-pct', 'sftp-local-width-pct'],
]

// 快捷指令在 localStorage 里的 key(useStorage 自动包一层 JSON)
const QC_KEY = 'kshell.quick-commands'

export async function migrateLocalStorage(): Promise<void> {
  if (localStorage.getItem(MIGRATED_FLAG)) return

  // 1) KV 项:原样写入 settings 表
  for (const [lsKey, dbKey] of KV_KEYS) {
    const raw = localStorage.getItem(lsKey)
    if (raw != null) {
      try {
        await settingsSet(dbKey, raw)
      } catch {
        // 单项失败不阻断其余迁移
      }
    }
  }

  // 2) 快捷指令:useStorage 存的是 JSON 数组,解析后逐条 upsert
  //    内置项(id 以 kshell-builtin- 开头)已在 Rust seed,跳过避免冲突
  const qcRaw = localStorage.getItem(QC_KEY)
  if (qcRaw) {
    try {
      const list = JSON.parse(qcRaw) as Array<{
        id: string
        label: string
        description: string
        command: string
      }>
      for (const item of list) {
        if (!item.id || item.id.startsWith('kshell-builtin-')) continue
        try {
          await upsertQuickCommand({
            id: item.id,
            label: item.label,
            description: item.description ?? '',
            command: item.command,
          })
        } catch {
          // 单条失败跳过
        }
      }
    } catch {
      // JSON 解析失败:老数据已损坏,放弃迁移
    }
  }

  // 3) 清理老 key,标记已完成
  for (const [lsKey] of KV_KEYS) localStorage.removeItem(lsKey)
  localStorage.removeItem(QC_KEY)
  localStorage.setItem(MIGRATED_FLAG, '1')
}
