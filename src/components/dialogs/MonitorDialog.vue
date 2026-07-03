<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, shallowRef } from 'vue'
// 仅引入类型(编译时擦除,不进 bundle);运行时 echarts 在打开对话框时动态加载
import type * as EChartsCore from 'echarts/core'
import {
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  Activity,
  Monitor,
  ArrowDown,
  ArrowUp,
} from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatusDot } from '@/components/ui/status-dot'
import Sparkline from '@/components/monitor/Sparkline.vue'
import {
  activeSample,
  activeHistory,
  monitorDialogOpen,
} from '@/stores/monitor'
import type { MonitorSample } from '@/api/monitor'

const sample = activeSample
const history = activeHistory

// ============================================================
// 主题 / 字号适配:从 CSS 变量读取颜色与字号,主题或字号变化时刷新图表
// ============================================================
import { fontSize, themeMode, themeColorId } from '@/stores/preferences'

function cssVarPx(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return parseFloat(v) || 10
}
function cssVarColor(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (v) return v
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--color-muted-foreground').trim() ||
    'oklch(0.68 0.01 260)'
  )
}

const chartStyle = computed(() => {
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

const echartsLib = shallowRef<typeof EChartsCore | null>(null)
let cpuChart: EChartsCore.ECharts | null = null
let memChart: EChartsCore.ECharts | null = null
let netChart: EChartsCore.ECharts | null = null
let loadChart: EChartsCore.ECharts | null = null

// 相对首次采样的 mm:ss 时间标签
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

// 公共坐标轴/网格样式:更淡的辅助线,给数据让出视觉焦点
function baseAxis(s: ReturnType<typeof chartStyle.value.valueOf> | typeof chartStyle.value) {
  const st = s as typeof chartStyle.value
  return {
    axisLabel: { fontSize: st.fontSize, color: st.labelColor },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: st.lineColor, opacity: 0.5, type: 'dashed' as const } },
  }
}

function cpuOption(h: MonitorSample[]) {
  const s = chartStyle.value
  return {
    grid: { left: 40, right: 12, top: 12, bottom: 22 },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => v.toFixed(1) + '%',
      textStyle: { color: s.labelColor, fontSize: s.fontSize },
    },
    xAxis: {
      type: 'category' as const,
      data: xAxis(h),
      boundaryGap: false,
      ...baseAxis(s),
    },
    yAxis: {
      type: 'value' as const,
      max: 100,
      ...baseAxis(s),
      axisLabel: { fontSize: s.fontSize, color: s.labelColor, formatter: '{value}%' },
    },
    series: [
      {
        name: 'CPU',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.18, color: s.primary },
        lineStyle: { width: 2, color: s.primary },
        itemStyle: { color: s.primary },
        data: h.map((x) => x.cpu.usagePct),
        // 70/90 阈值参考线;silent 避免被 tooltip 触发
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 70, lineStyle: { color: s.warning, type: 'dashed' as const, opacity: 0.5, width: 1 } },
            { yAxis: 90, lineStyle: { color: s.destructive, type: 'dashed' as const, opacity: 0.5, width: 1 } },
          ],
        },
        // 高亮窗口内峰值
        markPoint: {
          symbol: 'circle',
          symbolSize: 6,
          label: { show: false },
          data: [{ type: 'max' as const, itemStyle: { color: s.destructive, borderColor: '#fff', borderWidth: 1 } }],
        },
      },
    ],
  }
}

function memOption(h: MonitorSample[]) {
  const s = chartStyle.value
  return {
    grid: { left: 40, right: 12, top: 28, bottom: 22 },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => v.toFixed(1) + '%',
      textStyle: { color: s.labelColor, fontSize: s.fontSize },
    },
    legend: {
      data: ['内存', 'Swap'],
      top: 0,
      right: 0,
      textStyle: { fontSize: s.fontSize, color: s.labelColor },
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: { type: 'category' as const, data: xAxis(h), boundaryGap: false, ...baseAxis(s) },
    yAxis: {
      type: 'value' as const,
      max: 100,
      ...baseAxis(s),
      axisLabel: { fontSize: s.fontSize, color: s.labelColor, formatter: '{value}%' },
    },
    series: [
      {
        name: '内存',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.18, color: s.primary },
        lineStyle: { color: s.primary, width: 2 },
        itemStyle: { color: s.primary },
        data: h.map((x) => x.mem.usagePct),
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            { yAxis: 70, lineStyle: { color: s.warning, type: 'dashed' as const, opacity: 0.5, width: 1 } },
            { yAxis: 90, lineStyle: { color: s.destructive, type: 'dashed' as const, opacity: 0.5, width: 1 } },
          ],
        },
      },
      {
        name: 'Swap',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: s.warning, width: 1.5 },
        itemStyle: { color: s.warning },
        data: h.map((x) => x.mem.swapUsagePct),
      },
    ],
  }
}

