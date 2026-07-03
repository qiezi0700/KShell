<script setup lang="ts">
import { computed } from 'vue'

/**
 * 轻量 SVG 迷你火花线。零依赖,自适应父容器宽度,
 * 用于监控 KPI 卡角落 / 状态栏行内等对性能敏感的位置。
 * 对性能敏感处不引 echarts —— 单卡多实例累计成本明显
 */
const props = withDefaults(
  defineProps<{
    data: (number | null | undefined)[]
    /** SVG 高度(px);宽度总是撑满父容器 */
    height?: number
    /** 折线与填充色(可用 CSS 变量,如 'var(--color-primary)') */
    color?: string
    /** 填充折线下方形成面积图 */
    fill?: boolean
    /** 固定 y 轴上限;不传则取数据最大值 */
    max?: number
    /** 固定 y 轴下限 */
    min?: number
  }>(),
  {
    height: 28,
    color: 'currentColor',
    fill: true,
    min: 0,
  },
)

// viewBox 用固定 100 宽度,配合 preserveAspectRatio=none 与 CSS width:100%,
// 让 SVG 在任何容器宽度下都能横向拉伸,而 vector-effect 保持描边不被拉细
const VIEW_W = 100

const path = computed(() => {
  const d = props.data.filter((v): v is number => v != null && Number.isFinite(v))
  if (d.length < 2) return { line: '', area: '' }
  const h = props.height
  const max = props.max ?? Math.max(1, ...d)
  const min = props.min
  const range = max - min || 1
  const stepX = VIEW_W / (d.length - 1)
  let line = ''
  d.forEach((v, i) => {
    const x = i * stepX
    const y = h - ((v - min) / range) * h
    line += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2) + ' '
  })
  const area = line + `L${VIEW_W},${h} L0,${h} Z`
  return { line: line.trim(), area }
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${100} ${height}`"
    preserveAspectRatio="none"
    :style="{ height: height + 'px' }"
    class="block w-full overflow-visible"
    aria-hidden="true"
  >
    <path
      v-if="fill && path.area"
      :d="path.area"
      :fill="color"
      fill-opacity="0.18"
    />
    <path
      v-if="path.line"
      :d="path.line"
      fill="none"
      :stroke="color"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
</template>
