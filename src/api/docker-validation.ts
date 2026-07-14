const IMAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9@:._/-]*$/
const MEMORY_RE = /^([0-9]+(?:\.[0-9]+)?)([bBkKmMgG]?)$/
const CPU_RE = /^[0-9]+(?:\.[0-9]+)?$/
const REGISTRY_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
const REGISTRY_PATH_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/
const REGISTRY_USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+@-]*$/
const MIN_MEMORY_BYTES = 6 * 1024 * 1024
const MAX_MEMORY_BYTES = 9_223_372_036_854_775_807
const MAX_NANO_CPUS = 9_223_372_036_854_775_807
const MEMORY_UNIT_BYTES: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1024,
  m: 1024 * 1024,
  g: 1024 * 1024 * 1024,
}

export function validateDockerImageReference(reference: string): void {
  if (!reference || reference.length > 4096 || !IMAGE_RE.test(reference) || reference.includes('//')) {
    throw new Error(`镜像标识不合法: ${reference}`)
  }
}

export function validateDockerMemoryLimit(memory: string, allowZero: boolean): void {
  if (allowZero && memory === '0') return
  const match = MEMORY_RE.exec(memory)
  const amount = match ? Number(match[1]) : Number.NaN
  const multiplier = match ? MEMORY_UNIT_BYTES[(match[2] ?? '').toLowerCase()] : undefined
  const bytes = multiplier === undefined ? Number.NaN : amount * multiplier
  if (
    !Number.isFinite(bytes)
    || amount <= 0
    || bytes < MIN_MEMORY_BYTES
    || bytes > MAX_MEMORY_BYTES
  ) {
    throw new Error(`内存限制不合法: ${memory}(最小 6m，示例:512m / 2g)`)
  }
}

export function validateDockerCpuLimit(cpus: string, allowZero: boolean): void {
  if (allowZero && cpus === '0') return
  const value = CPU_RE.test(cpus) ? Number(cpus) : Number.NaN
  if (!Number.isFinite(value) || value <= 0 || value * 1e9 > MAX_NANO_CPUS) {
    throw new Error(`CPU 数不合法: ${cpus}(必须大于 0，示例:1.5)`)
  }
}

function isValidIpv6(host: string): boolean {
  if (!host.includes(':') || !/^[0-9a-fA-F:.]+$/.test(host)) return false
  try {
    new URL(`http://[${host}]/`)
    return true
  } catch {
    return false
  }
}

export function validateDockerRegistry(registry: string): void {
  if (!registry) return
  const invalid = () => {
    throw new Error(`registry 地址不合法(示例:registry.example.com:5000): ${registry}`)
  }
  if (registry.length > 512 || /[\s?#@]/.test(registry) || registry.includes('://')) invalid()

  const slashIndex = registry.indexOf('/')
  const authority = slashIndex >= 0 ? registry.slice(0, slashIndex) : registry
  const path = slashIndex >= 0 ? registry.slice(slashIndex + 1) : ''
  if (!authority || (slashIndex >= 0 && path.split('/').some((part) => !REGISTRY_PATH_SEGMENT_RE.test(part)))) {
    invalid()
  }

  let host = authority
  let portText = ''
  if (authority.startsWith('[')) {
    const closing = authority.indexOf(']')
    if (closing <= 1) invalid()
    host = authority.slice(1, closing)
    const rest = authority.slice(closing + 1)
    if (rest) {
      if (!rest.startsWith(':')) invalid()
      portText = rest.slice(1)
    }
    if (!isValidIpv6(host)) invalid()
  } else {
    const colonIndex = authority.lastIndexOf(':')
    if (colonIndex >= 0) {
      if (authority.indexOf(':') !== colonIndex) invalid()
      host = authority.slice(0, colonIndex)
      portText = authority.slice(colonIndex + 1)
    }
    if (!host || host.length > 253) invalid()
    const labels = host.split('.')
    if (labels.some((label) => !REGISTRY_LABEL_RE.test(label))) invalid()
    if (/^[0-9.]+$/.test(host)) {
      if (labels.length !== 4 || labels.some((label) => Number(label) > 255)) invalid()
    }
  }

  if (portText) {
    if (!/^[0-9]{1,5}$/.test(portText)) invalid()
    const port = Number(portText)
    if (port < 1 || port > 65535) invalid()
  } else if (authority.endsWith(':')) {
    invalid()
  }
}

export function validateDockerRegistryUser(user: string): void {
  if (user.length > 255 || !REGISTRY_USER_RE.test(user)) {
    throw new Error('用户名不合法(允许字母数字与 . _ - + @)')
  }
}
