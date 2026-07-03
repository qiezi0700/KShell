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
    <!-- 顶部工具栏 -->
    <div class="shrink-0 flex items-center gap-2 border-b border-border/50 px-3 py-2">
      <div class="flex items-center gap-1.5">
        <HardDrive class="size-4 text-primary" />
        <span class="text-title">卷</span>
      </div>
      <div class="relative flex-1 max-w-xs">
        <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" placeholder="筛选卷名 / 驱动" size="sm" class="pl-7" />
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="outline" size="sm" @click="emit('prune')">
            <Trash2 class="size-3.5" />
            <span>清理未使用</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>删除无容器引用的卷</TooltipContent>
      </Tooltip>
    </div>

    <!-- 列表表头 -->
    <div
      v-if="filtered.length"
      class="grid grid-cols-[1.75rem_2fr_1fr_auto] items-center gap-3 px-3 py-1.5 text-caption text-muted-foreground border-b border-border/30"
    >
      <span />
      <span>名称</span>
      <span>元数据</span>
      <span class="text-right">操作</span>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="error && volumes.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <AlertCircle class="size-8 text-warning" />
        <span class="text-body">{{ error }}</span>
        <Button variant="outline" size="sm" @click="emit('retry')">重试</Button>
      </div>
      <div v-else-if="loading && volumes.length === 0" class="py-12 text-center text-muted-foreground">加载中…</div>
      <div v-else-if="volumes.length === 0" class="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <HardDrive class="size-8" />
        <span class="text-body">没有卷</span>
      </div>
      <div v-else-if="filtered.length === 0" class="py-12 text-center text-muted-foreground">没有匹配的卷</div>
      <div v-else class="space-y-1.5">
        <div
          v-for="v in filtered"
          :key="v.name"
          class="group grid grid-cols-[1.75rem_2fr_1fr_auto] items-center gap-3 rounded-lg border border-border/50 bg-card/30 px-3 py-2 transition-all hover:border-primary/30 hover:bg-card/60 hover:ring-1 hover:ring-primary/10"
        >
          <div class="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <HardDrive class="size-3.5" />
          </div>

          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-body font-medium text-foreground">{{ v.name }}</span>
            <span class="truncate font-mono text-caption text-muted-foreground" :title="v.mountpoint">{{ v.mountpoint }}</span>
          </div>

          <div class="flex min-w-0 flex-col">
            <span class="truncate font-mono text-caption text-muted-foreground">{{ v.driver }} · {{ v.scope }}</span>
          </div>

          <div class="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
