<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, shallowRef } from 'vue'
// 仅引入类型(编译时擦除,不进 bundle);运行时 echarts 在打开对话框时动态加载
import type * as EChartsCore from 'echarts/core'
import {
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  Activity,
  Monitor,
} from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  activeSample,
  activeHistory,
  monitorDialogOpen,
} from '@/stores/monitor'
import type { MonitorSample } from '@/api/monitor'

const sample = activeSample
const history = activeHistory

// ============================================================
// 主题/字号适配:从 CSS 变量读取颜色与字号,主题或字号变化时刷新图表
// ============================================================
import { fontSize, themeMode, themeColorId } from '@/stores/preferences'

// 读取根元素 CSS 变量的像素值(如 '--text-xs' → 10)
function cssVarPx(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return parseFloat(v) || 10
}
function cssVarColor(name: string): string {
  // 兜底取 muted-foreground 而不是硬编码 #888,保持主题一致
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (v) return v
  return getComputedStyle(document.documentElement).getPropertyValue('--color-muted-foreground').trim() || 'oklch(0.68 0.01 260)'
}

// 图表统一配色/字号;字号随全局 UI 字号缩放(图表内文字比界面小一档)
const chartStyle = computed(() => {
  // 用 --text-xs 作为图表文字基准(界面字号变化时图表同步)
  const base = cssVarPx('--text-xs')
  return {
    fontSize: base,
    labelColor: cssVarColor('--color-muted-foreground'),
    lineColor: cssVarColor('--color-border'),
    primary: cssVarColor('--color-primary'),
    success: cssVarColor('--color-success'),
    warning: cssVarColor('--color-warning'),
    destructive: cssVarColor('--color-destructive'),
  }
})

// 图表 DOM 引用
const cpuEl = ref<HTMLDivElement | null>(null)
const memEl = ref<HTMLDivElement | null>(null)
const netEl = ref<HTMLDivElement | null>(null)
const loadEl = ref<HTMLDivElement | null>(null)

// echarts 模块延迟加载(首次打开对话框时才 import,避免进主 chunk)
const echartsLib = shallowRef<typeof EChartsCore | null>(null)
let cpuChart: EChartsCore.ECharts | null = null
let memChart: EChartsCore.ECharts | null = null
let netChart: EChartsCore.ECharts | null = null
let loadChart: EChartsCore.ECharts | null = null

// 时间轴标签:相对首次的 mm:ss
function xAxis(h: MonitorSample[]) {
  if (h.length === 0) return [] as string[]
  const base = h[0].ts
  return h.map((s) => {
    const sec = Math.round((s.ts - base) / 1000)
    const m = Math.floor(sec / 60)
    const r = sec % 60
    return `${m}:${String(r).padStart(2, '0')}`
  })
}

function cpuOption(h: MonitorSample[]) {
  const s = chartStyle.value
  return {
    grid: { left: 36, right: 12, top: 24, bottom: 24 },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: number) => v.toFixed(1) + '%', textStyle: { color: s.labelColor, fontSize: s.fontSize } },
    xAxis: { type: 'category' as const, data: xAxis(h), axisLabel: { fontSize: s.fontSize, color: s.labelColor }, axisLine: { lineStyle: { color: s.lineColor } } },
    yAxis: { type: 'value' as const, max: 100, axisLabel: { fontSize: s.fontSize, color: s.labelColor, formatter: '{value}%' }, splitLine: { lineStyle: { color: s.lineColor } } },
    series: [
      {
        name: 'CPU',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.15, color: s.primary },
        lineStyle: { width: 2, color: s.primary },
        itemStyle: { color: s.primary },
        data: h.map((s) => s.cpu.usagePct),
      },
    ],
  }
}

