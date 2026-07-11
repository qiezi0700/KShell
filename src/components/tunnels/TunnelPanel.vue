<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Plus, Trash2, Globe, Laptop, RefreshCw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
const showForm = ref(false)
const kind = ref<'local' | 'remote'>('local')
const localAddr = ref('127.0.0.1')
const localPort = ref('')
const remoteHost = ref('127.0.0.1')
const remotePort = ref('')
const adding = ref(false)

let errorUnlisten: UnlistenFn | null = null
const tunnelUnlisteners = new Map<string, UnlistenFn>()
let refreshToken = 0

const activeSessionId = computed(() => {
  const id = activeTabId.value
  if (!id) return null
  const tab = tabs.value.find(t => t.id === id)
  return tab?.sessionId ?? null
})

const isLocal = computed(() => kind.value === 'local')

onMounted(async () => {
  errorUnlisten = await onTunnelError(msg => toast.error(msg, '隧道错误'))
  await refresh()
})

onBeforeUnmount(() => {
  refreshToken++
  errorUnlisten?.()
  clearTunnelListeners()
})

watch(activeSessionId, () => {
  void refresh()
})

watch(kind, (next, previous) => {
  if (next === 'remote' && previous === 'local' && localAddr.value === '127.0.0.1') {
    localAddr.value = '0.0.0.0'
  } else if (next === 'local' && previous === 'remote' && localAddr.value === '0.0.0.0') {
    localAddr.value = '127.0.0.1'
  }
})

function clearTunnelListeners() {
  tunnelUnlisteners.forEach(fn => fn())
  tunnelUnlisteners.clear()
}

async function refresh() {
  const token = ++refreshToken
  clearTunnelListeners()
  const sid = activeSessionId.value
  if (!sid) {
    items.value = []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const listed = await tunnelList(sid)
    if (token !== refreshToken || activeSessionId.value !== sid) return
    items.value = listed
    for (const t of listed) {
      const fn = await onTunnelUpdate(t.id, updated => {
        const idx = items.value.findIndex(x => x.id === updated.id)
        if (idx >= 0) items.value[idx] = updated
      })
      if (token !== refreshToken || activeSessionId.value !== sid) {
        fn()
        return
      }
      tunnelUnlisteners.set(t.id, fn)
    }
  } catch (e: any) {
    if (token === refreshToken) toast.error(String(e), '读取隧道失败')
  } finally {
    if (token === refreshToken) loading.value = false
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
    showForm.value = false
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
    tunnelUnlisteners.get(id)?.()
    tunnelUnlisteners.delete(id)
    items.value = items.value.filter(t => t.id !== id)
  } catch (e: any) {
    toast.error(String(e), '停止隧道失败')
  }
}

function sourceStr(t: TunnelInfo): string {
  return t.kind.kind === 'local'
    ? `${t.kind.localAddr}:${t.kind.localPort}`
    : `${t.kind.bindAddr}:${t.kind.bindPort}`
}

function destStr(t: TunnelInfo): string {
  return t.kind.kind === 'local'
    ? `${t.kind.remoteHost}:${t.kind.remotePort}`
    : `${t.kind.localHost}:${t.kind.localPort}`
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 工具栏 -->
    <div class="border-b border-sidebar-border px-2 py-1.5">
      <div class="flex items-center gap-1 pb-1.5">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="showForm = !showForm"><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent>添加隧道</TooltipContent>
        </Tooltip>
        <span class="flex-1" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="refresh()"><RefreshCw /></Button>
          </TooltipTrigger>
          <TooltipContent>刷新</TooltipContent>
        </Tooltip>
      </div>

      <!-- 可折叠表单 -->
      <div v-if="showForm" class="space-y-1.5 pt-1.5">
        <Select v-model="kind">
          <SelectTrigger class="text-body h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">本地转发</SelectItem>
            <SelectItem value="remote">远程转发</SelectItem>
          </SelectContent>
        </Select>

        <div class="flex gap-1.5">
          <Input v-model="localAddr" class="text-body h-7 flex-1 font-mono" :placeholder="isLocal ? '本地地址' : '绑定地址'" />
          <Input v-model="localPort" class="text-body h-7 w-14 shrink-0 font-mono" placeholder="端口" />
        </div>
        <div class="flex gap-1.5">
          <Input v-model="remoteHost" class="text-body h-7 flex-1 font-mono" :placeholder="isLocal ? '远端地址' : '本地地址'" />
          <Input v-model="remotePort" class="text-body h-7 w-14 shrink-0 font-mono" placeholder="端口" />
        </div>

        <Button size="sm" class="w-full" :disabled="adding" @click="addTunnel">
          <Plus class="size-3.5" />
          添加隧道
        </Button>
        <div class="text-caption px-0.5 text-muted-foreground/70">
          {{ isLocal
            ? '端口 0 表示自动分配;会话断开时隧道自动关闭。'
            : '绑定 0.0.0.0 会对外开放,且需服务端允许 GatewayPorts。' }}
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="flex-1 overflow-y-auto p-1">
      <div
        v-if="!activeSessionId"
        class="text-body px-3 py-6 text-center text-muted-foreground"
      >
        请先打开一个 SSH 会话
      </div>
      <div
        v-else-if="loading"
        class="text-body px-3 py-6 text-center text-muted-foreground"
      >
        加载中…
      </div>
      <div
        v-else-if="items.length === 0"
        class="text-body px-3 py-6 text-center text-muted-foreground"
      >
        暂无隧道,点上方 + 添加
      </div>

      <ContextMenu v-for="t in items" :key="t.id" class="block">
        <ContextMenuTrigger as-child>
          <button
            class="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
          >
            <component
              :is="t.kind.kind === 'local' ? Laptop : Globe"
              :class="cn(
                'size-3.5 shrink-0',
                t.state === 'active' ? 'text-success' : 'text-muted-foreground',
              )"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-body truncate font-mono font-medium">{{ sourceStr(t) }}</span>
              <span class="text-caption truncate pl-[22px] font-mono text-muted-foreground/80">{{ destStr(t) }}</span>
              <span
                v-if="typeof t.state === 'object' && 'error' in t.state"
                class="text-caption truncate pl-[22px] text-destructive"
              >{{ t.state.error }}</span>
            </div>
            <span
              v-if="t.state === 'active'"
              class="size-1.5 shrink-0 rounded-full bg-success"
            />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem variant="destructive" @select="removeTunnel(t.id)">
            <Trash2 class="size-3.5" /> 停止隧道
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </div>
</template>
