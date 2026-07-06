<script setup lang="ts">
import { computed } from 'vue'
import { Cpu, MemoryStick, Activity, AlertCircle } from '@lucide/vue'
import { Progress } from '@/components/ui/progress'
import Sparkline from '@/components/monitor/Sparkline.vue'
import {
  activeSample,
  activeHistory,
  activeMonitorSessionId,
  activeMonitorError,
} from '@/stores/monitor'

const sample = activeSample
const history = activeHistory
const error = activeMonitorError
const hasSession = computed(() => activeMonitorSessionId.value != null)

const cpuPct = computed(() => sample.value?.cpu.usagePct ?? null)
const memPct = computed(() => sample.value?.mem.usagePct ?? null)
const load1 = computed(() => sample.value?.load.load1 ?? null)
const cores = computed(() => sample.value?.sys?.cpuCores ?? null)

// sparkline 数据(只取最近 30 点,侧栏空间小,再多也看不清)
const cpuSpark = computed(() => history.value.slice(-30).map((s) => s.cpu.usagePct))
const memSpark = computed(() => history.value.slice(-30).map((s) => s.mem.usagePct))

function fmtPct(v: number | null) {
  return v == null ? '--' : v.toFixed(1) + '%'
}
function fmtLoad(v: number | null) {
  return v == null ? '--' : v.toFixed(2)
}

// 70% 起橙、90% 起红;与 MonitorDialog 一致
function pctColor(pct: number | null) {
  if (pct == null) return 'var(--color-muted-foreground)'
  if (pct >= 90) return 'var(--color-destructive)'
  if (pct >= 70) return 'var(--color-warning)'
  return 'var(--color-primary)'
}

// 负载相对核心数
function loadColor(load: number | null, c: number | null) {
  if (load == null || !c) return 'var(--color-muted-foreground)'
  const ratio = load / c
  if (ratio >= 1) return 'var(--color-destructive)'
  if (ratio >= 0.7) return 'var(--color-warning)'
  return 'var(--color-primary)'
}
</script>

<template>
  <div
    v-if="hasSession"
    class="shrink-0 border-t border-border bg-panel px-3 py-2.5"
  >
    <div v-if="error" class="text-body flex items-center gap-1.5 text-destructive">
      <AlertCircle class="size-3.5 shrink-0" />
      <span class="truncate">监控采集失败</span>
    </div>

    <template v-else-if="sample">
      <div class="text-caption mb-2 flex items-center gap-1.5 text-muted-foreground">
        <Activity class="size-3.5 shrink-0 text-success" />
        <span>实时监控</span>
      </div>

      <!--
        CPU 行:图标+名称 | sparkline (弹性宽) | 数字
        sparkline 占据中段空白,信息密度直接翻倍;数字仍在右侧对齐
      -->
      <div class="mb-2">
        <div class="text-body mb-1 flex items-center gap-2">
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <Cpu class="size-3.5" />CPU
          </span>
          <div class="min-w-0 flex-1">
            <Sparkline
              :data="cpuSpark"
              :max="100"
              :height="14"
              :color="pctColor(cpuPct)"
            />
          </div>
          <span class="tabular-nums text-foreground">{{ fmtPct(cpuPct) }}</span>
        </div>
        <Progress
          v-if="cpuPct != null"
          :model-value="cpuPct"
          class="h-1 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
          :style="{ '--bar-color': pctColor(cpuPct) }"
        />
      </div>

      <!-- 内存 -->
      <div class="mb-2">
        <div class="text-body mb-1 flex items-center gap-2">
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <MemoryStick class="size-3.5" />内存
          </span>
          <div class="min-w-0 flex-1">
            <Sparkline
              :data="memSpark"
              :max="100"
              :height="14"
              :color="pctColor(memPct)"
            />
          </div>
          <span class="tabular-nums text-foreground">{{ fmtPct(memPct) }}</span>
        </div>
        <Progress
          v-if="memPct != null"
          :model-value="memPct"
          class="h-1 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
          :style="{ '--bar-color': pctColor(memPct) }"
        />
      </div>

      <!-- 负载 -->
      <div class="text-body flex items-center justify-between">
        <span class="text-muted-foreground">负载</span>
        <span class="tabular-nums" :style="{ color: loadColor(load1, cores) }">
          {{ fmtLoad(load1) }}
          <span v-if="cores" class="text-muted-foreground/70">/{{ cores }}</span>
        </span>
      </div>
    </template>

    <div v-else class="text-body py-1 text-center text-muted-foreground">采集中…</div>
  </div>
</template>
