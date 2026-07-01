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

interface StoredPrefs {
  themeMode: ThemeMode
  themeColorId: string
  fontSize: number
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        themeMode: p.themeMode ?? 'dark',
        themeColorId: p.themeColorId ?? 'blue',
        fontSize: p.fontSize ?? 13,
      }
    }
  } catch {}
  return { themeMode: 'dark', themeColorId: 'blue', fontSize: 13 }
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
watch([themeMode, themeColorId, fontSize], () => {
  applyTheme()
  savePrefs({ themeMode: themeMode.value, themeColorId: themeColorId.value, fontSize: fontSize.value })
})
