import type { UnlistenFn } from '@tauri-apps/api/event'

import { onKiPrompt, sshKiRespond, type KiPromptPayload } from '@/api/ssh'
import { openMultiPrompt } from '@/stores/prompt'

let unlisten: UnlistenFn | null = null

/** 在 App.vue onMounted 时调用,注册 keyboard-interactive 认证事件监听 */
export async function initKiGuard(): Promise<void> {
  if (unlisten) return
  unlisten = await onKiPrompt(handlePrompt)
}

/** 在 App.vue onBeforeUnmount 时调用 */
export function destroyKiGuard(): void {
  unlisten?.()
  unlisten = null
}

async function handlePrompt(p: KiPromptPayload): Promise<void> {
  const answers = await openMultiPrompt({
    title: p.name || '交互式认证',
    message: p.instructions || undefined,
    prompts: p.prompts.map((x) => ({ label: x.prompt, echo: x.echo })),
    confirmText: '确认',
    cancelText: '取消',
  })
  // 取消时回传空数组,让后端报错关闭连接;不阻塞
  await sshKiRespond(p.promptId, answers ?? []).catch(() => {})
}