// 聚合所有非 lo 接口的 rxRate / txRate
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
    grid: { left: 62, right: 12, top: 28, bottom: 22 },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => fmtBytes(v),
      textStyle: { color: s.labelColor, fontSize: s.fontSize },
    },
    legend: {
      data: ['下行', '上行'],
      top: 0,
      right: 0,
      textStyle: { fontSize: s.fontSize, color: s.labelColor },
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: { type: 'category' as const, data: xAxis(h), boundaryGap: false, ...baseAxis(s) },
    yAxis: {
      type: 'value' as const,
      ...baseAxis(s),
      axisLabel: {
        fontSize: s.fontSize,
        color: s.labelColor,
        formatter: (v: number) => fmtBytes(v).replace('/s', ''),
      },
    },
    series: [
      {
        name: '下行',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.14, color: s.primary },
        lineStyle: { color: s.primary, width: 2 },
        itemStyle: { color: s.primary },
        data: netRate(h, 'rx'),
      },
      {
        name: '上行',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.14, color: s.success },
        lineStyle: { color: s.success, width: 2 },
        itemStyle: { color: s.success },
        data: netRate(h, 'tx'),
      },
    ],
  }
}

function loadOption(h: MonitorSample[]) {
  const s = chartStyle.value
  const cores = sample.value?.sys?.cpuCores ?? 0
  const dataMax = Math.max(1, ...h.map((x) => x.load.load1))
  const yMax = Math.ceil(Math.max(dataMax, cores > 0 ? cores : 1))
  return {
    grid: { left: 32, right: 12, top: 28, bottom: 22 },
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => v.toFixed(2),
      textStyle: { color: s.labelColor, fontSize: s.fontSize },
    },
    legend: {
      data: ['1min', '5min', '15min'],
      top: 0,
      right: 0,
      textStyle: { fontSize: s.fontSize, color: s.labelColor },
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: { type: 'category' as const, data: xAxis(h), boundaryGap: false, ...baseAxis(s) },
    yAxis: { type: 'value' as const, max: yMax, ...baseAxis(s) },
    series: [
      {
        name: '1min',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.14, color: s.primary },
        lineStyle: { color: s.primary, width: 2 },
        itemStyle: { color: s.primary },
        data: h.map((x) => x.load.load1),
        // 核心数参考线:超过意味着 CPU 已饱和
        markLine: cores > 0 ? {
          silent: true,
          symbol: 'none',
          data: [{
            yAxis: cores,
            lineStyle: { color: s.destructive, type: 'dashed' as const, opacity: 0.5, width: 1 },
            label: { formatter: `核心数 ${cores}`, color: s.labelColor, fontSize: s.fontSize, position: 'insideEndTop' as const },
          }],
        } : undefined,
      },
      {
        name: '5min',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: s.warning, width: 1.5 },
        itemStyle: { color: s.warning },
        data: h.map((x) => x.load.load5),
      },
      {
        name: '15min',
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: s.labelColor, width: 1.2, opacity: 0.6 },
        itemStyle: { color: s.labelColor },
        data: h.map((x) => x.load.load15),
      },
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
    components.MarkLineComponent,
    components.MarkPointComponent,
    renderers.CanvasRenderer,
  ])
  echartsLib.value = core
  return core
}