function memOption(h: MonitorSample[]) {
  const s = chartStyle.value
  return {
    grid: { left: 36, right: 12, top: 36, bottom: 24 },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: number) => v.toFixed(1) + '%', textStyle: { color: s.labelColor, fontSize: s.fontSize } },
    legend: { data: ['内存', 'Swap'], top: 0, textStyle: { fontSize: s.fontSize, color: s.labelColor } },
    xAxis: { type: 'category' as const, data: xAxis(h), axisLabel: { fontSize: s.fontSize, color: s.labelColor }, axisLine: { lineStyle: { color: s.lineColor } } },
    yAxis: { type: 'value' as const, max: 100, axisLabel: { fontSize: s.fontSize, color: s.labelColor, formatter: '{value}%' }, splitLine: { lineStyle: { color: s.lineColor } } },
    series: [
      { name: '内存', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.primary, width: 2 }, itemStyle: { color: s.primary }, data: h.map((s) => s.mem.usagePct) },
      { name: 'Swap', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.warning, width: 2 }, itemStyle: { color: s.warning }, data: h.map((s) => s.mem.swapUsagePct) },
    ],
  }
}

// 网络速率:聚合所有非 lo 接口的 rxRate/txRate 之和
function netRate(h: MonitorSample[], kind: 'rx' | 'tx') {
  return h.map((s) => {
    let sum = 0
    let has = false
    for (const n of s.net) {
      const r = kind === 'rx' ? n.rxRate : n.txRate
      if (r != null) {
        sum += r
        has = true
      }
    }
    return has ? sum : null
  })
}

function fmtBytes(n: number | null) {
  if (n == null) return '--'
  if (n < 1024) return n.toFixed(0) + ' B/s'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB/s'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB/s'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB/s'
}

function netOption(h: MonitorSample[]) {
  const s = chartStyle.value
  return {
    grid: { left: 60, right: 12, top: 36, bottom: 24 },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => fmtBytes(v),
      textStyle: { color: s.labelColor, fontSize: s.fontSize },
    },
    legend: { data: ['下行', '上行'], top: 0, textStyle: { fontSize: s.fontSize, color: s.labelColor } },
    xAxis: { type: 'category' as const, data: xAxis(h), axisLabel: { fontSize: s.fontSize, color: s.labelColor }, axisLine: { lineStyle: { color: s.lineColor } } },
    yAxis: {
      type: 'value' as const,
      axisLabel: {
        fontSize: s.fontSize,
        color: s.labelColor,
        formatter: (v: number) => fmtBytes(v).replace('/s', ''),
      },
      splitLine: { lineStyle: { color: s.lineColor } },
    },
    series: [
      { name: '下行', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.primary, width: 2 }, itemStyle: { color: s.primary }, data: netRate(h, 'rx') },
      { name: '上行', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.success, width: 2 }, itemStyle: { color: s.success }, data: netRate(h, 'tx') },
    ],
  }
}

function loadOption(h: MonitorSample[]) {
  const s = chartStyle.value
  const max = Math.max(1, ...h.map((s) => s.load.load1))
  return {
    grid: { left: 36, right: 12, top: 36, bottom: 24 },
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: number) => v.toFixed(2), textStyle: { color: s.labelColor, fontSize: s.fontSize } },
    legend: { data: ['1min', '5min', '15min'], top: 0, textStyle: { fontSize: s.fontSize, color: s.labelColor } },
    xAxis: { type: 'category' as const, data: xAxis(h), axisLabel: { fontSize: s.fontSize, color: s.labelColor }, axisLine: { lineStyle: { color: s.lineColor } } },
    yAxis: { type: 'value' as const, max: Math.ceil(max), axisLabel: { fontSize: s.fontSize, color: s.labelColor }, splitLine: { lineStyle: { color: s.lineColor } } },
    series: [
      { name: '1min', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.primary, width: 2 }, itemStyle: { color: s.primary }, data: h.map((s) => s.load.load1) },
      { name: '5min', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.warning, width: 2 }, itemStyle: { color: s.warning }, data: h.map((s) => s.load.load5) },
      { name: '15min', type: 'line' as const, smooth: true, showSymbol: false, lineStyle: { color: s.labelColor, width: 1.5 }, itemStyle: { color: s.labelColor }, data: h.map((s) => s.load.load15) },
    ],
  }
}

