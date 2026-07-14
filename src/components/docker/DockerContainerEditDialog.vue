<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { SquarePen, Network, X, ChevronDown, Plus } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/stores/toast'
import {
  dockerRename,
  dockerUpdateContainer,
  dockerListNetworks,
  dockerNetworkConnect,
  dockerNetworkDisconnect,
  type DockerInspect,
  type DockerNetwork,
} from '@/api/docker'

import { editContainerTransaction } from './edit-container'

const props = defineProps<{
  open: boolean
  sessionId: string
  inspect: DockerInspect | null
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'updated'): void
}>()

interface Form {
  name: string
  memory: string
  cpus: string
  restart: string  // 空串保持不改;其它值参与 update
}

const form = reactive<Form>({ name: '', memory: '', cpus: '', restart: '' })
const busy = ref(false)

// 网络编辑:docker update 不能改网络,得走 network connect/disconnect。
// initialNetworks 用作 diff 基准;currentNetworks 是弹窗里的可变状态。
const initialNetworks = ref<string[]>([])
const currentNetworks = ref<string[]>([])
const availableNetworks = ref<DockerNetwork[]>([])
const customNet = ref('')
// 简单去掉一些非用户网络(如已连的)后展示;host/none 只允许单独存在,选择时若冲突让 docker 自己报
const selectableNetworks = computed(() =>
  availableNetworks.value
    .map((n) => n.name)
    .filter((n) => n && !currentNetworks.value.includes(n)),
)

/** 字节转 "512m"/"2g",按 IEC(1024)取整;0 显示为空(=无限制不显式设) */
function formatMemory(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  const g = bytes / (1024 * 1024 * 1024)
  if (g >= 1 && Number.isInteger(g)) return `${g}g`
  const m = bytes / (1024 * 1024)
  if (m >= 1) return `${Math.round(m)}m`
  const k = bytes / 1024
  return `${Math.round(k)}k`
}

// 打开时用当前 inspect 数据填充默认值
watch(
  () => [props.open, props.inspect] as const,
  async ([open, insp]) => {
    if (!open || !insp) return
    form.name = insp.name
    form.memory = formatMemory(insp.memoryBytes)
    form.cpus = insp.cpus > 0 ? String(insp.cpus) : ''
    // 空 / 'no' 归一为下拉的默认项(保持不改)
    form.restart = insp.restartPolicy && insp.restartPolicy !== 'no' ? insp.restartPolicy : 'no'
    initialNetworks.value = [...insp.networks]
    currentNetworks.value = [...insp.networks]
    customNet.value = ''
    availableNetworks.value = []
    // 拉网络列表用于下拉候选;失败不阻塞其它编辑
    try {
      availableNetworks.value = await dockerListNetworks(props.sessionId)
    } catch {
      // 静默:用户仍可手输网络名
    }
  },
)

const currentName = computed(() => props.inspect?.name ?? '')

// 判断哪些字段实际有变化;避免打空的 rename/update 命令
const nameChanged = computed(() => form.name.trim() && form.name.trim() !== currentName.value)
const memoryChanged = computed(() => form.memory.trim() !== formatMemory(props.inspect?.memoryBytes ?? 0))
const cpusChanged = computed(() => {
  const cur = props.inspect?.cpus ?? 0
  const curStr = cur > 0 ? String(cur) : ''
  return form.cpus.trim() !== curStr
})
const restartChanged = computed(() => {
  const curRaw = props.inspect?.restartPolicy ?? ''
  const cur = curRaw && curRaw !== 'no' ? curRaw : 'no'
  return form.restart !== cur
})

// 网络 diff:需断开(在初始里、当前没有)与需连接(在当前里、初始没有)
const netsToDisconnect = computed(() =>
  initialNetworks.value.filter((n) => !currentNetworks.value.includes(n)),
)
const netsToConnect = computed(() =>
  currentNetworks.value.filter((n) => !initialNetworks.value.includes(n)),
)
const networksChanged = computed(
  () => netsToDisconnect.value.length > 0 || netsToConnect.value.length > 0,
)

function addNetwork(name: string) {
  const n = name.trim()
  if (!n) return
  if (currentNetworks.value.includes(n)) return
  currentNetworks.value.push(n)
}

function removeNetwork(name: string) {
  currentNetworks.value = currentNetworks.value.filter((n) => n !== name)
}

function submitCustomNet() {
  addNetwork(customNet.value)
  customNet.value = ''
}

const canSubmit = computed(
  () =>
    !busy.value &&
    (nameChanged.value ||
      memoryChanged.value ||
      cpusChanged.value ||
      restartChanged.value ||
      networksChanged.value),
)

function handleOpenChange(nextOpen: boolean) {
  if (!nextOpen && busy.value) return
  emit('update:open', nextOpen)
}

