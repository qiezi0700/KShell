<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, HardDrive, Trash2, AlertCircle, Info } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import type { DockerVolume } from '@/api/docker'

const props = defineProps<{
  volumes: DockerVolume[]
  loading: boolean
  error: string | null
  available: boolean
}>()

const emit = defineEmits<{
  (e: 'remove', v: DockerVolume): void
  (e: 'inspect', v: DockerVolume): void
  (e: 'prune'): void
  (e: 'retry'): void
}>()

const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.volumes
  return props.volumes.filter((v) => v.name.toLowerCase().includes(kw) || v.driver.toLowerCase().includes(kw))
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="volumes.length" class="shrink-0 space-y-1.5 px-2 pt-2">
      <div class="flex items-center gap-1.5">
        <div class="relative flex-1">
          <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="keyword" placeholder="筛选卷名 / 驱动" class="h-7 pl-7 text-body" />
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2" @click="emit('prune')">
              <Trash2 class="size-3.5" />
              <span class="text-body">清理未使用</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除无容器引用的卷</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="error && volumes.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle class="size-8 text-warning" />
        <span class="text-body">{{ error }}</span>
        <Button variant="outline" size="sm" @click="emit('retry')">重试</Button>
      </div>
      <div v-else-if="loading && volumes.length === 0" class="py-12 text-center text-muted-foreground">加载中…</div>
      <div v-else-if="volumes.length === 0" class="py-12 text-center text-muted-foreground">没有卷</div>
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">没有匹配的卷</div>
      <div v-else class="space-y-1">
        <div
          v-for="v in filtered"
          :key="v.name"
          class="group flex w-full items-center gap-3 rounded-md border border-border/40 px-3 py-2 transition-colors hover:bg-muted/40"
        >
          <HardDrive class="size-3.5 shrink-0 text-muted-foreground" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-body truncate font-mono font-medium">{{ v.name }}</span>
            <div class="text-caption truncate font-mono text-muted-foreground">
              {{ v.driver }} · {{ v.scope }} · {{ v.mountpoint }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" @click.stop="emit('inspect', v)">
                  <Info class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>详情</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="ghost" size="icon-sm" class="hover:bg-destructive/20 hover:text-destructive" @click.stop="emit('remove', v)">
                  <Trash2 class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除卷</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