async function initCharts() {
  const ec = await loadEcharts()
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

watch(monitorDialogOpen, (v) => {
  if (v) {
    requestAnimationFrame(() => { initCharts() })
    window.addEventListener('resize', onResize)
  } else {
    disposeCharts()
    window.removeEventListener('resize', onResize)
  }
})

watch(history, refresh, { deep: true })

watch([fontSize, themeMode, themeColorId], () => {
  requestAnimationFrame(() => {
    if (monitorDialogOpen.value) refresh()
  })
})

onBeforeUnmount(() => {
  disposeCharts()
  window.removeEventListener('resize', onResize)
})

// ============================================================
// 派生:KPI 卡展示所需的即时值、平均值、峰值、火花线数据
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

// 通用:数值列表统计(过滤 null / undefined,避免污染 avg/peak)
function stats(vs: (number | null | undefined)[]) {
  const arr = vs.filter((v): v is number => v != null && Number.isFinite(v))
  if (!arr.length) return { avg: null as number | null, peak: null as number | null }
  return {
    avg: arr.reduce((a, b) => a + b, 0) / arr.length,
    peak: Math.max(...arr),
  }
}

// 使用率类:70% 起橙、90% 起红
function pctVariant(pct: number | null): 'success' | 'warning' | 'destructive' | 'muted' {
  if (pct == null) return 'muted'
  if (pct >= 90) return 'destructive'
  if (pct >= 70) return 'warning'
  return 'success'
}

// 负载相对核心数;>= 核心数意味着饱和
function loadVariant(load: number | null, cores: number | null): 'success' | 'warning' | 'destructive' | 'muted' {
  if (load == null) return 'muted'
  if (!cores) return 'muted'
  const ratio = load / cores
  if (ratio >= 1) return 'destructive'
  if (ratio >= 0.7) return 'warning'
  return 'success'
}

// CPU KPI
const cpuNow = computed(() => sample.value?.cpu.usagePct ?? null)
const cpuSpark = computed(() => history.value.map((s) => s.cpu.usagePct))
const cpuStats = computed(() => stats(cpuSpark.value))
const cpuVariant = computed(() => pctVariant(cpuNow.value))

// 内存 KPI
const memNow = computed(() => sample.value?.mem.usagePct ?? null)
const memSpark = computed(() => history.value.map((s) => s.mem.usagePct))
const memStats = computed(() => stats(memSpark.value))
const memVariant = computed(() => pctVariant(memNow.value))

// 网络 KPI:分别取 rx/tx 当前值 + 峰值,总速率作为 sparkline 主线
const netRxNow = computed(() => {
  const s = sample.value
  if (!s) return null
  return s.net.reduce((a, n) => a + (n.rxRate ?? 0), 0)
})
const netTxNow = computed(() => {
  const s = sample.value
  if (!s) return null
  return s.net.reduce((a, n) => a + (n.txRate ?? 0), 0)
})
const netSumSpark = computed(() =>
  history.value.map((s) => s.net.reduce((a, n) => a + (n.rxRate ?? 0) + (n.txRate ?? 0), 0)),
)
const netPeak = computed(() => stats(netSumSpark.value).peak)

// 负载 KPI
const loadNow = computed(() => sample.value?.load.load1 ?? null)
const loadSpark = computed(() => history.value.map((s) => s.load.load1))
const loadStats = computed(() => stats(loadSpark.value))
const loadVariantVal = computed(() => loadVariant(loadNow.value, sys.value?.cpuCores ?? null))

// 变体 → 颜色 CSS 变量(用于 Sparkline 与外框氛围色)
const variantColor: Record<'success' | 'warning' | 'destructive' | 'muted' | 'primary', string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  destructive: 'var(--color-destructive)',
  primary: 'var(--color-primary)',
  muted: 'var(--color-muted-foreground)',
}

// 磁盘阈值染色
function diskTextClass(pct: number) {
  if (pct >= 90) return 'text-destructive'
  if (pct >= 70) return 'text-warning'
  return 'text-foreground'
}
function diskBarColor(pct: number) {
  if (pct >= 90) return 'var(--color-destructive)'
  if (pct >= 70) return 'var(--color-warning)'
  return 'var(--color-primary)'
}
</script>

