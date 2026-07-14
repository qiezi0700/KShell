<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { PlusCircle, Plus, X, Package, ChevronDown, PackageCheck, Network as NetworkIcon, Copy } from '@lucide/vue'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/stores/toast'
import {
  dockerRun,
  dockerPull,
  dockerInspect,
  dockerContainerExists,
  dockerStart,
  dockerStop,
  dockerRemove,
  dockerRename,
  dockerNetworkConnect,
  buildRunCommandFromSpec,
  type DockerImage,
  type DockerNetwork,
  type DockerRunSpec,
} from '@/api/docker'

import { cloneContainerTransaction } from './clone-container'
import { recreateContainerTransaction } from './recreate-container'

const props = withDefaults(
  defineProps<{
    open: boolean
    sessionId: string
    /** 本地镜像列表,供 image 输入框旁的"选本地"下拉使用 */
    images: DockerImage[]
    /** 本地网络列表,供 "选网络" 下拉;传空数组则只保留手动输入 */
    networks?: DockerNetwork[]
    /** 弹窗模式:
     *  - create:新建空表单
     *  - recreate:用旧配置重建(pull + stop + rm + run),名可同可改
     *  - clone:克隆容器(基于原配置创建新容器,不删原容器),可选是否拉取最新镜像/停止原容器
     */
    mode?: 'create' | 'recreate' | 'clone'
    /** recreate/clone 模式下预填的配置(通常来自 inspectToRunSpec) */
    initial?: DockerRunSpec | null
    /** recreate/clone 模式下用于展示的原始容器名(标题里显示) */
    initialName?: string
  }>(),
  { mode: 'create', initial: null, initialName: '', networks: () => [] },
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'created'): void
  /** recreate 模式提交完成后触发,供父组件刷新列表 */
  (e: 'recreated'): void
}>()

// 表单原地对象;每次打开重置
interface PortRow { host: string; container: string }
interface VolRow { source: string; destination: string; readOnly: boolean }

interface Form {
  image: string
  name: string
  hostname: string
  workingDir: string
  restartPolicy: string  // 'no' | 'always' | 'unless-stopped' | 'on-failure' | ''
  /** 有序网络列表;第一个走 docker run --network,其余用 network connect 追加。为空即 docker 默认 */
  networks: string[]
  memory: string
  cpus: string
  ports: PortRow[]
  volumes: VolRow[]
  env: string[]      // 每项 "KEY=VALUE"
  cmd: string[]
  privileged: boolean
  capAdd: string[]
  capDrop: string[]
  dns: string[]
  devices: DockerRunSpec['devices']
}

function empty(): Form {
  return {
    image: '',
    name: '',
    hostname: '',
    workingDir: '',
    restartPolicy: 'no',
    networks: [],
    memory: '',
    cpus: '',
    ports: [],
    volumes: [],
    env: [],
    cmd: [],
    privileged: false,
    capAdd: [],
    capDrop: [],
    dns: [],
    devices: [],
  }
}

/** 复制命令参数数组,避免表单编辑污染 inspect 原始数据 */
function fillFromSpec(spec: DockerRunSpec): Form {
  const netList: string[] = []
  if (spec.networkMode) netList.push(spec.networkMode)
  if (spec.additionalNetworks) netList.push(...spec.additionalNetworks)
  return {
    image: spec.image ?? '',
    name: spec.name ?? '',
    hostname: spec.hostname ?? '',
    workingDir: spec.workingDir ?? '',
    restartPolicy: spec.restartPolicy || 'no',
    networks: netList,
    memory: spec.memory ?? '',
    cpus: spec.cpus ?? '',
    ports: spec.ports.map((p) => ({ host: p.host, container: p.container })),
    volumes: spec.volumes.map((v) => ({
      source: v.source,
      destination: v.destination,
      readOnly: !!v.readOnly,
    })),
    env: [...spec.env],
    cmd: [...spec.cmd],
    privileged: spec.privileged,
    capAdd: [...spec.capAdd],
    capDrop: [...spec.capDrop],
    dns: [...spec.dns],
    devices: spec.devices.map((device) => ({ ...device })),
  }
}

