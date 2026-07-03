<script setup lang="ts">
import { computed } from 'vue'
import { Info, Layers } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DockerImageInspect, DockerImageLayer } from '@/api/docker'

const props = defineProps<{
  open: boolean
  /** 标题里用的引用(如 nginx:latest 或短 ID),仅显示,不参与查询 */
  imageRef: string | null
  loading: boolean
  data: DockerImageInspect | null
  history: DockerImageLayer[]
}>()

defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

/** 字节转 KB/MB/GB;层历史里的 size 由 docker CLI 直接给了人读格式,只对镜像总大小用 */
function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** 层 createdBy 常常带 "/bin/sh -c #(nop)" 前缀,清理后更易读 */
function cleanCreatedBy(raw: string): string {
  return raw
    .replace(/^\/bin\/sh -c #\(nop\)\s*/, '')
    .replace(/^\/bin\/sh -c\s+/, 'RUN ')
    .trim()
}

const shortId = computed(() => {
  const id = props.data?.id ?? ''
  const hash = id.startsWith('sha256:') ? id.slice(7) : id
  return hash.slice(0, 12)
})
</script>

<template>
  <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
    <DialogContent class="max-w-3xl w-[92vw] max-h-[85vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Info class="size-4" />
          <span>镜像详情:{{ imageRef }}</span>
        </DialogTitle>
        <DialogDescription class="sr-only">镜像 inspect 与构建层</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto pr-1">
        <span v-if="loading" class="text-muted-foreground">加载中…</span>
        <div v-else-if="data" class="space-y-4 text-body">
          <!-- 基本 -->
          <section>
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">基本信息</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt class="text-muted-foreground">ID</dt>
              <dd class="font-mono break-all text-caption">{{ shortId }}</dd>
              <dt class="text-muted-foreground">创建于</dt>
              <dd class="font-mono break-all">{{ data.created }}</dd>
              <dt class="text-muted-foreground">大小</dt>
              <dd class="font-mono">{{ humanSize(data.size) }}</dd>
              <dt class="text-muted-foreground">架构</dt>
              <dd class="font-mono">{{ data.os }}/{{ data.architecture }}</dd>
              <dt v-if="data.author" class="text-muted-foreground">作者</dt>
              <dd v-if="data.author" class="break-all">{{ data.author }}</dd>
            </dl>
            <div v-if="data.repoTags.length" class="mt-1.5">
              <div class="mb-1 text-muted-foreground">Tags</div>
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="t in data.repoTags" :key="t" variant="secondary" class="text-caption font-mono">{{ t }}</Badge>
              </div>
            </div>
            <div v-if="data.repoDigests.length" class="mt-1.5">
              <div class="mb-1 text-muted-foreground">Digests</div>
              <div class="space-y-1">
                <div v-for="d in data.repoDigests" :key="d" class="rounded-md bg-muted/30 px-2 py-1 font-mono text-caption break-all">
                  {{ d }}
                </div>
              </div>
            </div>
          </section>

          <!-- 运行配置 -->
          <section>
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">运行配置</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt class="text-muted-foreground">Entrypoint</dt>
              <dd class="font-mono break-all">{{ data.entrypoint.join(' ') || '—' }}</dd>
              <dt class="text-muted-foreground">CMD</dt>
              <dd class="font-mono break-all">{{ data.cmd.join(' ') || '—' }}</dd>
              <dt class="text-muted-foreground">User</dt>
              <dd class="font-mono">{{ data.user || '—' }}</dd>
              <dt class="text-muted-foreground">WorkingDir</dt>
              <dd class="font-mono break-all">{{ data.workingDir || '—' }}</dd>
            </dl>
            <div v-if="data.exposedPorts.length" class="mt-1.5">
              <div class="mb-1 text-muted-foreground">Exposed Ports</div>
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="p in data.exposedPorts" :key="p" variant="secondary" class="text-caption font-mono">{{ p }}</Badge>
              </div>
            </div>
            <div v-if="data.volumes.length" class="mt-1.5">
              <div class="mb-1 text-muted-foreground">Volumes(镜像声明的挂载点)</div>
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="v in data.volumes" :key="v" variant="secondary" class="text-caption font-mono">{{ v }}</Badge>
              </div>
            </div>
          </section>

          <!-- 环境变量 -->
          <section v-if="data.env.length">
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">默认环境变量</h4>
            <div class="space-y-1">
              <div
                v-for="e in data.env"
                :key="e"
                class="rounded-md bg-muted/30 px-2 py-1 font-mono text-caption break-all"
              >
                {{ e }}
              </div>
            </div>
          </section>

          <!-- 标签 -->
          <section v-if="Object.keys(data.labels).length">
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">标签</h4>
            <div class="space-y-1">
              <div
                v-for="(v, k) in data.labels"
                :key="k"
                class="rounded-md bg-muted/30 px-2 py-1 font-mono text-caption break-all"
              >
                <span class="text-muted-foreground">{{ k }}</span> = {{ v }}
              </div>
            </div>
          </section>

          <!-- 层历史 -->
          <section v-if="history.length">
            <h4 class="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <Layers class="size-3.5" />
              构建层({{ history.length }})
            </h4>
            <div class="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow class="bg-muted/40 hover:bg-muted/40">
                    <TableHead class="h-8 text-caption font-medium">大小</TableHead>
                    <TableHead class="h-8 text-caption font-medium">CreatedBy(Dockerfile 指令)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(l, i) in history" :key="i">
                    <TableCell class="py-1.5 text-caption font-mono whitespace-nowrap">{{ l.size }}</TableCell>
                    <TableCell class="py-1.5 text-caption font-mono break-all" :title="l.createdBy">
                      {{ cleanCreatedBy(l.createdBy) || '—' }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