function refresh() {
  const h = history.value
  if (h.length === 0) return
  cpuChart?.setOption(cpuOption(h), true)
  memChart?.setOption(memOption(h), true)
  netChart?.setOption(netOption(h), true)
  loadChart?.setOption(loadOption(h), true)
}

// 首次打开对话框时动态加载 echarts 各模块并注册,避免进入主 chunk
async function loadEcharts() {
  if (echartsLib.value) return echartsLib.value
  const [core, charts, components, renderers] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ])
  core.use([
    charts.LineChart,
    components.GridComponent,
    components.TooltipComponent,
    components.LegendComponent,
    components.TitleComponent,
    renderers.CanvasRenderer,
  ])
  echartsLib.value = core
  return core
}

async function initCharts() {
  const ec = await loadEcharts()
  // 加载期间对话框可能已关闭,二次确认
  if (!monitorDialogOpen.value) return
  if (cpuEl.value && !cpuChart) cpuChart = ec.init(cpuEl.value)
  if (memEl.value && !memChart) memChart = ec.init(memEl.value)
  if (netEl.value && !netChart) netChart = ec.init(netEl.value)
  if (loadEl.value && !loadChart) loadChart = ec.init(loadEl.value)
  refresh()
}

function disposeCharts() {
  cpuChart?.dispose(); cpuChart = null
  memChart?.dispose(); memChart = null
  netChart?.dispose(); netChart = null
  loadChart?.dispose(); loadChart = null
}

function onResize() {
  cpuChart?.resize()
  memChart?.resize()
  netChart?.resize()
  loadChart?.resize()
}

// 对话框打开时初始化,关闭时释放
watch(
  monitorDialogOpen,
  (v) => {
    if (v) {
      // DOM 渲染后异步初始化(首次会触发 echarts 动态加载)
      requestAnimationFrame(() => { initCharts() })
      window.addEventListener('resize', onResize)
    } else {
      disposeCharts()
      window.removeEventListener('resize', onResize)
    }
  },
)

// 历史更新时刷新图表
watch(history, refresh, { deep: true })

// 全局 UI 字号/主题模式/主题色变化时重新读取 CSS 变量并刷新图表
watch([fontSize, themeMode, themeColorId], () => {
  // 切换主题后 CSS 变量异步生效,下一帧再刷新
  requestAnimationFrame(() => {
    if (monitorDialogOpen.value) refresh()
  })
})

onBeforeUnmount(() => {
  disposeCharts()
  window.removeEventListener('resize', onResize)
})

// ============================================================
// 派生展示数据
// ============================================================

const sys = computed(() => sample.value?.sys ?? null)
const disk = computed(() => sample.value?.disk ?? [])