async function submit() {
  if (!canSubmit.value || !props.inspect) return
  const inspect = props.inspect
  const originalName = inspect.name
  const targetName = nameChanged.value ? form.name.trim() : originalName
  const previousRestart = inspect.restartPolicy && inspect.restartPolicy !== 'no'
    ? inspect.restartPolicy
    : 'no'
  const nextUpdate = {
    memory: memoryChanged.value ? form.memory.trim() || '0' : undefined,
    cpus: cpusChanged.value ? form.cpus.trim() || '0' : undefined,
    restart: restartChanged.value ? form.restart : undefined,
  }
  const previousUpdate = {
    memory: memoryChanged.value ? formatMemory(inspect.memoryBytes) || '0' : undefined,
    cpus: cpusChanged.value ? (inspect.cpus > 0 ? String(inspect.cpus) : '0') : undefined,
    restart: restartChanged.value ? previousRestart : undefined,
  }
  const disconnectNetworks = [...netsToDisconnect.value]
  const connectNetworks = [...netsToConnect.value]

  busy.value = true
  try {
    await editContainerTransaction(
      {
        originalName,
        targetName,
        nextUpdate,
        previousUpdate,
        disconnectNetworks,
        connectNetworks,
      },
      {
        rename: async (container, newName) => {
          await dockerRename(props.sessionId, container, newName)
        },
        update: async (container, options) => {
          await dockerUpdateContainer(props.sessionId, container, options)
        },
        disconnectNetwork: async (network, container) => {
          await dockerNetworkDisconnect(props.sessionId, network, container)
        },
        connectNetwork: async (network, container) => {
          await dockerNetworkConnect(props.sessionId, network, container)
        },
      },
    )
    toast.success('已更新')
    emit('updated')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '更新失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="max-w-md w-[92vw]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <SquarePen class="size-4" />
          <span>编辑容器</span>
        </DialogTitle>
        <DialogDescription class="sr-only">改名与运行时资源限制</DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <div>
          <Label class="mb-1 block text-caption text-muted-foreground">容器名</Label>
          <Input v-model="form.name" class="h-7 text-body" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <Label class="mb-1 block text-caption text-muted-foreground">内存限制</Label>
            <Input v-model="form.memory" placeholder="512m / 2g;留空不限" class="h-7 text-body font-mono" />
          </div>
          <div>
            <Label class="mb-1 block text-caption text-muted-foreground">CPU 数</Label>
            <Input v-model="form.cpus" placeholder="1.5;留空不限" class="h-7 text-body font-mono" />
          </div>
        </div>
        <div>
          <Label class="mb-1 block text-caption text-muted-foreground">重启策略</Label>
          <Select v-model="form.restart">
            <SelectTrigger class="h-7 text-body">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">no(不自动重启)</SelectItem>
              <SelectItem value="on-failure">on-failure</SelectItem>
              <SelectItem value="unless-stopped">unless-stopped</SelectItem>
              <SelectItem value="always">always</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label class="mb-1 flex items-center gap-1.5 text-caption text-muted-foreground">
            <Network class="size-3.5" />
            <span>网络</span>
          </Label>
          <!-- 当前网络列表:Badge 展示,点 X 移除 -->
          <div class="mb-1.5 flex flex-wrap gap-1.5">
            <Badge
              v-for="n in currentNetworks"
              :key="n"
              variant="secondary"
              class="gap-1 pr-1 font-mono text-caption"
            >
              <span>{{ n }}</span>
              <button
                type="button"
                class="rounded p-0.5 hover:bg-muted-foreground/20"
                @click="removeNetwork(n)"
              >
                <X class="size-3" />
              </button>
            </Badge>
            <span v-if="!currentNetworks.length" class="text-caption text-muted-foreground">
              未接入任何网络
            </span>
          </div>
          <!-- 添加网络:下拉候选 + 自定义输入 -->
          <div class="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1 px-2 text-body"
                  :disabled="!selectableNetworks.length"
                >
                  <span>{{ selectableNetworks.length ? '选择网络' : '无可选' }}</span>
                  <ChevronDown class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="max-h-64 overflow-y-auto">
                <DropdownMenuItem
                  v-for="n in selectableNetworks"
                  :key="n"
                  class="font-mono text-body"
                  @select="addNetwork(n)"
                >
                  {{ n }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              v-model="customNet"
              placeholder="自定义网络名"
              class="h-7 flex-1 text-body font-mono"
              @keydown.enter.prevent="submitCustomNet"
            />
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1 px-2"
              :disabled="!customNet.trim()"
              @click="submitCustomNet"
            >
              <Plus class="size-3.5" />
              <span class="text-body">添加</span>
            </Button>
          </div>
        </div>

        <p class="text-caption text-muted-foreground">
          资源、名称与网络会按顺序应用；任一步失败时自动尝试恢复已完成的变更。
          host / none 与其它网络互斥,同时选中时 docker 会报错。
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="handleOpenChange(false)">取消</Button>
        <Button variant="default" :disabled="!canSubmit" @click="submit">
          {{ busy ? '应用中…' : '应用' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
