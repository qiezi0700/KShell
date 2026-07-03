<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Play, Square, RotateCw, Trash2, Logs, AlertCircle, Info, SquareTerminal, PackageCheck, PlusCircle, SquarePen } from 'lucide-vue-next'
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
    <!-- 工具栏:搜索 + 新建按钮 -->
    <div class="shrink-0 flex items-center gap-1.5 px-2 pt-2">
      <div class="relative flex-1">
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
            <div class="flex items-center gap-2 text-caption text-muted-foreground">
              <span class="truncate font-mono">{{ c.image }}</span>
              <span v-if="c.ports" class="truncate font-mono" :title="c.ports">{{ c.ports }}</span>
              <span
                v-if="c.state === 'running' && stats[c.id]"
                class="ml-auto shrink-0 font-mono"
                :title="`网络 IO: ${stats[c.id].netIo}　块 IO: ${stats[c.id].blockIo}　PID: ${stats[c.id].pids}`"
              >
                CPU {{ stats[c.id].cpuPercent }} · Mem {{ stats[c.id].memPercent }}
              </span>
            </div>
          </div>
          <!-- 操作按钮 -->
          <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
              <TooltipContent>编辑(改名 / 资源限制)</TooltipContent>
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
