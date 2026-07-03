<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Server, Trash2, Copy, Check, RefreshCw, ShieldCheck, ShieldQuestion } from 'lucide-vue-next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { sshListKnownHosts, sshRemoveKnownHost, type KnownHostRecord } from '@/api/ssh'
import { openConfirm } from '@/stores/prompt'
import { toast } from '@/stores/toast'

const open = ref(false)
const q = ref('')
const records = ref<KnownHostRecord[]>([])
const loading = ref(false)
const copiedFp = ref<string | null>(null)

defineExpose({ open: () => openDialog() })

async function openDialog() {
  open.value = true
  q.value = ''
  await refresh()
}

async function refresh() {
  loading.value = true
  try {
    records.value = await sshListKnownHosts()
  } catch (e: unknown) {
    const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e)
    toast.error(`加载失败:${msg}`)
    records.value = []
  } finally {
    loading.value = false
  }
}

// 打开时刷新一次;关闭时清理搜索
watch(open, (v) => {
  if (!v) {
    q.value = ''
    copiedFp.value = null
  }
})

const appCount = computed(() => records.value.filter((r) => r.source === 'app').length)
const systemCount = computed(() => records.value.filter((r) => r.source === 'system').length)

// 过滤:host 前缀模糊 + 指纹子串,大小写不敏感
const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return records.value
  return records.value.filter((r) => {
    const h = r.host.toLowerCase()
    const fp = r.fingerprint.toLowerCase()
    return h.includes(kw) || fp.includes(kw) || r.keyType.toLowerCase().includes(kw)
  })
})

function displayHost(r: KnownHostRecord) {
  if (r.hashed) return '<隐藏主机名>'
  return r.port === 22 || r.port === 0 ? r.host : `${r.host}:${r.port}`
}

// 信任时间截取日期部分;系统条目无此信息,返回 '-'
function displayDate(r: KnownHostRecord) {
  if (!r.trustedAt) return '-'
  const t = r.trustedAt.slice(0, 10)
  return t || '-'
}

// 唯一 key:app 条目 host:port 唯一;系统层可能重复,用索引兜底避免 Vue 报警
function rowKey(r: KnownHostRecord, i: number) {
  return `${r.source}|${r.host}|${r.port}|${r.fingerprint}|${i}`
}

async function copyFingerprint(fp: string) {
  if (!fp) return
  try {
    await navigator.clipboard.writeText(fp)
    copiedFp.value = fp
    // 800ms 后回到 copy 图标,给用户一个"复制成功"的短反馈
    setTimeout(() => {
      if (copiedFp.value === fp) copiedFp.value = null
    }, 1200)
  } catch {
    toast.error('复制失败')
  }
}

