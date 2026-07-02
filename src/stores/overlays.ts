import { markRaw, shallowRef } from 'vue'
import type { Component } from 'vue'
import NewConnectionDialog from '@/components/dialogs/NewConnectionDialog.vue'
import ConfirmDialog from '@/components/dialogs/ConfirmDialog.vue'
import PromptDialog from '@/components/dialogs/PromptDialog.vue'
import PasswordPromptDialog from '@/components/dialogs/PasswordPromptDialog.vue'
import MultiPromptDialog from '@/components/dialogs/MultiPromptDialog.vue'
import MonitorDialog from '@/components/dialogs/MonitorDialog.vue'
import KeyManagerDialog from '@/components/dialogs/KeyManagerDialog.vue'
import CommandPalette from '@/components/dialogs/CommandPalette.vue'

export const overlays = shallowRef<Component[]>([])

export function registerOverlay(c: Component) {
  overlays.value = [...overlays.value, markRaw(c)]
}

// 启动时集中注册全局弹窗;新增功能弹窗只需在此 register
registerOverlay(NewConnectionDialog)
registerOverlay(ConfirmDialog)
registerOverlay(PromptDialog)
registerOverlay(PasswordPromptDialog)
registerOverlay(MultiPromptDialog)
registerOverlay(MonitorDialog)
registerOverlay(KeyManagerDialog)
registerOverlay(CommandPalette)
