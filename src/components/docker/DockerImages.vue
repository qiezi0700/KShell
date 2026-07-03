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
// 拉取输入常驻:一次拉取后立即清空,便于连拉多个
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
  // 名字完全匹配(含 registry/repo:tag)
  if (imgName === imageRef(img)) return true
  // 容器用的是 digest,看 digest 是否与镜像 id 匹配
  if (imgName.startsWith('sha256:')) {
    return imgName === img.id || imgName.slice(7) === img.id
  }
  // 镜像 ID 短 ID 匹配(12 位)——docker ps 在名字丢失时有时会显示短 id
  const short = shortId(img.id)
  if (imgName === short) return true
  // 镜像 tag 为 <none> 但仓库名匹配时也算(同一仓库不同 digest)
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

// 当前选中的镜像,用于打开使用详情抽屉
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
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部工具栏:搜索(第一行) + 拉取输入(第二行,常驻) -->
    <div class="shrink-0 space-y-1.5 px-2 pt-2">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="筛选镜像名:标签" class="h-7 pl-7 text-body" />
      </div>
      <div class="flex items-center gap-1.5">
        <div class="relative flex-1">
          <Download class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="pullRef"
            placeholder="拉取镜像:输入引用后回车,如 nginx:latest 或 registry/repo:tag"
            class="h-7 pl-7 text-body"
            @keydown.enter="submitPull"
          />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="default"
              size="sm"
              class="h-7 gap-1.5 px-2"
              :disabled="!pullRef.trim()"
              @click="submitPull"
            >
              <Download class="size-3.5" />
              <span class="text-body">拉取</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>拉取镜像(docker pull)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2" @click="emit('registry')">
              <KeyRound class="size-3.5" />
              <span class="text-body">私有库</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>登录私有 Registry</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
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

      <!-- 空列表:提示直接在上方拉取即可 -->
      <div v-else-if="images.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <Package class="size-8" />
        <span class="text-body">没有本地镜像,可在上方输入引用后回车拉取</span>
      </div>

      <!-- 过滤后为空 -->
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">
        没有匹配的镜像
      </div>

      <!-- 镜像卡片列表 -->
      <div v-else class="space-y-1">
        <div
          v-for="img in filtered"
          :key="img.id"
          class="group flex w-full items-center gap-3 rounded-md border border-border/40 px-3 py-2 transition-colors hover:bg-muted/40"
        >
          <Package class="size-3.5 shrink-0 text-muted-foreground" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-body truncate font-mono font-medium">{{ img.repository }}:{{ img.tag }}</span>
            <div class="text-caption truncate font-mono text-muted-foreground">
              {{ img.size }} · {{ shortId(img.id) }}
              <button
                v-if="usageMap.get(img.id)?.length"
                type="button"
                class="ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-caption hover:bg-muted/60 hover:text-foreground"
                @click.stop="openUsage(img)"
              >
                · 被
                <Badge variant="secondary" class="h-4 px-1 text-caption font-mono">
                  {{ usageMap.get(img.id)?.length }}
                </Badge>
                个容器使用
              </button>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('inspect', img)">
                  <Info class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>详情(inspect + 构建层)</TooltipContent>
            </Tooltip>
            <Tooltip v-if="usageMap.get(img.id)?.length">
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop>
                  <Box class="size-3.5 text-success" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div class="max-w-xs space-y-1 text-caption">
                  <div class="font-medium">被 {{ usageMap.get(img.id)?.length }} 个容器使用:</div>
                  <div
                    v-for="c in usageMap.get(img.id)"
                    :key="c.id"
                    class="truncate font-mono"
                  >
                    {{ c.name }}
                  </div>
                </div>
              </TooltipContent>
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
    </div>
    <Dialog :open="selectedImage !== null" @update:open="(v) => { if (!v) selectedImage = null }">
      <DialogContent v-if="selectedImage" class="max-w-lg w-[92vw]">
        <DialogHeader>
          <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            <span class="size-1.5 animate-pulse rounded-full bg-primary" />
            IMAGE INSPECTOR
          </div>
          <DialogTitle class="mt-1 flex items-center gap-2 text-base text-foreground">
            <Package class="size-5 text-primary" />
            <span class="truncate font-mono">{{ selectedImage.repository }}</span>
          </DialogTitle>
          <div class="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span class="rounded bg-muted px-1.5 py-0.5 text-warning">:{{ selectedImage.tag }}</span>
            <span class="text-border">|</span>
            <span>{{ shortId(selectedImage.id) }}</span>
            <span class="text-border">|</span>
            <span>{{ selectedImage.size }}</span>
          </div>
          <DialogDescription class="sr-only">镜像使用详情</DialogDescription>
        </DialogHeader>

        <div class="relative max-h-[60vh] overflow-y-auto px-1 py-2">
          <!-- 扫描线纹理背景 -->
          <div class="pointer-events-none absolute inset-0 opacity-[0.03]" style="background-image: repeating-linear-gradient(0deg, transparent, transparent 2px, hsl(var(--foreground)) 2px, hsl(var(--foreground)) 4px);" />

          <!-- 使用统计仪表 -->
          <section class="relative mb-6">
            <div class="mb-3 flex items-end justify-between border-b border-border pb-2">
              <h4 class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Box class="size-3.5 text-success" />
                容器引用
              </h4>
              <div class="font-mono text-2xl font-bold leading-none" :class="selectedUsage.length ? 'text-success' : 'text-muted-foreground'">
                {{ selectedUsage.length.toString().padStart(2, '0') }}
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <div class="rounded border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-success">
                  {{ selectedUsage.filter((c) => c.state === 'running').length }}
                </div>
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground">运行</div>
              </div>
              <div class="rounded border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-destructive">
                  {{ selectedUsage.filter((c) => c.state === 'exited' || c.state === 'dead').length }}
                </div>
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground">停止</div>
              </div>
              <div class="rounded border border-border bg-muted/40 p-2 text-center">
                <div class="font-mono text-lg font-bold text-warning">
                  {{ selectedUsage.filter((c) => c.state !== 'running' && c.state !== 'exited' && c.state !== 'dead').length }}
                </div>
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground">其它</div>
              </div>
            </div>
          </section>

          <!-- 容器列表 -->
          <section class="relative">
            <h4 class="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span class="size-1.5 rounded-full bg-primary" />
              引用实例
            </h4>

            <div v-if="!selectedUsage.length" class="rounded border border-dashed border-border bg-muted/30 py-8 text-center text-sm text-muted-foreground">
              NO ACTIVE REFERENCES
            </div>

            <div v-else class="space-y-2">
              <button
                v-for="c in selectedUsage"
                :key="c.id"
                type="button"
                class="group/container relative flex w-full items-center gap-3 overflow-hidden rounded border border-border bg-muted/40 px-3 py-2.5 text-left transition-all hover:-translate-y-px hover:border-primary/60 hover:bg-muted/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.1)] active:translate-y-0"
                @click="emit('containerClick', c)"
              >
                <!-- 左侧状态条 -->
                <div
                  class="absolute left-0 top-0 bottom-0 w-1"
                  :class="c.state === 'running' ? 'bg-success' : c.state === 'exited' || c.state === 'dead' ? 'bg-destructive' : 'bg-warning'"
                />

                <div class="relative flex size-7 shrink-0 items-center justify-center rounded bg-background ring-1 ring-border">
                  <Box class="size-3.5" :class="c.state === 'running' ? 'text-success' : 'text-muted-foreground'" />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="truncate font-mono text-sm font-semibold text-foreground">
                    {{ c.name }}
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {{ c.ports || 'no ports' }}
                  </div>
                </div>

                <div class="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    class="border-none px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide"
                    :class="c.state === 'running' ? 'bg-success/10 text-success' : c.state === 'exited' || c.state === 'dead' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'"
                  >
                    {{ c.state }}
                  </Badge>
                  <span class="text-[10px] text-muted-foreground/70">view logs →</span>
                </div>
              </button>
            </div>
          </section>

          <!-- 底部元数据 -->
          <div class="mt-6 rounded border border-border bg-muted/40 p-3">
            <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">IMAGE ID</div>
            <div class="font-mono text-xs text-primary">{{ selectedImage.id }}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