function uptimeStr(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天 ${h}小时`
  if (h > 0) return `${h}小时 ${m}分钟`
  return `${m}分钟`
}

function fmtKb(kb: number) {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}
</script>

<template>
  <Dialog v-model:open="monitorDialogOpen">
    <DialogContent class="max-w-5xl w-[92vw] max-h-[88vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Monitor class="size-4" />
          <span>服务器监控</span>
          <span v-if="sys" class="text-body font-normal font-mono text-muted-foreground">
            {{ sys.hostname }}
          </span>
        </DialogTitle>
        <DialogDescription>实时资源使用情况(每 2 秒采样)</DialogDescription>
      </DialogHeader>

      <div v-if="!sample" class="text-body py-12 text-center text-muted-foreground">
        当前无活跃连接,请先打开一个 SSH 会话。
      </div>

      <div v-else class="space-y-3">
        <!-- 系统信息 -->
        <Card
          v-if="sys"
          class="text-body grid grid-cols-3 gap-x-4 gap-y-1.5 rounded-md border-border bg-panel p-3 shadow-none"
        >
          <div><span class="text-muted-foreground">主机名</span> <span class="ml-1 font-mono text-foreground">{{ sys.hostname }}</span></div>
          <div><span class="text-muted-foreground">系统</span> <span class="ml-1 font-mono text-foreground">{{ sys.kernelName }}</span></div>
          <div><span class="text-muted-foreground">内核</span> <span class="ml-1 font-mono text-foreground">{{ sys.kernelRelease }}</span></div>
          <div><span class="text-muted-foreground">架构</span> <span class="ml-1 font-mono text-foreground">{{ sys.arch }}</span></div>
          <div><span class="text-muted-foreground">核心数</span> <span class="ml-1 font-mono tabular-nums text-foreground">{{ sys.cpuCores }}</span></div>
          <div><span class="text-muted-foreground">运行时长</span> <span class="ml-1 font-mono tabular-nums text-foreground">{{ uptimeStr(sys.uptimeSecs) }}</span></div>
        </Card>

        <!-- 图表网格 -->
        <div class="grid grid-cols-2 gap-3">
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Cpu class="size-3.5 text-primary" />
              <span>CPU</span>
              <span class="ml-auto text-metric text-foreground normal-case tracking-normal">
                {{ sample.cpu.usagePct == null ? '--' : sample.cpu.usagePct.toFixed(1) + '%' }}
              </span>
            </div>
            <div ref="cpuEl" class="h-[160px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
              <MemoryStick class="size-3.5 text-primary" />
              <span>内存</span>
              <span class="ml-auto text-metric text-foreground normal-case tracking-normal">
                {{ fmtKb(sample.mem.usedKb) }} / {{ fmtKb(sample.mem.totalKb) }}
              </span>
            </div>
            <div ref="memEl" class="h-[160px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Network class="size-3.5 text-primary" />
              <span>网络</span>
              <span class="ml-auto text-metric text-foreground normal-case tracking-normal">
                ↓{{ fmtBytes(sample.net.reduce((a, n) => a + (n.rxRate ?? 0), 0)) }}
                ↑{{ fmtBytes(sample.net.reduce((a, n) => a + (n.txRate ?? 0), 0)) }}
              </span>
            </div>
            <div ref="netEl" class="h-[160px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Activity class="size-3.5 text-primary" />
              <span>系统负载</span>
              <span class="ml-auto text-metric text-foreground normal-case tracking-normal">
                {{ sample.load.load1.toFixed(2) }} / {{ sample.load.load5.toFixed(2) }} / {{ sample.load.load15.toFixed(2) }}
              </span>
            </div>
            <div ref="loadEl" class="h-[160px]" />
          </Card>
        </div>

        <!-- 磁盘 -->
        <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
          <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
            <HardDrive class="size-3.5 text-primary" />
            <span>磁盘使用</span>
          </div>
          <Table class="text-body">
            <TableHeader>
              <TableRow class="text-caption text-left hover:bg-transparent">
                <TableHead class="h-auto pb-1.5 font-medium">文件系统</TableHead>
                <TableHead class="h-auto pb-1.5 font-medium">挂载点</TableHead>
                <TableHead class="h-auto pb-1.5 text-right font-medium">总量</TableHead>
                <TableHead class="h-auto pb-1.5 text-right font-medium">已用</TableHead>
                <TableHead class="h-auto pb-1.5 text-right font-medium">可用</TableHead>
                <TableHead class="h-auto pb-1.5 text-right font-medium">使用率</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="d in disk" :key="d.fs + d.mount" class="border-t border-border/60 border-b-0 hover:bg-transparent">
                <TableCell class="py-1.5 font-mono">{{ d.fs }}</TableCell>
                <TableCell class="py-1.5 font-mono">{{ d.mount }}</TableCell>
                <TableCell class="py-1.5 text-right font-mono tabular-nums">{{ fmtKb(d.totalKb) }}</TableCell>
                <TableCell class="py-1.5 text-right font-mono tabular-nums">{{ fmtKb(d.usedKb) }}</TableCell>
                <TableCell class="py-1.5 text-right font-mono tabular-nums">{{ fmtKb(d.availKb) }}</TableCell>
                <TableCell class="py-1.5 text-right font-mono tabular-nums font-medium" :class="d.capacityPct >= 90 ? 'text-destructive' : d.capacityPct >= 70 ? 'text-warning' : 'text-foreground'">
                  {{ d.capacityPct }}%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </DialogContent>
  </Dialog>
</template>
