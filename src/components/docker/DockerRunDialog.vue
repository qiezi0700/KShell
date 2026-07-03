<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
import { PlusCircle, Plus, X, Package, ChevronDown } from 'lucide-vue-next'
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
import { dockerRun, type DockerImage, type DockerRunSpec } from '@/api/docker'

const props = defineProps<{
  open: boolean
  sessionId: string
  /** 本地镜像列表,供 image 输入框旁的"选本地"下拉使用 */
  images: DockerImage[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'created'): void
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
  networkMode: string
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
    networkMode: '',
    memory: '',
    cpus: '',
    ports: [],
    volumes: [],
    env: [],
    cmd: '',
  }
}

const form = reactive<Form>(empty())
const busy = ref(false)
const advancedOpen = ref(false)
const imagePickerOpen = ref(false)

// 打开时重置表单;关闭不清,避免用户不小心点关又想继续
watch(
  () => props.open,
  (v) => {
    if (v) {
      Object.assign(form, empty())
      busy.value = false
      advancedOpen.value = false
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

async function submit() {
  if (!canSubmit.value) return
  const spec: DockerRunSpec = {
    image: form.image.trim(),
    name: form.name.trim() || undefined,
    hostname: form.hostname.trim() || undefined,
    workingDir: form.workingDir.trim() || undefined,
    restartPolicy: form.restartPolicy && form.restartPolicy !== 'no' ? form.restartPolicy : undefined,
    networkMode: form.networkMode.trim() || undefined,
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
  busy.value = true
  try {
    const out = await dockerRun(props.sessionId, spec)
    // docker run 成功返回容器 ID(短或长);失败会走 catch 或输出 Error:xxx
    if (/^Error/i.test(out)) throw new Error(out.trim())
    toast.success('容器已创建')
    emit('created')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '创建失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-2xl w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <PlusCircle class="size-4" />
          <span>新建容器</span>
        </DialogTitle>
        <DialogDescription class="sr-only">用 docker run 从镜像创建一个新容器</DialogDescription>
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
          <div>
            <Label class="mb-1 block text-caption text-muted-foreground">网络(可选)</Label>
            <Input v-model="form.networkMode" placeholder="host / bridge / 自定义网络名;留空使用默认" class="h-7 text-body" />
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
          {{ busy ? '创建中…' : 'docker run' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
