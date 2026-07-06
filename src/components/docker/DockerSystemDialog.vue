<script setup lang="ts">
import { ref, watch } from 'vue'
import { HardDrive, RefreshCw, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dockerSystemDf, dockerSystemPrune, type DockerDfEntry } from '@/api/docker'
import { openConfirm } from '@/stores/prompt'
import { toast } from '@/stores/toast'

const props = defineProps<{
  open: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** prune 完成后通知父组件刷新容器/镜像列表 */
  (e: 'pruned'): void
}>()

const loading = ref(false)
const rows = ref<DockerDfEntry[]>([])
const pruning = ref(false)

async function refresh() {
  loading.value = true
  try {
    rows.value = await dockerSystemDf(props.sessionId)
  } catch (e: unknown) {
    toast.error(String(e), '读取磁盘占用失败')
  } finally {
    loading.value = false
  }
}

async function prune(withVolumes: boolean) {
  const ok = await openConfirm({
    title: withVolumes ? '深度清理(含未使用卷)' : '清理未使用资源',
    message: withVolumes
      ? '将删除所有已停止的容器、未挂载的卷、悬空镜像与构建缓存。\n卷中的数据会永久丢失,操作不可逆!'
      : '将删除所有已停止的容器、无容器使用的镜像、未使用的网络与构建缓存。\n(不会动到卷)',
    confirmText: withVolumes ? '深度清理' : '清理',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  pruning.value = true
  try {
    const out = await dockerSystemPrune(props.sessionId, withVolumes)
    // docker prune 输出末尾会带 "Total reclaimed space: xxx"
    const m = out.match(/Total reclaimed space:\s*([^\n]+)/i)
    toast.success(m ? `已回收 ${m[1].trim()}` : '清理完成')
    emit('pruned')
    refresh()
  } catch (e: unknown) {
    toast.error(String(e), '清理失败')
  } finally {
    pruning.value = false
  }
}

// 打开时拉一次;关闭时不主动清空,下次打开先显示旧数据再刷新,避免闪烁
watch(
  () => props.open,
  (open) => {
    if (open) refresh()
  },
  { immediate: true },
)
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-2xl w-[92vw]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <HardDrive class="size-4" />
          <span>Docker 磁盘占用</span>
          <Button variant="ghost" size="icon-sm" class="ml-auto" :disabled="loading" @click="refresh">
            <RefreshCw class="size-3.5" :class="loading && 'animate-spin'" />
          </Button>
        </DialogTitle>
        <DialogDescription class="sr-only">docker system df 汇总与一键清理</DialogDescription>
      </DialogHeader>

      <!-- 汇总表:类型 / 数量 / 活跃 / 大小 / 可回收
           用 <table> 而非 grid:原实现每行是独立 grid 容器,列宽各自计算,表头和内容对不齐。 -->
      <div class="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted/40 hover:bg-muted/40">
              <TableHead class="h-8 text-caption font-medium">类型</TableHead>
              <TableHead class="h-8 text-caption font-medium text-right">总数</TableHead>
              <TableHead class="h-8 text-caption font-medium text-right">活跃</TableHead>
              <TableHead class="h-8 text-caption font-medium text-right">占用</TableHead>
              <TableHead class="h-8 text-caption font-medium text-right">可回收</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading && !rows.length">
              <TableCell colspan="5" class="py-6 text-center text-body text-muted-foreground">加载中…</TableCell>
            </TableRow>
            <TableRow v-else-if="!rows.length">
              <TableCell colspan="5" class="py-6 text-center text-body text-muted-foreground">暂无数据</TableCell>
            </TableRow>
            <TableRow v-for="r in rows" v-else :key="r.type">
              <TableCell class="py-1.5 text-body">{{ r.type }}</TableCell>
              <TableCell class="py-1.5 text-body text-right font-mono">{{ r.totalCount }}</TableCell>
              <TableCell class="py-1.5 text-body text-right font-mono">{{ r.active }}</TableCell>
              <TableCell class="py-1.5 text-body text-right font-mono">{{ r.size }}</TableCell>
              <TableCell class="py-1.5 text-right">
                <Badge variant="secondary" class="font-mono text-caption">{{ r.reclaimable }}</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <!-- 清理操作 -->
      <div class="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" :disabled="pruning" @click="prune(false)">
          <Trash2 class="size-3.5" />
          清理未使用资源
        </Button>
        <Button variant="destructive" size="sm" :disabled="pruning" @click="prune(true)">
          <Trash2 class="size-3.5" />
          深度清理(含卷)
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
