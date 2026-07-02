/** 是否运行在 macOS 上 */
export const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.userAgent || navigator.platform || '')

/** 快捷键修饰键:Mac 用 ⌘,其余用 Ctrl */
export const modKey = isMac ? '⌘' : 'Ctrl'
