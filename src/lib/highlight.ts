import hljs from 'highlight.js/lib/core'

// 按需注册常用语言,避免全量打包
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

import '@/styles/hljs.css'

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

Object.entries(languages).forEach(([name, lang]) => {
  hljs.registerLanguage(name, lang)
})

// 扩展名到 highlight.js 语言名的映射
const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  php: 'php',
  rb: 'ruby',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
}

/**
 * 根据文件名推测 highlight.js 语言名。
 * 无匹配时返回 undefined,调用方应回退到 auto。
 */
export function detectLanguage(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.split('.').pop() ?? ''
  return EXT_LANG[ext]
}

/**
 * 对代码进行语法高亮,返回已转义的 HTML。
 * 若未提供语言或语言未注册,则使用自动检测。
 */
export function highlightCode(code: string, filename?: string): string {
  const lang = filename ? detectLanguage(filename) : undefined
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  }
  return hljs.highlightAuto(code).value
}

export { hljs }
