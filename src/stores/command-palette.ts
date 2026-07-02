import { ref } from 'vue'

/** 命令面板显隐(Ctrl+K 触发) */
export const commandPaletteOpen = ref(false)

export function openCommandPalette() {
  commandPaletteOpen.value = true
}