const form = reactive<Form>(empty())
const busy = ref(false)
const advancedOpen = ref(false)
const imagePickerOpen = ref(false)

// clone 模式选项:是否拉取最新镜像、是否停止原容器
const clonePullImage = ref(true)
const cloneStopOriginal = ref(true)

// 打开时按 mode 决定预填:create 清空;recreate/clone 用 initial 填,并默认展开高级
watch(
  () => props.open,
  (v) => {
    if (v) {
      if (props.mode !== 'create' && props.initial) {
        Object.assign(form, fillFromSpec(props.initial))
        advancedOpen.value = true
      } else {
        Object.assign(form, empty())
        advancedOpen.value = false
      }
      busy.value = false
    }
  },
)

function addPort() { form.ports.push({ host: '', container: '' }) }
function delPort(i: number) { form.ports.splice(i, 1) }
function addVol() { form.volumes.push({ source: '', destination: '', readOnly: false }) }
function delVol(i: number) { form.volumes.splice(i, 1) }
function addEnv() { form.env.push('') }
function delEnv(i: number) { form.env.splice(i, 1) }
function addCmdArg() { form.cmd.push('') }
function delCmdArg(i: number) { form.cmd.splice(i, 1) }

function pickImage(img: DockerImage) {
  form.image = `${img.repository}:${img.tag}`
  imagePickerOpen.value = false
}

const networkPickerOpen = ref(false)
const customNetInput = ref('')

/** 从已选列表移除某个网络;第一个会自动升为主网络 */
function delNet(i: number) {
  form.networks.splice(i, 1)
}
/** 追加网络到已选列表;去重,忽略空串 */
function addNet(name: string) {
  const n = name.trim()
  if (!n) return
  if (form.networks.includes(n)) return
  form.networks.push(n)
}
function pickNet(net: DockerNetwork) {
  addNet(net.name)
  networkPickerOpen.value = false
}
function submitCustomNet() {
  const n = customNetInput.value.trim()
  if (!n) return
  addNet(n)
  customNetInput.value = ''
  networkPickerOpen.value = false
}

/** 下拉候选:已存在网络里去掉已选 */
const networkOptions = computed(() => {
  const picked = new Set(form.networks)
  return props.networks.filter((n) => !picked.has(n.name)).slice(0, 200)
})

const imageOptions = computed(() =>
  props.images
    .filter((i) => i.repository !== '<none>' && i.tag !== '<none>')
    .slice(0, 200),
)

// clone 模式下新容器名不能与原容器相同(docker 名唯一)
// 只取 initialName(原始容器名),不能用 initial?.name(已被改写为 -clone 后缀)
const originalName = computed(() => (props.initialName || '').trim())
const nameConflict = computed(() =>
  props.mode === 'clone' &&
  !!form.name.trim() &&
  form.name.trim() === originalName.value,
)
const canSubmit = computed(() =>
  !!form.image.trim() &&
  !busy.value &&
  !nameConflict.value,
)

function buildSpec(): DockerRunSpec {
  const nets = form.networks.map((n) => n.trim()).filter(Boolean)
  const primary = nets[0]
  const extras = nets.slice(1)
  return {
    image: form.image.trim(),
    name: form.name.trim() || undefined,
    hostname: form.hostname.trim() || undefined,
    workingDir: form.workingDir.trim() || undefined,
    restartPolicy: form.restartPolicy && form.restartPolicy !== 'no' ? form.restartPolicy : undefined,
    networkMode: primary || undefined,
    additionalNetworks: extras.length ? extras : undefined,
    ports: form.ports
      .map((p) => ({ host: p.host.trim(), container: p.container.trim() }))
      .filter((p) => p.host && p.container),
    volumes: form.volumes
      .map((v) => ({ source: v.source.trim(), destination: v.destination.trim(), readOnly: v.readOnly }))
      .filter((v) => v.source && v.destination),
    env: form.env.map((e) => e.trim()).filter((e) => e.includes('=')),
    cmd: [...form.cmd],
    memory: form.memory.trim() || undefined,
    cpus: form.cpus.trim() || undefined,
    privileged: form.privileged,
    capAdd: [...form.capAdd],
    capDrop: [...form.capDrop],
    dns: [...form.dns],
    devices: form.devices.map((device) => ({ ...device })),
  }
}

