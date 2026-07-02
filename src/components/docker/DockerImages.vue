<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Package, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerImage } from '@/api/docker'

const props = defineProps<{
  images: DockerImage[]
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'remove', img: DockerImage): void
}>()

const keyword = ref('')

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
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="images.length" class="shrink-0 px-2 pt-2">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="筛选镜像名:标签" class="h-7 pl-7 text-body" />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="loading && images.length === 0" class="py-12 text-center text-muted-foreground">
        加载中…
      </div>
      <div v-else-if="images.length === 0" class="py-12 text-center text-muted-foreground">
        没有本地镜像
      </div>
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">
        没有匹配的镜像
      </div>
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
