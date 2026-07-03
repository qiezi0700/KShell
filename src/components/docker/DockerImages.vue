<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Package, Trash2, AlertCircle, Download, RefreshCw, Info, KeyRound, Box } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerContainer, DockerImage } from '@/api/docker'

const props = defineProps<{
  images: DockerImage[]
  loading: boolean
  error: string | null
  /** 是否已成功采集过(决定错误文案是「不可用」还是临时报错) */
  available: boolean
  /** 正在拉取的镜像引用集合,用于给对应行显示 spin;新拉取共用 '__new__' key */
  pulling: Set<string>
  /** 当前所有容器,用于统计哪些容器使用了该镜像(按 image 字段 / digest 匹配) */
  containers: DockerContainer[]
}>()

const emit = defineEmits<{
  (e: 'remove', img: DockerImage): void
  (e: 'retry'): void
  /** 拉取新镜像;ref 形如 nginx:latest 或 registry/repo:tag */
  (e: 'pull', ref: string): void
  /** 更新(重新拉取)已存在的镜像 */
  (e: 'update', img: DockerImage): void
  /** 查看镜像详情 + 构建层 */
  (e: 'inspect', img: DockerImage): void
  /** 打开私有 Registry 登录弹窗 */
  (e: 'registry'): void
  /** 在抽屉中点击了某个使用该镜像的容器,父组件可跳转到容器日志/详情 */
  (e: 'containerClick', c: DockerContainer): void
}>()

const keyword = ref('')
const pullRef = ref('')

function submitPull() {
  const ref = pullRef.value.trim()
  if (!ref) return
  emit('pull', ref)
  pullRef.value = ''
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.images
  return props.images.filter(
    (img) => (img.repository + ':' + img.tag).toLowerCase().includes(kw),
  )
})

/** docker image ID 形如 sha256:abcd…,取 hash 前 12 位更简洁 */
function shortId(id: string): string {
  const hash = id.startsWith('sha256:') ? id.slice(7) : id
  return hash.slice(0, 12)
}

function imageRef(img: DockerImage): string {
  return `${img.repository}:${img.tag}`
}

/** 判断容器 image 是否指向该镜像;docker ps 的 Image 可能是名字:tag,也可能为 digest */
function containerUsesImage(c: DockerContainer, img: DockerImage): boolean {
  const imgName = c.image.trim()
  if (!imgName) return false
  if (imgName === imageRef(img)) return true
  if (imgName.startsWith('sha256:')) {
    return imgName === img.id || imgName.slice(7) === img.id
  }
  const short = shortId(img.id)
  if (imgName === short) return true
  if (img.tag === '<none>' && img.repository !== '<none>' && imgName.startsWith(img.repository + '@')) return true
  return false
}

const usageMap = computed(() => {
  const map = new Map<string, DockerContainer[]>()
  for (const img of props.images) {
    map.set(
      img.id,
      props.containers.filter((c) => containerUsesImage(c, img)),
    )
  }
  return map
})

const selectedImage = ref<DockerImage | null>(null)
const selectedUsage = computed(() =>
  selectedImage.value ? usageMap.value.get(selectedImage.value.id) ?? [] : [],
)

function openUsage(img: DockerImage) {
  selectedImage.value = img
}

function stateColor(s: string): string {
  if (s === 'running') return 'text-success'
  if (s === 'exited' || s === 'dead') return 'text-muted-foreground'
  return 'text-warning'
}

function stateStripClass(s: string): string {
  if (s === 'running') return 'bg-success'
  if (s === 'exited' || s === 'dead') return 'bg-muted-foreground/30'
  return 'bg-warning'
}

