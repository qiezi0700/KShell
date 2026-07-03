<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Package, Trash2, AlertCircle, Download, RefreshCw, Info } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerImage } from '@/api/docker'

const props = defineProps<{
  images: DockerImage[]
  loading: boolean
  error: string | null
  /** 是否已成功采集过(决定错误文案是「不可用」还是临时报错) */
  available: boolean
  /** 正在拉取的镜像引用集合,用于给对应行显示 spin;新拉取共用 '__new__' key */
  pulling: Set<string>
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
  </div>
</template>
