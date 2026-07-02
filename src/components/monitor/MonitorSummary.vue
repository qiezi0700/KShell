<script setup lang="ts">
import { computed } from 'vue'
import { Cpu, MemoryStick, Activity, AlertCircle } from 'lucide-vue-next'
import { Progress } from '@/components/ui/progress'
import { activeSample, activeMonitorSessionId, activeMonitorError } from '@/stores/monitor'

const sample = activeSample
const error = activeMonitorError
const hasSession = computed(() => activeMonitorSessionId.value != null)

const cpuPct = computed(() => sample.value?.cpu.usagePct ?? null)
const memPct = computed(() => sample.value?.mem.usagePct ?? null)
const load1 = computed(() => sample.value?.load.load1 ?? null)
const cores = computed(() => sample.value?.sys?.cpuCores ?? null)

function fmtPct(v: number | null) {
  return v == null ? '--' : v.toFixed(1) + '%'
}
function fmtLoad(v: number | null) {
  return v == null ? '--' : v.toFixed(2)
}

// 进度条颜色阈值:70% 起橙、90% 起红
function barColor(pct: number) {
  if (pct >= 90) return 'var(--color-destructive)'
  if (pct >= 70) return 'var(--color-warning)'
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

      <!-- CPU -->
      <div class="mb-2">
        <div class="text-body mb-1 flex items-center justify-between">
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <Cpu class="size-3.5" />CPU
          </span>
          <span class="tabular-nums text-foreground">{{ fmtPct(cpuPct) }}</span>
        </div>
        <Progress
          v-if="cpuPct != null"
          :model-value="cpuPct"
          class="h-1 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
          :style="{ '--bar-color': barColor(cpuPct) }"
        />
      </div>

      <!-- 内存 -->
      <div class="mb-2">
        <div class="text-body mb-1 flex items-center justify-between">
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <MemoryStick class="size-3.5" />内存
          </span>
          <span class="tabular-nums text-foreground">{{ fmtPct(memPct) }}</span>
        </div>
        <Progress
          v-if="memPct != null"
          :model-value="memPct"
          class="h-1 bg-panel-2 [&_[data-slot=progress-indicator]]:bg-[var(--bar-color)]"
          :style="{ '--bar-color': barColor(memPct) }"
        />
      </div>

      <!-- 负载 -->
      <div class="text-body flex items-center justify-between">
        <span class="text-muted-foreground">负载</span>
        <span class="tabular-nums text-foreground">
          {{ fmtLoad(load1) }}
          <span v-if="cores" class="text-muted-foreground/70">/{{ cores }}</span>
        </span>
      </div>
    </template>

    <div v-else class="text-body py-1 text-center text-muted-foreground">采集中…</div>
  </div>
</template>
