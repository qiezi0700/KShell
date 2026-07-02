import { sshExec } from './ssh'

// ============================================================
// 类型定义
// ============================================================

export interface CpuStats {
  user: number
  nice: number
  system: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
  /** 总 jiffies(各项之和),用于差分计算使用率 */
  total: number
  /** 已派生的总体使用率百分比;首次采集无 prev 时为 null */
  usagePct: number | null
}

export interface MemStats {
  totalKb: number
  availableKb: number
  usedKb: number
  usagePct: number
  swapTotalKb: number
  swapFreeKb: number
  swapUsedKb: number
  swapUsagePct: number
}

export interface LoadStats {
  load1: number
  load5: number
  load15: number
  running: number
  total: number
}

export interface NetIfStats {
  name: string
  rxBytes: number
  txBytes: number
  /** 派生速率(B/s);首次为 null */
  rxRate: number | null
  txRate: number | null
}

export interface DiskStats {
  fs: string
  totalKb: number
  usedKb: number
  availKb: number
  capacityPct: number
  mount: string
}

export interface SysInfo {
  hostname: string
  kernelName: string
  kernelRelease: string
  arch: string
  uptimeSecs: number
  cpuCores: number
  bootTime: number
}

export interface MonitorSample {
  ts: number
  cpu: CpuStats
  mem: MemStats
  load: LoadStats
  net: NetIfStats[]
  disk: DiskStats[]
  /** 静态系统信息,仅首次采集包含 */
  sys: SysInfo | null
}

// ============================================================
// 采集脚本
// 一次性输出全部指标,带 ===KSM_xxx=== 标记分段,前端按标记解析。
// 仅依赖 /proc、uname、df、awk、grep,BusyBox 与 coreutils 均兼容。
// ============================================================

export const MONITOR_SCRIPT = [
  'echo "===KSM_STAT==="; head -n1 /proc/stat',
  'echo "===KSM_MEM==="; grep -E "^(MemTotal|MemAvailable|SwapTotal|SwapFree):" /proc/meminfo',
  'echo "===KSM_LOAD==="; cat /proc/loadavg',
  'echo "===KSM_NET==="; tail -n +3 /proc/net/dev',
  'echo "===KSM_DISK==="; df -P 2>/dev/null | tail -n +2',
  'echo "===KSM_SYS==="; echo "$(uname -n)|$(uname -s)|$(uname -r)|$(uname -m)|$(awk "{print int(\\$1)}" /proc/uptime)|$(nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo)|$(awk "/^btime/{print \\$2}" /proc/stat)"',
].join('; ')

// ============================================================
// 解析
// ============================================================

function section(lines: string[], tag: string): string[] {
  const start = lines.indexOf(`===KSM_${tag}===`)
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('===KSM_') && lines[i].endsWith('===')) break
    const t = lines[i].trim()
    if (t) out.push(t)
  }
  return out
}

function parseCpu(line: string, prev: MonitorSample | null): CpuStats {
  // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
  const p = line.split(/\s+/)
  const [user, nice, system, idle, iowait, irq, softirq, steal] = p.slice(1, 9).map(Number)
  const total = user + nice + system + idle + iowait + irq + softirq + steal
  const busy = user + nice + system + irq + softirq + steal
  let usagePct: number | null = null
  if (prev) {
    const dt = total - prev.cpu.total
    const db = busy - (prev.cpu.user + prev.cpu.nice + prev.cpu.system + prev.cpu.irq + prev.cpu.softirq + prev.cpu.steal)
    if (dt > 0) usagePct = Math.max(0, Math.min(100, (db / dt) * 100))
  }
  return { user, nice, system, idle, iowait, irq, softirq, steal, total, usagePct }
}

function parseMem(lines: string[]): MemStats {
  const map: Record<string, number> = {}
  for (const l of lines) {
    const m = l.match(/^(\w+):\s+(\d+)/)
    if (m) map[m[1]] = Number(m[2])
  }
  const totalKb = map.MemTotal ?? 0
  const availableKb = map.MemAvailable ?? totalKb
  const usedKb = Math.max(0, totalKb - availableKb)
  const swapTotalKb = map.SwapTotal ?? 0
  const swapFreeKb = map.SwapFree ?? swapTotalKb
  const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb)
  return {
    totalKb,
    availableKb,
    usedKb,
    usagePct: totalKb > 0 ? (usedKb / totalKb) * 100 : 0,
    swapTotalKb,
    swapFreeKb,
    swapUsedKb,
    swapUsagePct: swapTotalKb > 0 ? (swapUsedKb / swapTotalKb) * 100 : 0,
  }
}