async function removeRow(r: KnownHostRecord) {
  // 系统层只读,前端拦下
  if (r.source !== 'app') {
    toast.warning('系统 ~/.ssh/known_hosts 请用系统工具管理,KShell 不会改动')
    return
  }
  const ok = await openConfirm({
    title: '移除主机信任',
    message: `确定移除 ${displayHost(r)} 的信任记录?\n\n下次连接时将重新进入首次确认流程。`,
    confirmText: '移除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await sshRemoveKnownHost(r.host, r.port)
    toast.success('已移除')
    await refresh()
  } catch (e: unknown) {
    const msg = typeof e === 'string' ? e : (e as Error)?.message ?? String(e)
    toast.error(`移除失败:${msg}`)
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] w-[92vw] max-w-3xl flex-col gap-3">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ShieldCheck class="size-4 text-primary" />
          <span>管理已知主机</span>
        </DialogTitle>
        <DialogDescription>
          合并显示 KShell 自管信任库与系统 ~/.ssh/known_hosts。系统层为只读参考,
          删除仅影响 KShell 自身记录。
        </DialogDescription>
      </DialogHeader>

      <!-- 搜索栏 + 汇总 + 刷新 -->
      <div class="flex items-center gap-2">
        <Input
          v-model="q"
          size="sm"
          placeholder="搜索 host / 指纹 / 密钥类型…"
          class="flex-1"
        />
        <div class="text-caption flex items-center gap-2 whitespace-nowrap text-muted-foreground">
          <span>
            共 <span class="tabular-nums text-foreground">{{ records.length }}</span>
          </span>
          <span class="opacity-40">·</span>
          <span class="inline-flex items-center gap-1">
            <span class="size-1.5 rounded-full bg-primary" />
            app {{ appCount }}
          </span>
          <span class="opacity-40">·</span>
          <span class="inline-flex items-center gap-1">
            <span class="size-1.5 rounded-full bg-muted-foreground" />
            系统 {{ systemCount }}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" :disabled="loading" @click="refresh">
              <RefreshCw class="size-3.5" :class="loading && 'animate-spin'" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>重新加载</TooltipContent>
        </Tooltip>
      </div>

      <!-- 列表区 -->
      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-panel">
        <!-- 空态 -->
        <div
          v-if="!loading && filtered.length === 0"
          class="text-body flex flex-col items-center justify-center gap-2 px-6 py-12 text-muted-foreground"
        >
          <ShieldQuestion class="size-8 opacity-40" />
          <div v-if="records.length === 0">还没有已信任的主机。首次连接新主机时会自动询问</div>
          <div v-else>没有匹配的记录</div>
        </div>

        <Table v-else class="text-body">
          <TableHeader class="sticky top-0 z-10 bg-panel-2/95 backdrop-blur">
            <TableRow class="text-caption text-left hover:bg-transparent">
              <TableHead class="h-8 font-medium">主机</TableHead>
              <TableHead class="h-8 font-medium">类型</TableHead>
              <TableHead class="h-8 font-medium">指纹</TableHead>
              <TableHead class="h-8 font-medium">来源</TableHead>
              <TableHead class="h-8 font-medium">信任时间</TableHead>
              <TableHead class="h-8 w-12 text-right font-medium">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="(r, i) in filtered"
              :key="rowKey(r, i)"
              class="border-t border-border/60 border-b-0 hover:bg-muted/40"
            >
              <!-- 主机 -->
              <TableCell class="py-1.5 font-mono">
                <div class="flex items-center gap-1.5">
                  <Server class="size-3.5 shrink-0 text-muted-foreground" />
                  <span :class="r.hashed && 'italic text-muted-foreground'">
                    {{ displayHost(r) }}
                  </span>
                </div>
              </TableCell>

              <!-- 密钥类型 -->
              <TableCell class="py-1.5">
                <Badge
                  variant="secondary"
                  class="text-caption rounded-md bg-panel-2 px-1.5 py-0 font-mono font-normal text-muted-foreground"
                >
                  {{ r.keyType || '未知' }}
                </Badge>
              </TableCell>

              <!-- 指纹 + 复制 -->
              <TableCell class="py-1.5">
                <button
                  type="button"
                  class="group inline-flex items-center gap-1 rounded font-mono text-caption text-muted-foreground transition-colors hover:text-foreground"
                  :title="r.fingerprint || '无指纹'"
                  :disabled="!r.fingerprint"
                  @click="copyFingerprint(r.fingerprint)"
                >
                  <!--
                    指纹长约 50 字符,直接显示会撑破布局。
                    取 "SHA256:" 前缀 + 后 12 位:既保留特征、又能一眼比对
                  -->
                  <span class="tabular-nums">
                    {{ r.fingerprint ? r.fingerprint.slice(0, 8) + '…' + r.fingerprint.slice(-10) : '-' }}
                  </span>
                  <Check
                    v-if="copiedFp === r.fingerprint"
                    class="size-3 text-success"
                  />
                  <Copy
                    v-else-if="r.fingerprint"
                    class="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              </TableCell>

              <!-- 来源 -->
              <TableCell class="py-1.5">
                <Badge
                  v-if="r.source === 'app'"
                  class="text-caption rounded-md bg-primary/15 px-1.5 py-0 font-normal text-primary"
                >
                  KShell
                </Badge>
                <Badge
                  v-else
                  variant="secondary"
                  class="text-caption rounded-md bg-panel-2 px-1.5 py-0 font-normal text-muted-foreground"
                >
                  系统
                </Badge>
              </TableCell>

              <!-- 信任时间 -->
              <TableCell class="py-1.5 font-mono tabular-nums text-muted-foreground">
                {{ displayDate(r) }}
              </TableCell>

              <!-- 操作 -->
              <TableCell class="py-1.5 text-right">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      :disabled="r.source !== 'app'"
                      class="hover:bg-destructive/15 hover:text-destructive"
                      @click="removeRow(r)"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ r.source === 'app' ? '移除信任' : '系统条目只读' }}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </DialogContent>
  </Dialog>
</template>