function stateBadgeClass(s: string): string {
  if (s === 'running') return 'border-success/30 bg-success/10 text-success'
  if (s === 'exited' || s === 'dead') return 'border-border bg-muted/40 text-muted-foreground'
  return 'border-warning/30 bg-warning/10 text-warning'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部工具栏 -->
    <div class="shrink-0 space-y-1.5 border-b border-border/50 px-3 py-2">
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1.5">
          <Package class="size-4 text-primary" />
          <span class="text-title">镜像</span>
        </div>
        <div class="relative flex-1 max-w-xs">
          <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="keyword" placeholder="筛选镜像名:标签" size="sm" class="pl-7" />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="sm" @click="emit('registry')">
              <KeyRound class="size-3.5" />
              <span>私有库</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>登录私有 Registry</TooltipContent>
        </Tooltip>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="relative flex-1">
          <Download class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="pullRef"
            placeholder="拉取镜像:输入引用后回车,如 nginx:latest 或 registry/repo:tag"
            size="sm" class="pl-7"
            @keydown.enter="submitPull"
          />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="default"
              size="sm"
              :disabled="!pullRef.trim()"
              @click="submitPull"
            >
              <Download class="size-3.5" />
              <span>拉取</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>拉取镜像(docker pull)</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- 列表区:表头 sticky 在滚动区顶部,与卡片共享同一滚动容器 -->
    <div class="flex-1 overflow-y-auto">
      <!-- 不可用 / 出错且无数据 -->
      <div
        v-if="error && images.length === 0"
        class="flex flex-col items-center gap-2 py-12 text-muted-foreground"
      >
        <AlertCircle class="size-8 text-warning" />
        <span class="text-body">{{ error }}</span>
        <Button variant="outline" size="sm" @click="emit('retry')">重试</Button>
      </div>

      <!-- 加载中且无数据 -->
      <div v-else-if="loading && images.length === 0" class="py-12 text-center text-muted-foreground">
        加载中…
      </div>

      <!-- 空列表 -->
      <div v-else-if="images.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Package class="size-8" />
        <span class="text-body">没有本地镜像,可在上方输入引用后回车拉取</span>
      </div>

      <!-- 过滤后为空 -->
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">
        没有匹配的镜像
      </div>

      <template v-else>
        <!-- 列表表头 -->
        <div
          class="sticky top-0 z-10 grid grid-cols-[1.75rem_minmax(0,2fr)_minmax(0,1fr)_5rem_5rem] items-center gap-3 border-x border-transparent bg-card px-3 py-1.5 text-caption text-muted-foreground border-b border-border/30"
        >
          <span />
          <span>镜像</span>
          <span>标识 / 大小</span>
          <span>使用</span>
          <span>操作</span>
        </div>

        <!-- 镜像卡片列表 -->
        <div class="space-y-1.5 py-2">
        <div
          v-for="img in filtered"
          :key="img.id"
          class="group relative grid grid-cols-[1.75rem_minmax(0,2fr)_minmax(0,1fr)_5rem_5rem] items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2 transition-all hover:border-primary/30 hover:bg-card/60 hover:ring-1 hover:ring-primary/10"
        >
          <!-- 图标块 -->
          <div class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Package class="size-3.5" />
          </div>

          <!-- 镜像名 -->
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-body font-medium text-foreground">
              {{ img.repository }}:{{ img.tag }}
            </span>
          </div>

          <!-- ID / 大小 -->
          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-caption text-muted-foreground">{{ shortId(img.id) }}</span>
            <span class="truncate font-mono text-caption text-muted-foreground">{{ img.size }}</span>
          </div>

          <!-- 使用计数 -->
          <div class="flex justify-start">
            <button
              v-if="usageMap.get(img.id)?.length"
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-caption text-success transition-colors hover:bg-success/20"
              @click.stop="openUsage(img)"
            >
              <Box class="size-3" />
              <span class="tabular-nums">{{ usageMap.get(img.id)?.length }}</span>
            </button>
            <span v-else class="text-caption text-muted-foreground">—</span>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('inspect', img)">
                  <Info class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>详情(inspect + 构建层)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="pulling.has(imageRef(img))"
                  @click.stop="emit('update', img)"
                >
                  <RefreshCw class="size-3.5" :class="pulling.has(imageRef(img)) && 'animate-spin'" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>更新镜像</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" class="hover:bg-destructive/20 hover:text-destructive" @click.stop="emit('remove', img)">
                  <Trash2 class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除镜像</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      </template>
    </div>

    <!-- 镜像使用详情弹窗 -->
    <Dialog :open="selectedImage !== null" @update:open="(v) => { if (!v) selectedImage = null }">
      <DialogContent v-if="selectedImage" class="max-w-lg w-[92vw] overflow-hidden">
        <DialogHeader>
          <DialogTitle class="flex min-w-0 items-center gap-2 pr-8 text-base text-foreground">
            <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Package class="size-4" />
            </div>
            <span class="truncate font-mono" :title="`${selectedImage.repository}:${selectedImage.tag}`">{{ selectedImage.repository }}:{{ selectedImage.tag }}</span>
          </DialogTitle>
          <div class="mt-1 flex items-center gap-2 pr-8 font-mono text-xs text-muted-foreground">
            <span>{{ shortId(selectedImage.id) }}</span>
            <span class="text-border">|</span>
            <span>{{ selectedImage.size }}</span>
          </div>
          <DialogDescription class="sr-only">镜像使用详情</DialogDescription>
        </DialogHeader>

        <div class="relative max-h-[60vh] overflow-y-auto px-1 py-2">
          <!-- 扫描线纹理背景,用前景色低透明度绘制,随主题自动切换 -->
          <div
            class="pointer-events-none absolute inset-0 opacity-[0.03]"
            style="background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(var(--foreground)) 2px, hsl(var(--foreground)) 4px);"
          />

          <section class="relative mb-5">
            <div class="mb-3 flex items-end justify-between border-b border-border pb-2">
              <h4 class="flex items-center gap-2 text-caption text-muted-foreground">
                <Box class="size-3.5 text-success" />
                容器引用
              </h4>
              <div
                class="font-mono text-3xl font-bold leading-none"
                :class="selectedUsage.length ? 'text-success' : 'text-muted-foreground'"
              >
                {{ selectedUsage.length.toString().padStart(2, '0') }}
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div class="rounded-lg border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-success">
                  {{ selectedUsage.filter((c) => c.state === 'running').length }}
                </div>
                <div class="text-caption text-muted-foreground">运行</div>
              </div>
              <div class="rounded-lg border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-destructive">
                  {{ selectedUsage.filter((c) => c.state === 'exited' || c.state === 'dead').length }}
                </div>
                <div class="text-caption text-muted-foreground">停止</div>
              </div>
              <div class="rounded-lg border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-warning">
                  {{ selectedUsage.filter((c) => c.state !== 'running' && c.state !== 'exited' && c.state !== 'dead').length }}
                </div>
                <div class="text-caption text-muted-foreground">其它</div>
              </div>
            </div>
          </section>

          <section class="relative">
            <h4 class="mb-3 flex items-center gap-2 text-caption text-muted-foreground">
              <span class="size-1.5 rounded-full bg-primary" />
              引用实例
            </h4>

            <div v-if="!selectedUsage.length" class="rounded-lg border border-dashed border-border bg-muted/30 py-8 text-center text-body text-muted-foreground">
              没有容器引用该镜像
            </div>

            <div v-else class="space-y-2">
              <button
                v-for="c in selectedUsage"
                :key="c.id"
                type="button"
                class="group/container relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-primary/30 hover:bg-muted/60 hover:ring-1 hover:ring-primary/10 active:translate-y-0"
                @click="emit('containerClick', c)"
              >
                <div
                  class="absolute left-0 top-0 bottom-0 w-1 rounded-r-full"
                  :class="stateStripClass(c.state)"
                  :style="c.state === 'running' ? { boxShadow: '0 0 8px hsl(var(--success) / 55%)' } : undefined"
                />

                <div class="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border"
                >
                  <Box class="size-3.5" :class="c.state === 'running' ? 'text-success' : 'text-muted-foreground'" />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="truncate font-mono text-sm font-semibold text-foreground">
                    {{ c.name }}
                  </div>
                  <div class="mt-0.5 truncate font-mono text-caption text-muted-foreground">
                    {{ c.ports || 'no ports' }}
                  </div>
                </div>

                <div class="flex shrink-0 flex-col items-end gap-1"
                >
                  <Badge variant="outline" class="text-[10px] font-bold uppercase tracking-wide" :class="stateBadgeClass(c.state)">
                    {{ c.state }}
                  </Badge>
                  <span class="text-caption text-muted-foreground/70">查看日志 →</span>
                </div>
              </button>
            </div>
          </section>

          <div class="mt-5 rounded-lg border border-border bg-muted/40 p-3">
            <div class="mb-1 text-caption text-muted-foreground">IMAGE ID</div>
            <div class="break-all font-mono text-xs text-primary">{{ selectedImage.id }}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
