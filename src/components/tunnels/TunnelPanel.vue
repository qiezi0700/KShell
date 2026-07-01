<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Plus, Trash2, AlertCircle, Globe, Laptop } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/stores/toast'
import { tabs, activeTabId } from '@/stores/tabs'
import {
  tunnelList,
  tunnelAdd,
  tunnelRemove,
  onTunnelUpdate,
  onTunnelError,
  type TunnelInfo,
  type TunnelKind,
} from '@/api/tunnel'
import type { UnlistenFn } from '@tauri-apps/api/event'

const items = ref<TunnelInfo[]>([])
const loading = ref(false)
const kind = ref<'local' | 'remote'>('local')
const localAddr = ref('127.0.0.1')
const localPort = ref('')
const remoteHost = ref('127.0.0.1')
const remotePort = ref('')
const adding = ref(false)

const unlisteners: UnlistenFn[] = []

const activeSessionId = computed(() => {
  const id = activeTabId.value
  if (!id) return null
  const tab = tabs.value.find(t => t.id === id)
  return tab?.sessionId ?? null
})

const isLocal = computed(() => kind.value === 'local')

onMounted(async () => {
  const errUnlisten = await onTunnelError(msg => toast.error(msg, '隧道错误'))
  unlisteners.push(errUnlisten)
  await refresh()
})

onBeforeUnmount(() => {
  unlisteners.forEach(fn => fn())
})

watch(activeSessionId, () => {
  void refresh()
})

async function refresh() {
  const sid = activeSessionId.value
  if (!sid) {
    items.value = []
    return
  }
  loading.value = true
  try {
    items.value = await tunnelList(sid)
    // 为每条隧道监听状态更新
    for (const t of items.value) {
      const fn = await onTunnelUpdate(t.id, updated => {
        const idx = items.value.findIndex(x => x.id === updated.id)
        if (idx >= 0) items.value[idx] = updated
      })
      unlisteners.push(fn)
    }
  } catch (e: any) {
    toast.error(String(e), '读取隧道失败')
  } finally {
    loading.value = false
  }
}

async function addTunnel() {
  const sid = activeSessionId.value
  if (!sid) {
    toast.info('请先打开一个 SSH 会话', '无可用会话')
    return
  }
  const lport = parseInt(localPort.value, 10)
  const rport = parseInt(remotePort.value, 10)
  if (Number.isNaN(lport) || lport < 0 || lport > 65535) {
    toast.error('本地端口应为 0-65535 的数字', '参数错误')
    return
  }
  if (Number.isNaN(rport) || rport <= 0 || rport > 65535) {
    toast.error('目标端口应为 1-65535 的数字', '参数错误')
    return
  }

  let tunnelKind: TunnelKind
  if (isLocal.value) {
    tunnelKind = {
      kind: 'local',
      localAddr: localAddr.value || '127.0.0.1',
      localPort: lport,
      remoteHost: remoteHost.value || '127.0.0.1',
      remotePort: rport,
    }
  } else {
    tunnelKind = {
      kind: 'remote',
      bindAddr: localAddr.value || '0.0.0.0',
      bindPort: lport,
      localHost: remoteHost.value || '127.0.0.1',
      localPort: rport,
    }
  }

  adding.value = true
  try {
    await tunnelAdd(sid, tunnelKind)
    toast.success('隧道已启动', '成功')
    await refresh()
  } catch (e: any) {
    toast.error(String(e), '启动隧道失败')
  } finally {
    adding.value = false
  }
}

async function removeTunnel(id: string) {
  try {
    await tunnelRemove(id)
    items.value = items.value.filter(t => t.id !== id)
  } catch (e: any) {
    toast.error(String(e), '停止隧道失败')
  }
}

function stateText(t: TunnelInfo): string {
  if (t.state === 'active') return '运行中'
  if (t.state === 'closed') return '已关闭'
  if (typeof t.state === 'object' && 'error' in t.state) return `错误:${t.state.error}`
  return '未知'
}

function stateClass(t: TunnelInfo): string {
  if (t.state === 'active') return 'text-success'
  if (t.state === 'closed') return 'text-muted-foreground'
  return 'text-destructive'
}

function formatKind(t: TunnelInfo): string {
  if (t.kind.kind === 'local') {
    return `${t.kind.localAddr}:${t.kind.localPort} → ${t.kind.remoteHost}:${t.kind.remotePort}`
  }
  return `${t.kind.bindAddr}:${t.kind.bindPort} → ${t.kind.localHost}:${t.kind.localPort}`
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 p-3 text-[12px]">
    <div v-if="!activeSessionId" class="text-muted-foreground">
      请先连接或打开一个 SSH 会话以管理端口隧道。
    </div>

    <template v-else>
      <!-- 新增表单 -->
      <div class="space-y-2 rounded-md border border-border bg-muted/30 p-2">
        <div class="flex items-center gap-2">
          <Select v-model="kind">
            <SelectTrigger class="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本地转发</SelectItem>
              <SelectItem value="remote">远程转发</SelectItem>
            </SelectContent>
          </Select>
          <span class="text-muted-foreground">{{ isLocal ? '本地端口 → 远端目标' : '远端端口 → 本地目标' }}</span>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <Label class="text-[10px]">{{ isLocal ? '本地地址' : '绑定地址' }}</Label>
            <Input v-model="localAddr" class="h-7 text-[11px]" :placeholder="isLocal ? '127.0.0.1' : '0.0.0.0'" />
          </div>
          <div class="space-y-1">
            <Label class="text-[10px]">{{ isLocal ? '本地端口' : '绑定端口' }}</Label>
            <Input v-model="localPort" class="h-7 text-[11px]" placeholder="例如 18080" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <Label class="text-[10px]">{{ isLocal ? '远端目标地址' : '本地目标地址' }}</Label>
            <Input v-model="remoteHost" class="h-7 text-[11px]" placeholder="127.0.0.1" />
          </div>
          <div class="space-y-1">
            <Label class="text-[10px]">{{ isLocal ? '远端目标端口' : '本地目标端口' }}</Label>
            <Input v-model="remotePort" class="h-7 text-[11px]" placeholder="例如 80" />
          </div>
        </div>

        <Button size="sm" class="h-7 w-full text-[11px]" :disabled="adding" @click="addTunnel">
          <Plus class="size-3.5" />
          添加隧道
        </Button>
      </div>

      <!-- 列表 -->
      <ScrollArea class="flex-1">
        <div v-if="loading" class="py-4 text-center text-muted-foreground">加载中…</div>
        <div v-else-if="items.length === 0" class="py-4 text-center text-muted-foreground">
          暂无隧道规则
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="t in items"
            :key="t.id"
            class="flex items-center gap-2 rounded-md border border-border p-2"
          >
            <component
              :is="t.kind.kind === 'local' ? Laptop : Globe"
              class="size-3.5 shrink-0 text-muted-foreground"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ formatKind(t) }}</div>
              <div class="text-[10px]" :class="stateClass(t)">{{ stateText(t) }}</div>
            </div>
            <button
              class="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              title="停止"
              @click="removeTunnel(t.id)"
            >
              <Trash2 class="size-3" />
            </button>
          </div>
        </div>
      </ScrollArea>

      <div class="flex items-start gap-1 text-[10px] text-muted-foreground">
        <AlertCircle class="size-3 shrink-0 mt-0.5" />
        <span>端口 0 表示让系统自动分配;会话断开时隧道自动关闭。</span>
      </div>
    </template>
  </div>
</template>
