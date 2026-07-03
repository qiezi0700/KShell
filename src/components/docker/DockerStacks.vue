<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { Search, Layers, Play, Square, RotateCw, AlertCircle, Upload, X, FileText } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerStack } from '@/api/docker'

const props = defineProps<{
  stacks: DockerStack[]
  loading: boolean
  error: string | null
  available: boolean
  /** 正在执行的 stack 名集合(up/down/restart/deploy) */
  busy: Set<string>
}>()

const emit = defineEmits<{
  (e: 'up', s: DockerStack): void
  (e: 'down', s: DockerStack): void
  (e: 'restart', s: DockerStack): void
  (e: 'deploy', path: string): void
  (e: 'retry'): void
}>()

const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.stacks
  return props.stacks.filter((s) => s.name.toLowerCase().includes(kw))
})

// 部署新 stack 的路径输入行(与镜像面板的拉取交互一致)
const deployOpen = ref(false)
const deployPath = ref('')
const deployInputEl = ref<InstanceType<typeof Input> | null>(null)

async function openDeploy() {
  deployOpen.value = true
  await nextTick()
  const el = (deployInputEl.value as unknown as { $el?: HTMLInputElement })?.$el
  el?.focus?.()
}
function cancelDeploy() {
  deployOpen.value = false
  deployPath.value = ''
}
function submitDeploy() {
  const p = deployPath.value.trim()
  if (!p) return
  emit('deploy', p)
  deployPath.value = ''
}

/** running(2) → 绿色;exited(...) → 灰色;其余 → 黄色 */
function statusColor(status: string): string {
  const s = status.toLowerCase()
  if (s.startsWith('running')) return 'text-success'
  if (s.startsWith('exited')) return 'text-muted-foreground'
  return 'text-warning'
}

function isRunning(status: string): boolean {
  return status.toLowerCase().startsWith('running')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部工具栏 -->
    <div class="shrink-0 space-y-1.5 border-b border-border/50 px-3 py-2">
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1.5">
          <Layers class="size-4 text-primary" />
          <span class="text-title">Compose</span>
        </div>
        <div class="relative flex-1 max-w-xs">
          <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="keyword" placeholder="筛选 stack 名" class="h-7 pl-7 text-body" />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2" @click="openDeploy">
              <Upload class="size-3.5" />
              <span class="text-body">部署</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>用 compose 文件部署新 stack</TooltipContent>
        </Tooltip>
      </div>
      <div v-if="deployOpen" class="flex items-center gap-1.5">
        <div class="relative flex-1">
          <FileText class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref="deployInputEl"
            v-model="deployPath"
            placeholder="远端 compose 文件绝对路径,如 /root/myapp/docker-compose.yml"
            class="h-7 pl-7 text-body"
            @keydown.enter="submitDeploy"
            @keydown.esc="cancelDeploy"
          />
        </div>
        <Button variant="default" size="sm" class="h-7 px-2 text-body" :disabled="!deployPath.trim()" @click="submitDeploy">
          up -d
        </Button>
        <Button variant="ghost" size="icon-sm" @click="cancelDeploy">
          <X class="size-3.5" />
        </Button>
      </div>
    </div>

    <!-- 列表表头 -->
    <div
      v-if="filtered.length"
      class="grid grid-cols-[1.75rem_2fr_1fr_auto] items-center gap-3 px-3 py-1.5 text-caption text-muted-foreground border-b border-border/30"
    >
      <span />
      <span>stack</span>
      <span>配置文件</span>
      <span class="text-right">操作</span>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="error && stacks.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle class="size-8 text-warning" />
        <span class="text-body">{{ error }}</span>
        <Button variant="outline" size="sm" @click="emit('retry')">重试</Button>
      </div>
      <div v-else-if="loading && stacks.length === 0" class="py-12 text-center text-muted-foreground">加载中…</div>
      <div v-else-if="stacks.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Layers class="size-8" />
        <span class="text-body">没有 Compose stack(或远端未安装 docker compose)</span>
        <Button variant="outline" size="sm" @click="openDeploy">
          <Upload class="size-3.5" />
          部署新 stack
        </Button>
      </div>
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">没有匹配的 stack</div>
      <div v-else class="space-y-1.5">
        <div
          v-for="s in filtered"
          :key="s.name"
          class="group grid grid-cols-[1.75rem_2fr_1fr_auto] items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2 transition-all hover:border-primary/30 hover:bg-card/60 hover:ring-1 hover:ring-primary/10"
        >
          <div class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Layers class="size-3.5" />
          </div>

          <div class="flex min-w-0 flex-col">
            <div class="flex items-center gap-2">
              <span class="text-body truncate font-medium">{{ s.name }}</span>
              <Badge variant="outline" class="border-current/20 bg-current/10 text-caption" :class="statusColor(s.status)">{{ s.status }}</Badge>
            </div>
          </div>

          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-caption text-muted-foreground" :title="s.configFiles">{{ s.configFiles }}</span>
          </div>

          <div class="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-if="!isRunning(s.status)"
                  variant="ghost"
                  size="icon-sm"
                  :disabled="busy.has(s.name)"
                  @click.stop="emit('up', s)"
                >
                  <Play class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>up -d</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="busy.has(s.name)"
                  @click.stop="emit('restart', s)"
                >
                  <RotateCw class="size-3.5" :class="busy.has(s.name) && 'animate-spin'" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>restart</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-if="isRunning(s.status)"
                  variant="ghost"
                  size="icon-sm"
                  class="hover:bg-destructive/20 hover:text-destructive"
                  :disabled="busy.has(s.name)"
                  @click.stop="emit('down', s)"
                >
                  <Square class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>down(停止并删除 stack 内所有容器)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