<template>
  <Dialog v-model:open="monitorDialogOpen">
    <DialogContent class="max-w-5xl w-[92vw] max-h-[88vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Monitor class="size-4" />
          <span>服务器监控</span>
          <span
            v-if="sys"
            class="text-body ml-1 rounded border border-border/60 bg-panel-2 px-1.5 py-0.5 font-mono font-normal text-muted-foreground"
          >
            {{ sys.hostname }}
          </span>
        </DialogTitle>
        <DialogDescription>实时资源使用情况(每 2 秒采样)</DialogDescription>
      </DialogHeader>

      <div v-if="!sample" class="text-body py-12 text-center text-muted-foreground">
        当前无活跃连接,请先打开一个 SSH 会话。
      </div>

      <div v-else class="space-y-3">
        <!-- ============ KPI 卡阵列 ============ -->
        <div class="grid grid-cols-4 gap-2">
          <!-- CPU -->
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption flex items-center gap-1.5 text-muted-foreground">
              <Cpu class="size-3.5" :style="{ color: variantColor[cpuVariant] }" />
              <span>CPU</span>
              <StatusDot :variant="cpuVariant" class="ml-auto" :pulse="cpuVariant !== 'success' && cpuVariant !== 'muted'" />
            </div>
            <div class="mt-1.5 text-2xl font-medium tabular-nums leading-none text-foreground">
              {{ cpuNow == null ? '--' : cpuNow.toFixed(1) + '%' }}
            </div>
            <div class="mt-2">
              <Sparkline
                :data="cpuSpark"
                :max="100"
                :height="28"
                :color="variantColor[cpuVariant]"
              />
            </div>
            <div class="text-caption mt-1.5 flex items-center justify-between tabular-nums text-muted-foreground">
              <span>均 {{ cpuStats.avg == null ? '--' : cpuStats.avg.toFixed(1) + '%' }}</span>
              <span>峰 {{ cpuStats.peak == null ? '--' : cpuStats.peak.toFixed(1) + '%' }}</span>
            </div>
          </Card>

          <!-- 内存 -->
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption flex items-center gap-1.5 text-muted-foreground">
              <MemoryStick class="size-3.5" :style="{ color: variantColor[memVariant] }" />
              <span>内存</span>
              <StatusDot :variant="memVariant" class="ml-auto" :pulse="memVariant !== 'success' && memVariant !== 'muted'" />
            </div>
            <div class="mt-1.5 text-2xl font-medium tabular-nums leading-none text-foreground">
              {{ memNow == null ? '--' : memNow.toFixed(1) + '%' }}
            </div>
            <div class="mt-2">
              <Sparkline
                :data="memSpark"
                :max="100"
                :height="28"
                :color="variantColor[memVariant]"
              />
            </div>
            <div class="text-caption mt-1.5 flex items-center justify-between tabular-nums text-muted-foreground">
              <span>{{ fmtKb(sample.mem.usedKb) }}</span>
              <span class="opacity-70">/ {{ fmtKb(sample.mem.totalKb) }}</span>
            </div>
          </Card>

          <!-- 网络 -->
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption flex items-center gap-1.5 text-muted-foreground">
              <Network class="size-3.5 text-primary" />
              <span>网络</span>
              <StatusDot variant="primary" class="ml-auto" />
            </div>
            <div class="mt-1.5 flex items-baseline gap-2 tabular-nums leading-none">
              <div class="flex items-baseline gap-0.5 text-foreground">
                <ArrowDown class="size-3 self-center text-primary" />
                <span class="text-md font-medium">{{ fmtBytes(netRxNow).split(' ')[0] }}</span>
                <span class="text-caption text-muted-foreground">{{ fmtBytes(netRxNow).split(' ')[1] }}</span>
              </div>
              <div class="flex items-baseline gap-0.5 text-foreground">
                <ArrowUp class="size-3 self-center text-success" />
                <span class="text-md font-medium">{{ fmtBytes(netTxNow).split(' ')[0] }}</span>
                <span class="text-caption text-muted-foreground">{{ fmtBytes(netTxNow).split(' ')[1] }}</span>
              </div>
            </div>
            <div class="mt-2">
              <Sparkline
                :data="netSumSpark"
                :height="28"
                :color="variantColor.primary"
              />
            </div>
            <div class="text-caption mt-1.5 flex items-center justify-between tabular-nums text-muted-foreground">
              <span>峰值 {{ fmtBytes(netPeak) }}</span>
              <span class="opacity-70">↓↑ 合计</span>
            </div>
          </Card>

          <!-- 负载 -->
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption flex items-center gap-1.5 text-muted-foreground">
              <Activity class="size-3.5" :style="{ color: variantColor[loadVariantVal] }" />
              <span>负载</span>
              <StatusDot :variant="loadVariantVal" class="ml-auto" :pulse="loadVariantVal === 'destructive'" />
            </div>
            <div class="mt-1.5 flex items-baseline gap-2 tabular-nums leading-none">
              <span class="text-2xl font-medium text-foreground">{{ loadNow == null ? '--' : loadNow.toFixed(2) }}</span>
              <span v-if="sys?.cpuCores" class="text-body text-muted-foreground/80">/ {{ sys.cpuCores }} 核</span>
            </div>
            <div class="mt-2">
              <Sparkline
                :data="loadSpark"
                :max="Math.max(sys?.cpuCores ?? 1, loadStats.peak ?? 1)"
                :height="28"
                :color="variantColor[loadVariantVal]"
              />
            </div>
            <div class="text-caption mt-1.5 flex items-center justify-between tabular-nums text-muted-foreground">
              <span>5m {{ sample.load.load5.toFixed(2) }}</span>
              <span>15m {{ sample.load.load15.toFixed(2) }}</span>
            </div>
          </Card>
        </div>

        <!-- ============ 详细趋势 2×2 网格 ============ -->
        <div class="grid grid-cols-2 gap-2">
          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-1 flex items-center gap-1.5 text-muted-foreground">
              <Cpu class="size-3.5 text-primary" />
              <span>CPU 使用率趋势</span>
            </div>
            <div ref="cpuEl" class="h-[150px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-1 flex items-center gap-1.5 text-muted-foreground">
              <MemoryStick class="size-3.5 text-primary" />
              <span>内存 / Swap 使用率</span>
            </div>
            <div ref="memEl" class="h-[150px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-1 flex items-center gap-1.5 text-muted-foreground">
              <Network class="size-3.5 text-primary" />
              <span>网络吞吐</span>
            </div>
            <div ref="netEl" class="h-[150px]" />
          </Card>

          <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
            <div class="text-caption mb-1 flex items-center gap-1.5 text-muted-foreground">
              <Activity class="size-3.5 text-primary" />
              <span>系统负载</span>
            </div>
            <div ref="loadEl" class="h-[150px]" />
          </Card>
        </div>

        <!-- ============ 磁盘横条 ============ -->
        <Card class="gap-0 rounded-md border-border bg-panel p-3 shadow-none">
          <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
            <HardDrive class="size-3.5 text-primary" />
            <span>磁盘使用</span>
          </div>
          <div v-if="disk.length === 0" class="text-body py-2 text-center text-muted-foreground">
            无块设备信息
          </div>
          <div v-else class="space-y-1.5">
            <!--
              一行内塞 6 段:文件系统 · 挂载点 · 已用 · 总量 · 使用率 · 横条
              minmax(0,...) 允许 fs / mount 收缩,避免长挂载点撑破布局
            -->
            <div
              v-for="d in disk"
              :key="d.fs + d.mount"
              class="text-body grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_5rem_3.75rem_minmax(6rem,2fr)] items-center gap-x-3 gap-y-0.5"
            >
              <span class="truncate font-mono">{{ d.fs }}</span>
              <span class="truncate font-mono text-muted-foreground">{{ d.mount }}</span>
              <span class="text-right font-mono tabular-nums text-muted-foreground">{{ fmtKb(d.usedKb) }}</span>
              <span class="text-right font-mono tabular-nums text-muted-foreground/70">/ {{ fmtKb(d.totalKb) }}</span>
              <span class="text-right font-mono tabular-nums font-medium" :class="diskTextClass(d.capacityPct)">
                {{ d.capacityPct }}%
              </span>
              <Progress
                :model-value="d.capacityPct"
                class="h-1.5 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
                :style="{ '--bar-color': diskBarColor(d.capacityPct) }"
              />
            </div>
          </div>
        </Card>

        <!--
          系统信息压到底部 caption 条,不再抢占顶部空间。
          点分隔的紧凑一行,配合 flex-wrap 让窄屏也不折得难看
        -->
        <div
          v-if="sys"
          class="text-caption flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-muted-foreground"
        >
          <span class="inline-flex items-center gap-1">
            <span class="opacity-70">系统</span>
            <span class="font-mono text-foreground">{{ sys.kernelName }} {{ sys.kernelRelease }}</span>
          </span>
          <span class="opacity-30">·</span>
          <span class="inline-flex items-center gap-1">
            <span class="opacity-70">架构</span>
            <span class="font-mono text-foreground">{{ sys.arch }}</span>
          </span>
          <span class="opacity-30">·</span>
          <span class="inline-flex items-center gap-1">
            <span class="opacity-70">核心</span>
            <span class="font-mono tabular-nums text-foreground">{{ sys.cpuCores }}</span>
          </span>
          <span class="opacity-30">·</span>
          <span class="inline-flex items-center gap-1">
            <span class="opacity-70">运行</span>
            <span class="font-mono tabular-nums text-foreground">{{ uptimeStr(sys.uptimeSecs) }}</span>
          </span>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
