<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { PlusCircle, Plus, X, Package, ChevronDown, PackageCheck, Network as NetworkIcon } from '@lucide/vue'
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
  buildRunCommandFromSpec,
  type DockerImage,
  type DockerNetwork,
  type DockerRunSpec,
} from '@/api/docker'
import { sshExec } from '@/api/ssh'

const props = withDefaults(
  defineProps<{
    open: boolean
    sessionId: string
    /** 本地镜像列表,供 image 输入框旁的"选本地"下拉使用 */
    images: DockerImage[]
    /** 本地网络列表,供 "选网络" 下拉;传空数组则只保留手动输入 */
    networks?: DockerNetwork[]
    /** 弹窗模式:create=新建;recreate=用旧配置重建(预填 + stop/rm/run) */
    mode?: 'create' | 'recreate'
    /** recreate 模式下预填的配置(通常来自 inspectToRunSpec) */
    initial?: DockerRunSpec | null
    /** recreate 模式下用于展示的原始容器名(标题里显示) */
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
  cmd: string        // 空格分隔;split 时按 shell-like 简单切分
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
    cmd: '',
  }
}

/** 用 DockerRunSpec 预填表单;spec.cmd 数组重新拼回字符串,含空格的段落用 "" 括起 */
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
    cmd: spec.cmd.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
  }
}

const form = reactive<Form>(empty())
const busy = ref(false)
const advancedOpen = ref(false)
const imagePickerOpen = ref(false)

// 打开时按 mode 决定预填:create 清空;recreate 用 initial 填,并默认展开高级
watch(
  () => props.open,
  (v) => {
    if (v) {
      if (props.mode === 'recreate' && props.initial) {
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

/** 简易 shell 分词:双引号包起来的内容视为一段,其余空白分隔。够本地"直接粘 cmd"场景用。
 * 已知不覆盖:嵌套引号、转义序列;若用户需要更精细控制建议在 image 后另行手编 */
function splitCmd(raw: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[1] ?? m[2] ?? '')
  return out.filter((x) => x.length > 0)
}

const imageOptions = computed(() =>
  props.images
    .filter((i) => i.repository !== '<none>' && i.tag !== '<none>')
    .slice(0, 200),
)

const canSubmit = computed(() => !!form.image.trim() && !busy.value)

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
    cmd: splitCmd(form.cmd.trim()),
    memory: form.memory.trim() || undefined,
    cpus: form.cpus.trim() || undefined,
  }
}

async function submit() {
  if (!canSubmit.value) return
  if (props.mode === 'recreate') {
    await submitRecreate()
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
      const out = await sshExec(props.sessionId, `docker network connect ${net} ${target} 2>&1`)
      // docker network connect 成功输出为空;非空且含 Error 视为失败
      if (out && /error/i.test(out)) throw new Error(out.trim())
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

/** 重建流程:先在本地校验并组好 run 命令(避免 stop/rm 后再报错),再顺序执行
 * pull → stop → rm → run。stop/rm 若原容器已不存在或已停止,忽略对应错误继续。 */
async function submitRecreate() {
  const spec = buildSpec()
  // 用旧容器名做 stop/rm 参照;避免用户改名后无法定位原容器
  const originalName = (props.initial?.name || props.initialName || '').trim()
  if (!originalName) {
    toast.error('缺少原容器名,无法定位需要停止的容器')
    return
  }
  let runCmd: string
  try {
    runCmd = buildRunCommandFromSpec(spec)
  } catch (e: unknown) {
    toast.error(String(e), '配置校验失败')
    return
  }

  busy.value = true
  try {
    toast.info(`正在拉取 ${spec.image}…`)
    await sshExec(props.sessionId, `docker pull ${spec.image} 2>&1`)

    // stop:容器已停止时 docker 返回非零,吞掉这个错误
    try {
      await sshExec(props.sessionId, `docker stop ${originalName}`)
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e)
      if (!/is not running|No such container/i.test(msg)) throw e
    }

    // rm:容器已不存在时同样吞掉
    try {
      await sshExec(props.sessionId, `docker rm ${originalName}`)
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e)
      if (!/No such container/i.test(msg)) throw e
    }

    const out = await sshExec(props.sessionId, `${runCmd} 2>&1`)
    if (/^Error/i.test(out)) throw new Error(out.trim())
    const cid = spec.name || extractContainerId(out)
    if (spec.additionalNetworks?.length && cid) {
      await attachExtraNetworks(cid, spec.additionalNetworks)
    }
    toast.success(`容器 ${spec.name || originalName} 已重建`)
    emit('recreated')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '重建失败')
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
          <PlusCircle v-else class="size-4" />
          <span v-if="mode === 'recreate'" class="truncate">
            更新并重建 · <span class="font-mono">{{ initialName || initial?.name || '' }}</span>
          </span>
          <span v-else>新建容器</span>
        </DialogTitle>
        <DialogDescription v-if="mode === 'recreate'" class="text-caption text-muted-foreground">
          已按当前容器配置预填,可编辑后提交。提交时会依次执行 pull → stop → rm → run。
          仅覆盖弹窗内可编辑字段;--cap-add、--privileged、--dns、--device 等高级运行时字段不会保留。
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
              <Input v-model="form.name" placeholder="留空由 docker 自动生成" class="h-7 text-body" />
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
              <Label class="mb-1 block text-caption text-muted-foreground">命令 (CMD)</Label>
              <Input
                v-model="form.cmd"
                placeholder='覆盖镜像默认 CMD,空格分隔;含空格用 "" 括起,如 sh -c "echo hi"'
                class="h-7 text-body font-mono"
              />
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
          <template v-else>
            {{ busy ? '创建中…' : 'docker run' }}
          </template>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
