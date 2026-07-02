<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Play, Square, RotateCw, Trash2, ScrollText, Box, AlertCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerContainer } from '@/api/docker'

const props = defineProps<{
  containers: DockerContainer[]
  loading: boolean
  error: string | null
  /** 是否已成功采集过(决定错误文案是「不可用」还是临时报错) */
  available: boolean
}>()

const emit = defineEmits<{
  (e: 'start', c: DockerContainer): void
  (e: 'stop', c: DockerContainer): void
  (e: 'restart', c: DockerContainer): void
  (e: 'remove', c: DockerContainer): void
  (e: 'logs', c: DockerContainer): void
  (e: 'retry'): void
}>()

const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.containers
  return props.containers.filter(
    (c) => c.name.toLowerCase().includes(kw) || c.image.toLowerCase().includes(kw),
  )
})

function stateColor(s: string): string {
  if (s === 'running') return 'text-success'
  if (s === 'exited' || s === 'dead') return 'text-muted-foreground'
  return 'text-warning'
}

function stateLabel(s: string): string {
  const map: Record<string, string> = {
    running: '运行中',
    exited: '已停止',
    created: '已创建',
    paused: '已暂停',
    restarting: '重启中',
    dead: '已死',
  }
  return map[s] ?? s
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 搜索框(仅有数据时显示) -->
    <div v-if="containers.length" class="shrink-0 px-2 pt-2">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="筛选容器名 / 镜像" class="h-7 pl-7 text-body" />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <!-- 不可用 / 出错且无数据 -->
      <div
        v-if="error && containers.length === 0"
        class="flex flex-col items-center gap-2 py-12 text-muted-foreground"
      >
        <AlertCircle class="size-8 text-warning" />
        <span class="text-body">{{ error }}</span>
        <Button variant="outline" size="sm" @click="emit('retry')">重试</Button>
      </div>

      <!-- 加载中且无数据 -->
      <div v-else-if="loading && containers.length === 0" class="py-12 text-center text-muted-foreground">
        加载中…
      </div>

      <!-- 空列表 -->
      <div v-else-if="containers.length === 0" class="py-12 text-center text-muted-foreground">
        没有容器,使用 docker run 创建
      </div>

      <!-- 过滤后为空 -->
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">
        没有匹配的容器
      </div>

      <!-- 容器卡片列表 -->
      <div v-else class="space-y-1">
        <div
          v-for="c in filtered"
          :key="c.id"
          class="group flex w-full items-center gap-3 rounded-md border border-border/40 px-3 py-2 transition-colors hover:bg-muted/40"
        >
          <!-- 状态指示灯 -->
          <span
            class="size-2 shrink-0 rounded-full"
            :class="c.state === 'running' ? 'bg-success' : 'bg-muted-foreground/40'"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <span class="text-body truncate font-medium">{{ c.name }}</span>
              <Badge variant="outline" class="text-caption shrink-0" :class="stateColor(c.state)">{{ stateLabel(c.state) }}</Badge>
            </div>
            <div class="text-caption truncate text-muted-foreground">
              <span class="font-mono">{{ c.image }}</span>
              <span v-if="c.ports" class="ml-2">{{ c.ports }}</span>
            </div>
          </div>
          <!-- 操作按钮 -->
          <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button v-if="c.state !== 'running'" variant="ghost" size="icon-sm" @click.stop="emit('start', c)">
                  <Play class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>启动</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button v-if="c.state === 'running'" variant="ghost" size="icon-sm" @click.stop="emit('stop', c)">
                  <Square class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>停止</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('restart', c)">
                  <RotateCw class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>重启</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('logs', c)">
                  <ScrollText class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>日志</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" class="hover:bg-destructive/20 hover:text-destructive" @click.stop="emit('remove', c)">
                  <Trash2 class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
