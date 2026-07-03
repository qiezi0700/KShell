<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { DockerInspect } from '@/api/docker'

const props = defineProps<{
  open: boolean
  container: string | null
  loading: boolean
  data: DockerInspect | null
}>()

defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

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
  <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
    <DialogContent class="max-w-3xl w-[92vw] max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Info class="size-4" />
          <span>容器详情:{{ container }}</span>
        </DialogTitle>
        <DialogDescription class="sr-only">容器 inspect 信息</DialogDescription>
      </DialogHeader>

      <div class="overflow-y-auto pr-1">
        <span v-if="loading" class="text-muted-foreground">加载中…</span>
        <div v-else-if="data" class="space-y-4 text-body">
          <!-- 基本信息 -->
          <section>
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">基本信息</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt class="text-muted-foreground">名称</dt>
              <dd class="font-mono break-all">{{ data.name }}</dd>
              <dt class="text-muted-foreground">ID</dt>
              <dd class="font-mono break-all text-caption">{{ data.id }}</dd>
              <dt class="text-muted-foreground">镜像</dt>
              <dd class="font-mono break-all">{{ data.image }}</dd>
              <dt class="text-muted-foreground">状态</dt>
              <dd>
                <Badge variant="outline" class="text-caption">{{ stateLabel(data.state) }}</Badge>
              </dd>
              <dt class="text-muted-foreground">创建于</dt>
              <dd class="font-mono break-all">{{ data.createdAt }}</dd>
              <dt class="text-muted-foreground">启动于</dt>
              <dd class="font-mono break-all">{{ data.startedAt }}</dd>
              <dt v-if="data.entrypoint" class="text-muted-foreground">入口点</dt>
              <dd v-if="data.entrypoint" class="font-mono break-all">{{ data.entrypoint }}</dd>
              <dt v-if="data.command" class="text-muted-foreground">命令</dt>
              <dd v-if="data.command" class="font-mono break-all">{{ data.command }}</dd>
            </dl>
          </section>

          <!-- 网络 -->
          <section>
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">网络</h4>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt class="text-muted-foreground">IP 地址</dt>
              <dd class="font-mono break-all">{{ data.ip || '—' }}</dd>
              <dt class="text-muted-foreground">网络</dt>
              <dd class="font-mono break-all">{{ data.networks.join(', ') || '—' }}</dd>
            </dl>
            <div v-if="data.ports.length" class="mt-1.5">
              <div class="mb-1 text-muted-foreground">端口映射</div>
              <div class="flex flex-wrap gap-1.5">
                <Badge
                  v-for="p in data.ports"
                  :key="p.container + p.host"
                  variant="secondary"
                  class="text-caption font-mono"
                >
                  {{ p.host || '—' }} → {{ p.container }}
                </Badge>
              </div>
            </div>
          </section>

          <!-- 挂载 -->
          <section v-if="data.mounts.length">
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">挂载</h4>
            <div class="space-y-1">
              <div
                v-for="(m, i) in data.mounts"
                :key="i"
                class="rounded-md bg-muted/30 px-2 py-1 font-mono text-caption break-all"
              >
                <span class="text-muted-foreground">{{ m.type }}</span>
                {{ m.source }} → {{ m.destination }}
              </div>
            </div>
          </section>

          <!-- 环境变量 -->
          <section v-if="data.env.length">
            <h4 class="mb-1.5 text-caption font-medium text-muted-foreground">环境变量</h4>
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
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