async function submit() {
  if (!canSubmit.value) return
  if (props.mode === 'recreate') {
    await submitRecreate()
  } else if (props.mode === 'clone') {
    await submitClone()
  } else {
    await submitCreate()
  }
}

/** 把 docker run 输出的最后一行(通常是容器 ID)提取出来,用于后续 network connect 定位。
 * docker 可能会先输出拉镜像的进度,真正的 ID 一定在最末尾 */
function extractContainerId(runOut: string): string {
  const lines = runOut.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

/** 对已 run 起来的容器追加挂网络;每个 network connect 失败单独 toast 提示但不中断
 * (主要问题:网络不存在 / 已连接 / 驱动不兼容,不应因此让整个流程失败) */
async function attachExtraNetworks(target: string, nets: string[]) {
  for (const net of nets) {
    try {
      await dockerNetworkConnect(props.sessionId, net, target)
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e)
      toast.warning(`附加网络 ${net} 挂载失败:${msg}`)
    }
  }
}

async function submitCreate() {
  const spec = buildSpec()
  busy.value = true
  try {
    const out = await dockerRun(props.sessionId, spec)
    // docker run 成功返回容器 ID(短或长);失败会走 catch 或输出 Error:xxx
    if (/^Error/i.test(out)) throw new Error(out.trim())
    const cid = spec.name || extractContainerId(out)
    if (spec.additionalNetworks?.length && cid) {
      await attachExtraNetworks(cid, spec.additionalNetworks)
    }
    toast.success('容器已创建')
    emit('created')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '创建失败')
  } finally {
    busy.value = false
  }
}

