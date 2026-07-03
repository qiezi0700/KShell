<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Play, Square, RotateCw, Trash2, Logs, AlertCircle, Info, SquareTerminal, PackageCheck, PlusCircle, Box, SquarePen } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerContainer, DockerStats } from '@/api/docker'

const props = defineProps<{
  containers: DockerContainer[]
  loading: boolean
  error: string | null
  /** 是否已成功采集过(决定错误文案是「不可用」还是临时报错) */
  available: boolean
  /** 容器资源占用,按容器短 ID 索引 */
  stats: Record<string, DockerStats>
  /** 正在重建的容器 ID 集合(pull + stop + rm + run 中),显示 spin 并禁用重复触发 */
  recreating: Set<string>
}>()

const emit = defineEmits<{
  (e: 'start', c: DockerContainer): void
  (e: 'stop', c: DockerContainer): void
  (e: 'restart', c: DockerContainer): void
  (e: 'remove', c: DockerContainer): void
  (e: 'logs', c: DockerContainer): void
  (e: 'inspect', c: DockerContainer): void
  (e: 'exec', c: DockerContainer): void
  /** 拉取最新镜像并重建同名容器,保留原配置 */
  (e: 'recreate', c: DockerContainer): void
  /** 打开编辑弹窗:改名 / 资源限制 / 重启策略 */
  (e: 'edit', c: DockerContainer): void
  /** 打开创建向导 */
  (e: 'create'): void
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
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部工具栏:标题 / 搜索 / 新建 -->
    <div class="shrink-0 flex items-center gap-2 border-b border-border/50 px-3 py-2">
      <div class="flex items-center gap-1.5">
        <Box class="size-4 text-primary" />
        <span class="text-title">容器</span>
      </div>
      <div class="relative flex-1 max-w-xs">
        <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="筛选容器名 / 镜像" class="h-7 pl-7 text-body" />
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2" @click="emit('create')">
            <PlusCircle class="size-3.5" />
            <span class="text-body">新建</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>用 docker run 创建一个新容器</TooltipContent>
      </Tooltip>
    </div>

    <!-- 列表表头:与每行 grid 列完全对齐,首列为状态条占位 -->
    <div
      v-if="filtered.length"
      class="grid grid-cols-[0.25rem_2fr_1.5fr_5rem_7rem_auto] items-center gap-3 px-3 py-1.5 text-caption text-muted-foreground border-b border-border/30"
    >
      <span />
      <span>容器</span>
      <span class="hidden lg:block">镜像</span>
      <span>状态</span>
      <span class="text-right">资源</span>
      <span class="text-right">操作</span>
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
      <div v-else-if="containers.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <span class="text-body">没有容器</span>
        <Button variant="outline" size="sm" @click="emit('create')">
          <PlusCircle class="size-3.5" />
          新建容器
        </Button>
      </div>

      <!-- 过滤后为空 -->
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">
        没有匹配的容器
      </div>

      <!-- 容器卡片列表 -->
      <div v-else class="space-y-1.5">
        <div
          v-for="c in filtered"
          :key="c.id"
          class="group relative grid grid-cols-[0.25rem_2fr_1.5fr_5rem_7rem_auto] items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2 transition-all hover:border-primary/30 hover:bg-card/60 hover:ring-1 hover:ring-primary/10"
        >
          <!-- 左侧状态条:running 时带辉光 -->
          <div class="relative h-full">
            <div
              class="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
              :class="c.state === 'running'
                ? 'bg-success'
                : c.state === 'exited' || c.state === 'dead'
                  ? 'bg-muted-foreground/30'
                  : 'bg-warning'"
              :style="c.state === 'running' ? { boxShadow: '0 0 8px hsl(var(--success) / 55%)' } : undefined"
            />
          </div>

          <!-- 容器名 + 端口 -->
          <div class="flex min-w-0 flex-col">
            <span class="text-body truncate font-medium">{{ c.name }}</span>
            <span
              class="truncate font-mono text-caption text-muted-foreground"
              :title="c.ports"
            >
              {{ c.ports || '无端口映射' }}
            </span>
          </div>

          <!-- 镜像 -->
          <div
            class="hidden min-w-0 truncate font-mono text-caption text-muted-foreground lg:block"
            :title="c.image"
          >
            {{ c.image }}
          </div>

          <!-- 状态 -->
          <div>
            <Badge
              variant="outline"
              class="border-current/20 bg-current/10 text-caption"
              :class="stateColor(c.state)"
            >
              {{ stateLabel(c.state) }}
            </Badge>
          </div>

          <!-- 资源 -->
          <div
            class="text-right font-mono text-caption"
            :class="c.state === 'running' ? 'text-success' : 'text-muted-foreground'"
            :title="c.state === 'running' && stats[c.id] ? `网络 IO: ${stats[c.id].netIo}　块 IO: ${stats[c.id].blockIo}　PID: ${stats[c.id].pids}` : undefined"
          >
            <template v-if="c.state === 'running' && stats[c.id]">
              {{ stats[c.id].cpuPercent }}<span class="text-muted-foreground">cpu</span>
              {{ stats[c.id].memPercent }}<span class="text-muted-foreground">mem</span>
            </template>
            <template v-else>—</template>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  v-if="c.state === 'running'"
                  variant="ghost"
                  size="icon-sm"
                  @click.stop="emit('exec', c)"
                >
                  <SquareTerminal class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>进入终端</TooltipContent>
            </Tooltip>
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="recreating.has(c.id)"
                  @click.stop="emit('recreate', c)"
                >
                  <PackageCheck class="size-3.5" :class="recreating.has(c.id) && 'animate-spin'" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>更新并重建(拉取最新镜像)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('edit', c)">
                  <SquarePen class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑(改名 / 资源限制 / 网络)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('inspect', c)">
                  <Info class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>详情</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('logs', c)">
                  <Logs class="size-3.5" />
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
