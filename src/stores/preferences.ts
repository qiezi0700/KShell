import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeColor {
  id: string
  label: string
  hue: number
}

// 预设主题色
export const themeColors: ThemeColor[] = [
  { id: 'blue', label: '靛蓝', hue: 260 },
  { id: 'purple', label: '紫色', hue: 290 },
  { id: 'cyan', label: '青色', hue: 200 },
  { id: 'green', label: '绿色', hue: 165 },
  { id: 'orange', label: '橙色', hue: 60 },
  { id: 'pink', label: '粉色', hue: 330 },
  { id: 'red', label: '红色', hue: 25 },
]

const STORAGE_KEY = 'kshell-preferences'

// 界面字号档位:紧凑/默认/较大/大
export const UI_SIZE_LEVELS = [
  { id: 'compact', label: '紧凑', fontSize: 11 },
  { id: 'default', label: '默认', fontSize: 13 },
  { id: 'large', label: '较大', fontSize: 15 },
  { id: 'xlarge', label: '大', fontSize: 17 },
] as const

// 终端默认值
export const DEFAULT_TERMINAL_FONT_FAMILY = 'JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace'
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.15
export const DEFAULT_TERMINAL_SCROLLBACK = 5000
export const DEFAULT_TERMINAL_PADDING = 8

// 终端字体预设(每个 family 是含 fallback 的完整字体族链)
export const TERMINAL_FONT_OPTIONS = [
  { label: 'JetBrains Mono', family: 'JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace' },
  { label: 'Cascadia Code', family: 'Cascadia Code, Consolas, Menlo, monospace' },
  { label: 'Consolas', family: 'Consolas, Menlo, monospace' },
  { label: 'Menlo', family: 'Menlo, Monaco, Consolas, monospace' },
  { label: 'Source Code Pro', family: '"Source Code Pro", Consolas, Menlo, monospace' },
  { label: 'Fira Code', family: '"Fira Code", Consolas, Menlo, monospace' },
  { label: 'Courier New', family: '"Courier New", Consolas, monospace' },
  { label: '系统等宽', family: 'monospace' },
] as const

// 滚动缓冲档位
export const SCROLLBACK_LEVELS = [
  { value: 1000, label: '1k' },
  { value: 3000, label: '3k' },
  { value: 5000, label: '5k' },
  { value: 10000, label: '10k' },
  { value: 20000, label: '20k' },
] as const

function normalizeFontSize(n: number): number {
  const sizes = UI_SIZE_LEVELS.map((l) => l.fontSize)
  return sizes.reduce((prev, cur) => (Math.abs(cur - n) < Math.abs(prev - n) ? cur : prev))
}

interface StoredPrefs {
  themeMode: ThemeMode
  themeColorId: string
  fontSize: number
  syncKnownHostsToSystem: boolean
  terminalFontFamily: string
  terminalLineHeight: number
  terminalScrollback: number
  terminalPadding: number
}

function loadPrefs(): StoredPrefs {
  const defaults: StoredPrefs = {
    themeMode: 'dark',
    themeColorId: 'blue',
    fontSize: 13,
    syncKnownHostsToSystem: false,
    terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    terminalLineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
    terminalScrollback: DEFAULT_TERMINAL_SCROLLBACK,
    terminalPadding: DEFAULT_TERMINAL_PADDING,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        themeMode: p.themeMode ?? defaults.themeMode,
        themeColorId: p.themeColorId ?? defaults.themeColorId,
        fontSize: normalizeFontSize(p.fontSize ?? defaults.fontSize),
        syncKnownHostsToSystem: p.syncKnownHostsToSystem ?? defaults.syncKnownHostsToSystem,
        terminalFontFamily: p.terminalFontFamily ?? defaults.terminalFontFamily,
        terminalLineHeight: p.terminalLineHeight ?? defaults.terminalLineHeight,
        terminalScrollback: p.terminalScrollback ?? defaults.terminalScrollback,
        terminalPadding: p.terminalPadding ?? defaults.terminalPadding,
      }
    }
  } catch {}
  return defaults
}

function savePrefs(prefs: StoredPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {}
}

const stored = loadPrefs()

export const themeMode = ref<ThemeMode>(stored.themeMode)
export const themeColorId = ref<string>(stored.themeColorId)
// 界面字体大小(10-18),默认 13px
export const fontSize = ref<number>(stored.fontSize)
// 是否把 KShell 信任的主机公钥同步写入系统 ~/.ssh/known_hosts
export const syncKnownHostsToSystem = ref<boolean>(stored.syncKnownHostsToSystem)

// 终端配置
export const terminalFontFamily = ref<string>(stored.terminalFontFamily)
export const terminalLineHeight = ref<number>(stored.terminalLineHeight)
export const terminalScrollback = ref<number>(stored.terminalScrollback)
export const terminalPadding = ref<number>(stored.terminalPadding)

// 当前生效的明暗模式(themeMode 为 system 时跟随系统,供终端等需要响应主题切换的组件 watch)
export const effectiveMode = ref<'light' | 'dark'>('dark')

let mediaQuery: MediaQueryList | null = null
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null

function getEffectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme() {
  const effective = getEffectiveMode(themeMode.value)
  effectiveMode.value = effective
  const html = document.documentElement
  html.classList.remove('dark', 'light')
  html.classList.add(effective)

  const color = themeColors.find((c) => c.id === themeColorId.value) ?? themeColors[0]
  html.style.setProperty('--primary-hue', String(color.hue))
  html.style.setProperty('--font-size-ui', `${fontSize.value}px`)
}

export function initTheme() {
  applyTheme()

  // 监听系统主题变化(仅 system 模式生效)
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaHandler = () => {
    if (themeMode.value === 'system') applyTheme()
  }
  mediaQuery.addEventListener('change', mediaHandler)
}

export function destroyTheme() {
  if (mediaQuery && mediaHandler) {
    mediaQuery.removeEventListener('change', mediaHandler)
  }
}

// 持久化 + 即时应用
watch(
  [themeMode, themeColorId, fontSize, syncKnownHostsToSystem, terminalFontFamily, terminalLineHeight, terminalScrollback, terminalPadding],
  () => {
    applyTheme()
    savePrefs({
      themeMode: themeMode.value,
      themeColorId: themeColorId.value,
      fontSize: fontSize.value,
      syncKnownHostsToSystem: syncKnownHostsToSystem.value,
      terminalFontFamily: terminalFontFamily.value,
      terminalLineHeight: terminalLineHeight.value,
      terminalScrollback: terminalScrollback.value,
      terminalPadding: terminalPadding.value,
    })
  },
)