function createBackupName(): string {
  return `kshell-backup-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

/** 重建期间保留旧容器备份,新容器及附加网络全部就绪后才删除备份。 */
async function submitRecreate() {
  const originalName = (props.initial?.name || props.initialName || '').trim()
  if (!originalName) {
    toast.error('缺少原容器名,无法定位需要停止的容器')
    return
  }

  const formSpec = buildSpec()
  const targetName = (formSpec.name ?? '').trim() || originalName
  const spec: DockerRunSpec = { ...formSpec, name: targetName }
  try {
    buildRunCommandFromSpec(spec)
  } catch (e: unknown) {
    toast.error(String(e), '配置校验失败')
    return
  }

  busy.value = true
  try {
    const result = await recreateContainerTransaction(
      {
        image: spec.image,
        originalName,
        targetName,
        backupName: createBackupName(),
        additionalNetworks: spec.additionalNetworks ?? [],
      },
      {
        pull: async (image) => {
          toast.info(`正在拉取 ${image}…`)
          await dockerPull(props.sessionId, image)
        },
        inspectState: async (container) => (await dockerInspect(props.sessionId, container)).state,
        exists: async (container) => dockerContainerExists(props.sessionId, container),
        stop: async (container) => {
          await dockerStop(props.sessionId, container)
        },
        rename: async (container, newName) => {
          await dockerRename(props.sessionId, container, newName)
        },
        run: async () => {
          const out = await dockerRun(props.sessionId, spec)
          if (/^Error/i.test(out)) throw new Error(out.trim())
        },
        connectNetwork: async (network, container) => {
          await dockerNetworkConnect(props.sessionId, network, container)
        },
        remove: async (container, force) => {
          await dockerRemove(props.sessionId, container, force)
        },
        start: async (container) => {
          await dockerStart(props.sessionId, container)
        },
      },
    )

    if (result.backupCleanupWarning) {
      toast.warning(result.backupCleanupWarning)
    }
    toast.success(`容器 ${targetName} 已重建`)
    emit('recreated')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '重建失败')
  } finally {
    busy.value = false
  }
}

/** 克隆容器流程：创建失败时清理新容器残留，并恢复被本流程停止的原容器。 */
async function submitClone() {
  const spec = buildSpec()
  const origName = originalName.value
  if (!origName) {
    toast.error('缺少原容器名,无法定位需要停止的容器')
    return
  }
  if (!spec.name) {
    toast.error('克隆模式必须指定新容器名')
    return
  }
  const targetName = spec.name
  try {
    buildRunCommandFromSpec(spec)
  } catch (e: unknown) {
    toast.error(String(e), '配置校验失败')
    return
  }

  busy.value = true
  try {
    await cloneContainerTransaction(
      {
        image: spec.image,
        originalName: origName,
        targetName,
        shouldPullImage: clonePullImage.value,
        shouldStopOriginal: cloneStopOriginal.value,
      },
      {
        exists: async (container) => dockerContainerExists(props.sessionId, container),
        pull: async (image) => {
          toast.info(`正在拉取 ${image}…`)
          await dockerPull(props.sessionId, image)
        },
        inspectState: async (container) => (await dockerInspect(props.sessionId, container)).state,
        stop: async (container) => {
          await dockerStop(props.sessionId, container)
        },
        run: async () => {
          const out = await dockerRun(props.sessionId, spec)
          if (/^Error/i.test(out)) throw new Error(out.trim())
        },
        remove: async (container, force) => {
          await dockerRemove(props.sessionId, container, force)
        },
        start: async (container) => {
          await dockerStart(props.sessionId, container)
        },
      },
    )

    if (spec.additionalNetworks?.length) {
      await attachExtraNetworks(targetName, spec.additionalNetworks)
    }

    const actions: string[] = ['新容器已启动']
    if (cloneStopOriginal.value) actions.push(`原容器 ${origName} 已停止保留`)
    else actions.push(`原容器 ${origName} 继续运行`)
    toast.success(actions.join('，'))
    emit('recreated')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '克隆失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-2xl w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gap-3">
      <DialogHeader class="min-w-0">
        <DialogTitle class="flex min-w-0 items-center gap-2">
          <PackageCheck v-if="mode === 'recreate'" class="size-4 text-primary" />
          <Copy v-else-if="mode === 'clone'" class="size-4 text-primary" />
          <PlusCircle v-else class="size-4" />
          <span v-if="mode === 'recreate'" class="truncate">
            更新并重建 · <span class="font-mono">{{ initialName || initial?.name || '' }}</span>
          </span>
          <span v-else-if="mode === 'clone'" class="truncate">
            克隆容器 · <span class="font-mono">{{ initialName || initial?.name || '' }}</span>
          </span>
          <span v-else>新建容器</span>
        </DialogTitle>
        <DialogDescription v-if="mode === 'recreate'" class="text-caption text-muted-foreground">
          已按当前容器配置预填,可编辑后提交。提交时会保留旧容器备份，新容器及附加网络就绪后再清理备份；失败会自动恢复旧容器。
          会自动保留特权模式、能力、DNS 与设备映射；其他未展示的运行参数仍可能无法还原。
        </DialogDescription>
        <DialogDescription v-else-if="mode === 'clone'" class="text-caption text-muted-foreground">
          基于当前容器配置创建新容器,不删除原容器。可勾选是否拉取最新镜像、是否停止原容器。
          新容器名必须不同；停止原容器后端口可复用，若克隆失败会自动恢复原容器。特权模式、能力、DNS 与设备映射会自动保留。
        </DialogDescription>
        <DialogDescription v-else class="sr-only">用 docker run 从镜像创建一个新容器</DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <!-- 基本:镜像 + 名称 + 重启策略 + 网络 -->
        <section class="space-y-2">
          <div>
            <Label class="mb-1 block text-caption text-muted-foreground">镜像 *</Label>
            <div class="flex items-center gap-1.5">
              <Input v-model="form.image" placeholder="如 nginx:latest 或 registry/repo:tag" class="h-7 text-body" />
              <DropdownMenu v-model:open="imagePickerOpen">
                <DropdownMenuTrigger as-child>
                  <Button variant="outline" size="sm" class="h-7 gap-1 px-2" :disabled="imageOptions.length === 0">
                    <Package class="size-3.5" />
                    <span class="text-body">选本地</span>
                    <ChevronDown class="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="max-w-[420px] max-h-[300px] overflow-y-auto">
                  <DropdownMenuItem
                    v-for="img in imageOptions"
                    :key="img.id"
                    class="font-mono text-caption"
                    @select="pickImage(img)"
                  >
                    {{ img.repository }}:{{ img.tag }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <Label class="mb-1 block text-caption text-muted-foreground">容器名(可选)</Label>
              <Input
                v-model="form.name"
                :placeholder="mode === 'clone' ? '必须输入新容器名' : '留空由 docker 自动生成'"
                class="h-7 text-body"
                :class="nameConflict && 'border-destructive focus-visible:ring-destructive'"
              />
              <p v-if="nameConflict" class="mt-1 text-caption text-destructive">
                新容器名不能与原容器相同
              </p>
            </div>
            <div>
              <Label class="mb-1 block text-caption text-muted-foreground">重启策略</Label>
              <Select v-model="form.restartPolicy">
                <SelectTrigger class="h-7 text-body">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">no(不自动重启)</SelectItem>
                  <SelectItem value="on-failure">on-failure(失败时重启)</SelectItem>
                  <SelectItem value="unless-stopped">unless-stopped</SelectItem>
                  <SelectItem value="always">always</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <!-- 网络:chip 列表 + 下拉添加;第一个自动作为 --network,其余 run 后 network connect -->
          <div>
            <div class="mb-1 flex items-center justify-between">
              <Label class="text-caption text-muted-foreground">网络</Label>
              <DropdownMenu v-model:open="networkPickerOpen">
                <DropdownMenuTrigger as-child>
                  <Button variant="outline" size="sm" class="h-6 gap-1 px-1.5">
                    <Plus class="size-3" />
                    <span class="text-caption">添加</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-[280px]">
                  <div class="p-1.5">
                    <div class="flex items-center gap-1">
                      <Input
                        v-model="customNetInput"
                        placeholder="自定义名 / host / container:xxx"
                        class="h-7 text-body"
                        @keydown.enter.prevent="submitCustomNet"
                      />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :disabled="!customNetInput.trim()"
                        @click="submitCustomNet"
                      >
                        <Plus class="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div v-if="networkOptions.length" class="max-h-[240px] overflow-y-auto border-t border-border pt-0.5">
                    <div class="px-2 py-1 text-caption text-muted-foreground">主机上已有网络</div>
                    <DropdownMenuItem
                      v-for="net in networkOptions"
                      :key="net.id || net.name"
                      class="flex items-center justify-between gap-2 font-mono text-caption"
                      @select="pickNet(net)"
                    >
                      <span class="truncate">{{ net.name }}</span>
                      <span class="shrink-0 text-muted-foreground">{{ net.driver }}</span>
                    </DropdownMenuItem>
                  </div>
                  <div v-else class="px-2 py-1.5 text-caption text-muted-foreground">
                    没有更多可选网络
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div
              v-if="form.networks.length === 0"
              class="rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-caption text-muted-foreground"
            >
              未指定,将使用 docker 默认(bridge)
            </div>
            <div v-else class="flex flex-wrap items-center gap-1.5">
              <div
                v-for="(n, i) in form.networks"
                :key="n + i"
                class="group inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 py-0.5 pl-1.5 pr-0.5 font-mono text-caption"
                :class="i === 0 && 'border-primary/40 bg-primary/10 text-primary'"
              >
                <NetworkIcon class="size-3" />
                <span>{{ n }}</span>
                <span
                  v-if="i === 0"
                  class="ml-1 rounded bg-primary/15 px-1 text-[10px] uppercase tracking-wide"
                  title="docker run --network 使用的主网络"
                >
                  primary
                </span>
                <button
                  type="button"
                  class="ml-0.5 flex size-4 items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive"
                  @click="delNet(i)"
                >
                  <X class="size-3" />
                </button>
              </div>
            </div>
            <div v-if="form.networks.length > 1" class="mt-1 text-caption text-muted-foreground">
              第一个作为 <span class="font-mono">--network</span>,其余在 run 后依次 <span class="font-mono">docker network connect</span>
            </div>
          </div>
        </section>

        <!-- clone 模式:拉取镜像 / 停止原容器 选项 -->
        <section v-if="mode === 'clone'" class="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <label class="flex cursor-pointer items-start gap-2">
            <input
              v-model="clonePullImage"
              type="checkbox"
              class="mt-0.5 size-3.5 accent-primary"
            />
            <div class="flex flex-col gap-0.5">
              <span class="text-body">拉取最新镜像</span>
              <span class="text-caption text-muted-foreground">
                勾选后先 docker pull 再启动;不勾则直接用本地缓存镜像
              </span>
            </div>
          </label>
          <label class="flex cursor-pointer items-start gap-2">
            <input
              v-model="cloneStopOriginal"
              type="checkbox"
              class="mt-0.5 size-3.5 accent-primary"
            />
            <div class="flex flex-col gap-0.5">
              <span class="text-body">停止原容器(不删除)</span>
              <span class="text-caption text-muted-foreground">
                勾选后停止原容器释放端口,便于回滚;不勾则原容器继续运行,宿主端口需修改避免冲突
              </span>
            </div>
          </label>
        </section>

        <!-- 端口映射 -->
        <section>
          <div class="mb-1 flex items-center justify-between">
            <Label class="text-caption text-muted-foreground">端口映射</Label>
            <Button variant="ghost" size="icon-sm" @click="addPort">
              <Plus class="size-3.5" />
            </Button>
          </div>
          <div v-if="form.ports.length === 0" class="rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-caption text-muted-foreground">
            暂无映射,点右上「+」新增
          </div>
          <div v-else class="space-y-1.5">
            <p v-if="mode === 'clone' && !cloneStopOriginal" class="text-caption text-warning">
              原容器仍在运行,宿主端口需修改避免冲突
            </p>
            <div v-for="(p, i) in form.ports" :key="i" class="flex items-center gap-1.5">
              <Input v-model="p.host" placeholder="宿主端口,如 8080 或 0.0.0.0:8080" class="h-7 text-body font-mono" />
              <span class="text-muted-foreground">→</span>
              <Input v-model="p.container" placeholder="容器端口,如 80 或 80/tcp" class="h-7 text-body font-mono" />
              <Button variant="ghost" size="icon-sm" @click="delPort(i)">
                <X class="size-3.5" />
              </Button>
            </div>
          </div>
        </section>

        <!-- 卷绑定 -->
        <section>
          <div class="mb-1 flex items-center justify-between">
            <Label class="text-caption text-muted-foreground">卷 / 目录挂载</Label>
            <Button variant="ghost" size="icon-sm" @click="addVol">
              <Plus class="size-3.5" />
            </Button>
          </div>
          <div v-if="form.volumes.length === 0" class="rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-caption text-muted-foreground">
            暂无挂载
          </div>
          <div v-else class="space-y-1.5">
            <div v-for="(v, i) in form.volumes" :key="i" class="flex items-center gap-1.5">
              <Input v-model="v.source" placeholder="宿主路径 或 命名卷" class="h-7 text-body font-mono" />
              <span class="text-muted-foreground">→</span>
              <Input v-model="v.destination" placeholder="容器内路径" class="h-7 text-body font-mono" />
              <Button
                variant="outline"
                size="sm"
                class="h-7 gap-1 px-2"
                :class="v.readOnly && 'bg-muted'"
                @click="v.readOnly = !v.readOnly"
                :title="v.readOnly ? '只读挂载' : '读写挂载(点切换只读)'"
              >
                {{ v.readOnly ? 'RO' : 'RW' }}
              </Button>
              <Button variant="ghost" size="icon-sm" @click="delVol(i)">
                <X class="size-3.5" />
              </Button>
            </div>
          </div>
        </section>

        <!-- 环境变量 -->
        <section>
          <div class="mb-1 flex items-center justify-between">
            <Label class="text-caption text-muted-foreground">环境变量</Label>
            <Button variant="ghost" size="icon-sm" @click="addEnv">
              <Plus class="size-3.5" />
            </Button>
          </div>
          <div v-if="form.env.length === 0" class="rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-caption text-muted-foreground">
            暂无环境变量
          </div>
          <div v-else class="space-y-1.5">
            <div v-for="(_, i) in form.env" :key="i" class="flex items-center gap-1.5">
              <Input v-model="form.env[i]" placeholder="KEY=VALUE" class="h-7 text-body font-mono" />
              <Button variant="ghost" size="icon-sm" @click="delEnv(i)">
                <X class="size-3.5" />
              </Button>
            </div>
          </div>
        </section>

        <!-- 高级(可折叠):hostname / workdir / memory / cpus / cmd -->
        <Collapsible v-model:open="advancedOpen">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="sm" class="h-7 w-full justify-start gap-1 px-2 text-caption">
              <ChevronDown class="size-3.5 transition-transform" :class="advancedOpen && 'rotate-180'" />
              高级选项
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="space-y-2 pt-2">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <Label class="mb-1 block text-caption text-muted-foreground">主机名</Label>
                <Input v-model="form.hostname" placeholder="默认为容器短 ID" class="h-7 text-body" />
              </div>
              <div>
                <Label class="mb-1 block text-caption text-muted-foreground">工作目录</Label>
                <Input v-model="form.workingDir" placeholder="容器内绝对路径" class="h-7 text-body font-mono" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <Label class="mb-1 block text-caption text-muted-foreground">内存限制</Label>
                <Input v-model="form.memory" placeholder="512m / 2g" class="h-7 text-body font-mono" />
              </div>
              <div>
                <Label class="mb-1 block text-caption text-muted-foreground">CPU 数</Label>
                <Input v-model="form.cpus" placeholder="1.5" class="h-7 text-body font-mono" />
              </div>
            </div>
            <div>
              <div class="mb-1 flex items-center justify-between">
                <div>
                  <Label class="block text-caption text-muted-foreground">命令参数 (CMD)</Label>
                  <p class="mt-0.5 text-caption text-muted-foreground">每项对应一个 argv 参数，空参数也会原样保留。</p>
                </div>
                <Button variant="ghost" size="icon-sm" title="添加命令参数" @click="addCmdArg">
                  <Plus class="size-3.5" />
                </Button>
              </div>
              <div v-if="form.cmd.length === 0" class="rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-caption text-muted-foreground">
                使用镜像默认命令
              </div>
              <div v-else class="space-y-1.5">
                <div v-for="(_, i) in form.cmd" :key="i" class="flex items-center gap-1.5">
                  <span class="w-6 shrink-0 text-right font-mono text-caption text-muted-foreground">{{ i }}</span>
                  <Input
                    v-model="form.cmd[i]"
                    :placeholder="i === 0 ? '可执行文件，如 sh' : '参数，可留空'"
                    class="h-7 text-body font-mono"
                  />
                  <Button variant="ghost" size="icon-sm" @click="delCmdArg(i)">
                    <X class="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter class="shrink-0">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">取消</Button>
        <Button variant="default" :disabled="!canSubmit" @click="submit">
          <template v-if="mode === 'recreate'">
            {{ busy ? '重建中…' : '拉取并重建' }}
          </template>
          <template v-else-if="mode === 'clone'">
            {{ busy ? '克隆中…' : '克隆容器' }}
          </template>
          <template v-else>
            {{ busy ? '创建中…' : 'docker run' }}
          </template>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