function parseLoad(line: string): LoadStats {
  const p = line.split(/\s+/)
  const rt = (p[3] ?? '0/0').split('/')
  return {
    load1: Number(p[0] ?? 0),
    load5: Number(p[1] ?? 0),
    load15: Number(p[2] ?? 0),
    running: Number(rt[0] ?? 0),
    total: Number(rt[1] ?? 0),
  }
}

function parseNet(lines: string[], prev: MonitorSample | null, dt: number): NetIfStats[] {
  return lines.map((l) => {
    // "eth0: 123 0 0 ... 456 0 ..."
    const idx = l.indexOf(':')
    const name = l.slice(0, idx).trim()
    const vals = l.slice(idx + 1).trim().split(/\s+/).map(Number)
    const rxBytes = vals[0] ?? 0
    const txBytes = vals[8] ?? 0
    let rxRate: number | null = null
    let txRate: number | null = null
    if (prev && dt > 0) {
      const pf = prev.net.find((n) => n.name === name)
      if (pf) {
        rxRate = Math.max(0, (rxBytes - pf.rxBytes) / dt)
        txRate = Math.max(0, (txBytes - pf.txBytes) / dt)
      }
    }
    return { name, rxBytes, txBytes, rxRate, txRate }
  }).filter((n) => !n.name.startsWith('lo'))
}

function parseDisk(lines: string[]): DiskStats[] {
  const out: DiskStats[] = []
  for (const l of lines) {
    // df -P: "Filesystem 1024-blocks Used Available Capacity Mounted on"
    // 过滤 tmpfs/devtmpfs/overlay/squashfs 等虚拟文件系统,只看块设备
    const p = l.split(/\s+/)
    if (p.length < 6) continue
    const fs = p[0]
    if (!fs.startsWith('/dev/')) continue
    out.push({
      fs,
      totalKb: Number(p[1] ?? 0),
      usedKb: Number(p[2] ?? 0),
      availKb: Number(p[3] ?? 0),
      capacityPct: Number((p[4] ?? '0%').replace('%', '')),
      mount: p.slice(5).join(' '),
    })
  }
  return out
}

function parseSys(line: string): SysInfo | null {
  if (!line) return null
  const p = line.split('|')
  if (p.length < 7) return null
  return {
    hostname: p[0] ?? '',
    kernelName: p[1] ?? '',
    kernelRelease: p[2] ?? '',
    arch: p[3] ?? '',
    uptimeSecs: Number(p[4] ?? 0),
    cpuCores: Number(p[5] ?? 0),
    bootTime: Number(p[6] ?? 0),
  }
}

/**
 * 解析采集脚本输出。传入上一次 sample 以派生 CPU 使用率与网络速率。
 */
export function parseSample(raw: string, prev: MonitorSample | null): MonitorSample {
  const lines = raw.split(/\r?\n/)
  const ts = Date.now()
  const dt = prev ? (ts - prev.ts) / 1000 : 0

  const stat = section(lines, 'STAT')
  const mem = parseMem(section(lines, 'MEM'))
  const load = parseLoad(section(lines, 'LOAD')[0] ?? '0 0 0 0/0')
  const net = parseNet(section(lines, 'NET'), prev, dt)
  const disk = parseDisk(section(lines, 'DISK'))
  const sys = prev?.sys ?? parseSys(section(lines, 'SYS')[0] ?? '')

  return {
    ts,
    cpu: parseCpu(stat[0] ?? 'cpu 0 0 0 0 0 0 0 0', prev),
    mem,
    load,
    net,
    disk,
    sys,
  }
}

/**
 * 触发一次采集并返回解析后的 sample(含派生速率/使用率)。
 */
export async function collectMonitor(
  sessionId: string,
  prev: MonitorSample | null,
): Promise<MonitorSample> {
  const raw = await sshExec(sessionId, MONITOR_SCRIPT)
  return parseSample(raw, prev)
}
