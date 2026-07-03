<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RefreshCw, Box, Package, HardDrive, Network, Layers } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { toast } from '@/stores/toast'
import { openConfirm } from '@/stores/prompt'
import { useDockerSession, startDocker, clearDocker, refreshDocker } from '@/stores/docker'
import {
  dockerStart,
  dockerStop,
  dockerRestart,
  dockerRemove,
  dockerRemoveImage,
  dockerInspect,
  dockerImageInspect,
  dockerImageHistory,
  dockerPull,
  dockerRecreate,
  dockerRemoveVolume,
  dockerPruneVolumes,
  dockerInspectVolume,
  dockerRemoveNetwork,
  dockerPruneNetworks,
  dockerInspectNetwork,
  dockerStackUp,
  dockerStackDown,
  dockerStackRestart,
  dockerStackDeploy,
  type DockerContainer,
  type DockerImage,
  type DockerImageInspect,
  type DockerImageLayer,
  type DockerInspect,
  type DockerVolume,
  type DockerNetwork,
  type DockerStack,
} from '@/api/docker'
import { addTab, nextTabId, type DockerTab } from '@/stores/tabs'
import DockerContainers from './DockerContainers.vue'
import DockerImages from './DockerImages.vue'
import DockerVolumes from './DockerVolumes.vue'
import DockerNetworks from './DockerNetworks.vue'
import DockerStacks from './DockerStacks.vue'
import DockerLogDialog from './DockerLogDialog.vue'
import DockerInspectDialog from './DockerInspectDialog.vue'
import DockerRawInspectDialog from './DockerRawInspectDialog.vue'
import DockerSystemDialog from './DockerSystemDialog.vue'
import DockerRunDialog from './DockerRunDialog.vue'
import DockerContainerEditDialog from './DockerContainerEditDialog.vue'
import DockerImageInspectDialog from './DockerImageInspectDialog.vue'
import DockerRegistryDialog from './DockerRegistryDialog.vue'

const props = defineProps<{ tab: DockerTab }>()

const sessionId = computed(() => props.tab.sessionId)
const state = useDockerSession(sessionId.value)

const subTab = ref<'containers' | 'images' | 'volumes' | 'networks' | 'stacks'>('containers')

// 日志弹窗只保留目标容器,正文/loading/流式全在弹窗内部管理
const logContainer = ref<string | null>(null)
const logContainerId = ref<string | null>(null)

// 系统清理弹窗开关
const systemOpen = ref(false)

// 正在执行 up/down/restart 的 stack 名集合
const stackBusy = ref<Set<string>>(new Set())
function setStackBusy(name: string, on: boolean) {
  const next = new Set(stackBusy.value)
  if (on) next.add(name)
  else next.delete(name)
  stackBusy.value = next
}

// 卷/网络共用一个原始 JSON 详情弹窗;subject 用于标题,rawData 是 inspect 结果
const rawInspectOpen = ref(false)
const rawInspectTitle = ref('详情')
const rawInspectSubject = ref<string | null>(null)
const rawInspectData = ref<Record<string, unknown> | null>(null)
const rawInspectLoading = ref(false)

// 详情查看状态(容器名 + 数据 + loading)
const inspectContainer = ref<string | null>(null)
const inspectData = ref<DockerInspect | null>(null)
const inspectLoading = ref(false)

// 新建容器向导
const runOpen = ref(false)

// 容器编辑弹窗;editInspect 非空即视为打开
const editInspect = ref<DockerInspect | null>(null)

// 镜像详情弹窗
const imageInspectOpen = ref(false)
const imageInspectRef = ref<string | null>(null)
const imageInspectData = ref<DockerImageInspect | null>(null)
const imageInspectHistory = ref<DockerImageLayer[]>([])
const imageInspectLoading = ref(false)

// Registry 登录弹窗
const registryOpen = ref(false)

// 正在拉取的镜像引用集合(如 nginx:latest),供 DockerImages 显示行内 spin
const pullingRefs = ref<Set<string>>(new Set())
function setPulling(ref: string, on: boolean) {
  const next = new Set(pullingRefs.value)
  if (on) next.add(ref)
  else next.delete(ref)
  pullingRefs.value = next
}

// 正在重建的容器 ID 集合,供 DockerContainers 行内 spin/禁用
const recreatingIds = ref<Set<string>>(new Set())
function setRecreating(id: string, on: boolean) {
  const next = new Set(recreatingIds.value)
  if (on) next.add(id)
  else next.delete(id)
  recreatingIds.value = next
}

onMounted(() => {
  startDocker(sessionId.value)
})

// tab 关闭时停止轮询并清空数据,避免残留占用与无效请求
onBeforeUnmount(() => {
  clearDocker(sessionId.value)
})

async function doStart(c: DockerContainer) {
  try {
    await dockerStart(sessionId.value, c.id)
    toast.success(`容器 ${c.name} 已启动`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '启动失败')
  }
}

async function doStop(c: DockerContainer) {
  try {
    await dockerStop(sessionId.value, c.id)
    toast.success(`容器 ${c.name} 已停止`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '停止失败')
  }
}

async function doRestart(c: DockerContainer) {
  try {
    await dockerRestart(sessionId.value, c.id)
    toast.success(`容器 ${c.name} 已重启`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '重启失败')
  }
}

async function doRemove(c: DockerContainer) {
  const ok = await openConfirm({
    title: '删除容器',
    message: `确定删除容器「${c.name}」吗?运行中的容器将被强制删除。`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await dockerRemove(sessionId.value, c.id, true)
    toast.info(`容器 ${c.name} 已删除`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '删除失败')
  }
}

async function doPullImage(ref: string) {
  // 拉取时间不定,先提示已开始,完成再给成功/失败;并发拉取靠 pullingRefs 集合区分
  if (pullingRefs.value.has(ref)) return
  setPulling(ref, true)
  toast.info(`正在拉取 ${ref}…`)
  try {
    await dockerPull(sessionId.value, ref)
    toast.success(`已拉取 ${ref}`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '拉取失败')
  } finally {
    setPulling(ref, false)
  }
}

function doUpdateImage(img: DockerImage) {
  // 「更新」= 用同名 tag 重新拉取;<none> 标签无法拉取,直接提示
  if (!img.repository || img.repository === '<none>' || !img.tag || img.tag === '<none>') {
    toast.warning('该镜像没有可用的仓库名/标签,无法更新')
    return
  }
  doPullImage(`${img.repository}:${img.tag}`)
}

async function doRemoveVolume(v: DockerVolume) {
  const ok = await openConfirm({
    title: '删除卷',
    message: `确定删除卷「${v.name}」吗?卷中数据将永久丢失,不可恢复。`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await dockerRemoveVolume(sessionId.value, v.name)
    toast.info(`卷 ${v.name} 已删除`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '删除失败')
  }
}

async function doPruneVolumes() {
  const ok = await openConfirm({
    title: '清理未使用的卷',
    message: '将删除所有当前没有容器引用的卷。卷中数据不可恢复,是否继续?',
    confirmText: '清理',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    const out = await dockerPruneVolumes(sessionId.value)
    const m = out.match(/Total reclaimed space:\s*([^\n]+)/i)
    toast.success(m ? `已回收 ${m[1].trim()}` : '清理完成')
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '清理失败')
  }
}

async function showVolumeInspect(v: DockerVolume) {
  rawInspectTitle.value = '卷详情'
  rawInspectSubject.value = v.name
  rawInspectData.value = null
  rawInspectOpen.value = true
  rawInspectLoading.value = true
  try {
    rawInspectData.value = await dockerInspectVolume(sessionId.value, v.name)
  } catch (e: unknown) {
    toast.error(String(e), '加载卷详情失败')
    rawInspectOpen.value = false
  } finally {
    rawInspectLoading.value = false
  }
}

async function doRemoveNetwork(n: DockerNetwork) {
  const ok = await openConfirm({
    title: '删除网络',
    message: `确定删除网络「${n.name}」吗?附着在此网络上的容器会失联。`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await dockerRemoveNetwork(sessionId.value, n.id)
    toast.info(`网络 ${n.name} 已删除`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '删除失败')
  }
}

async function doPruneNetworks() {
  const ok = await openConfirm({
    title: '清理未使用的网络',
    message: '将删除所有当前没有容器连接的自定义网络(内置 bridge/host/none 保留)。是否继续?',
    confirmText: '清理',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await dockerPruneNetworks(sessionId.value)
    toast.success('清理完成')
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '清理失败')
  }
}

async function doStackUp(s: DockerStack) {
  if (stackBusy.value.has(s.name)) return
  setStackBusy(s.name, true)
  toast.info(`正在启动 stack ${s.name}…`)
  try {
    await dockerStackUp(sessionId.value, s)
    toast.success(`stack ${s.name} 已启动`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '启动失败')
  } finally {
    setStackBusy(s.name, false)
  }
}

async function doStackDown(s: DockerStack) {
  const ok = await openConfirm({
    title: '停止并删除 stack',
    message: `将执行 docker compose down,停止并删除 stack「${s.name}」的所有容器与网络(卷保留)。是否继续?`,
    confirmText: 'down',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  if (stackBusy.value.has(s.name)) return
  setStackBusy(s.name, true)
  try {
    await dockerStackDown(sessionId.value, s)
    toast.info(`stack ${s.name} 已停止`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), 'down 失败')
  } finally {
    setStackBusy(s.name, false)
  }
}

async function doStackRestart(s: DockerStack) {
  if (stackBusy.value.has(s.name)) return
  setStackBusy(s.name, true)
  try {
    await dockerStackRestart(sessionId.value, s)
    toast.success(`stack ${s.name} 已重启`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '重启失败')
  } finally {
    setStackBusy(s.name, false)
  }
}

async function doStackDeploy(path: string) {
  if (stackBusy.value.has(path)) return
  setStackBusy(path, true)
  toast.info(`正在部署 ${path}…`)
  try {
    await dockerStackDeploy(sessionId.value, path)
    toast.success('部署完成')
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '部署失败')
  } finally {
    setStackBusy(path, false)
  }
}

async function showNetworkInspect(n: DockerNetwork) {
  rawInspectTitle.value = '网络详情'
  rawInspectSubject.value = n.name
  rawInspectData.value = null
  rawInspectOpen.value = true
  rawInspectLoading.value = true
  try {
    rawInspectData.value = await dockerInspectNetwork(sessionId.value, n.id)
  } catch (e: unknown) {
    toast.error(String(e), '加载网络详情失败')
    rawInspectOpen.value = false
  } finally {
    rawInspectLoading.value = false
  }
}

async function doRemoveImage(img: DockerImage) {
  const ok = await openConfirm({
    title: '删除镜像',
    message: `确定删除镜像「${img.repository}:${img.tag}」吗?`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await dockerRemoveImage(sessionId.value, img.id)
    toast.info('镜像已删除')
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '删除失败')
  }
}

function showLogs(c: DockerContainer) {
  logContainer.value = c.name
  logContainerId.value = c.id
}

async function showInspect(c: DockerContainer) {
  inspectContainer.value = c.name
  inspectData.value = null
  inspectLoading.value = true
  try {
    inspectData.value = await dockerInspect(sessionId.value, c.id)
  } catch (e: unknown) {
    toast.error(String(e), '加载详情失败')
    inspectContainer.value = null
  } finally {
    inspectLoading.value = false
  }
}

async function doRecreate(c: DockerContainer) {
  if (recreatingIds.value.has(c.id)) return
  // 先取一次 inspect,拿到当前镜像 tag 和完整配置(重建后用同样参数 docker run)
  let insp
  try {
    insp = await dockerInspect(sessionId.value, c.id)
  } catch (e: unknown) {
    toast.error(String(e), '读取容器配置失败')
    return
  }
  if (!insp.image || insp.image.startsWith('sha256:')) {
    // 镜像被引用为纯 digest 时无法确定 tag,pull 无从下手
    toast.warning('该容器绑定的是镜像 digest,无法自动拉取更新')
    return
  }
  const ok = await openConfirm({
    title: '更新并重建容器',
    message:
      `将执行:pull ${insp.image} → stop → rm → 用同名同配置重新 run 「${insp.name}」。\n` +
      '重建期间会有短暂停机;仅覆盖常见字段(端口/卷/环境变量/网络/重启策略/CMD),' +
      '不覆盖 --entrypoint 覆盖、资源限制、健康检查等高级配置。是否继续?',
    confirmText: '更新并重建',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return

  setRecreating(c.id, true)
  toast.info(`正在重建 ${insp.name}…`)
  try {
    await dockerRecreate(sessionId.value, insp)
    toast.success(`容器 ${insp.name} 已用最新镜像重建`)
    refreshDocker(sessionId.value)
  } catch (e: unknown) {
    toast.error(String(e), '重建失败')
  } finally {
    setRecreating(c.id, false)
  }
}

async function doEdit(c: DockerContainer) {
  // 编辑弹窗要拿当前 memoryBytes/cpus/restartPolicy 做默认值,先取一次 inspect
  try {
    editInspect.value = await dockerInspect(sessionId.value, c.id)
  } catch (e: unknown) {
    toast.error(String(e), '读取容器配置失败')
  }
}

async function showImageInspect(img: DockerImage) {
  const refText = img.repository !== '<none>' && img.tag !== '<none>'
    ? `${img.repository}:${img.tag}`
    : img.id
  imageInspectRef.value = refText
  imageInspectData.value = null
  imageInspectHistory.value = []
  imageInspectOpen.value = true
  imageInspectLoading.value = true
  try {
    // inspect + history 并行拉取;history 失败不阻断 inspect 展示
    const [insp, hist] = await Promise.allSettled([
      dockerImageInspect(sessionId.value, img.id),
      dockerImageHistory(sessionId.value, img.id),
    ])
    if (insp.status === 'fulfilled') imageInspectData.value = insp.value
    else throw insp.reason
    if (hist.status === 'fulfilled') imageInspectHistory.value = hist.value
  } catch (e: unknown) {
    toast.error(String(e), '加载镜像详情失败')
    imageInspectOpen.value = false
  } finally {
    imageInspectLoading.value = false
  }
}

// 进容器交互终端:优先 sh(几乎所有镜像都有),失败提示手动切 bash
function doExec(c: DockerContainer) {
  const cmd = `docker exec -it ${c.id} sh`
  addTab({
    id: nextTabId('t'),
    type: 'terminal',
    title: `${c.name} · sh`,
    sessionId: sessionId.value,
    channelId: null,
    host: props.tab.host,
    user: props.tab.user,
    command: cmd,
  })
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- 工具栏 -->
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <div class="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
        <button
          class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-body transition-colors"
          :class="subTab === 'containers' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="subTab = 'containers'"
        >
          <Box class="size-3.5" />
          容器
          <Badge v-if="state?.containers.length" variant="secondary" class="ml-0.5 text-caption">{{ state.containers.length }}</Badge>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-body transition-colors"
          :class="subTab === 'images' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="subTab = 'images'"
        >
          <Package class="size-3.5" />
          镜像
          <Badge v-if="state?.images.length" variant="secondary" class="ml-0.5 text-caption">{{ state.images.length }}</Badge>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-body transition-colors"
          :class="subTab === 'volumes' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="subTab = 'volumes'"
        >
          <HardDrive class="size-3.5" />
          卷
          <Badge v-if="state?.volumes.length" variant="secondary" class="ml-0.5 text-caption">{{ state.volumes.length }}</Badge>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-body transition-colors"
          :class="subTab === 'networks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="subTab = 'networks'"
        >
          <Network class="size-3.5" />
          网络
          <Badge v-if="state?.networks.length" variant="secondary" class="ml-0.5 text-caption">{{ state.networks.length }}</Badge>
        </button>
        <button
          class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-body transition-colors"
          :class="subTab === 'stacks' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
          @click="subTab = 'stacks'"
        >
          <Layers class="size-3.5" />
          Compose
          <Badge v-if="state?.stacks.length" variant="secondary" class="ml-0.5 text-caption">{{ state.stacks.length }}</Badge>
        </button>
      </div>
      <span class="flex-1" />
      <span v-if="state?.version" class="text-caption text-muted-foreground">Docker {{ state.version.version }}</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" @click="systemOpen = true">
            <HardDrive class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>磁盘占用与清理</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" :disabled="state?.loading" @click="refreshDocker(sessionId)">
            <RefreshCw class="size-3.5" :class="state?.loading && 'animate-spin'" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>刷新</TooltipContent>
      </Tooltip>
    </div>

    <!-- 容器列表 -->
    <DockerContainers
      v-show="subTab === 'containers'"
      :containers="state?.containers ?? []"
      :loading="state?.loading ?? false"
      :error="state?.containersError ?? null"
      :available="state?.available ?? false"
      :stats="state?.stats ?? {}"
      :recreating="recreatingIds"
      @start="doStart"
      @stop="doStop"
      @restart="doRestart"
      @remove="doRemove"
      @logs="showLogs"
      @inspect="showInspect"
      @exec="doExec"
      @recreate="doRecreate"
      @edit="doEdit"
      @create="runOpen = true"
      @retry="refreshDocker(sessionId)"
    />

    <!-- 镜像列表 -->
    <DockerImages
      v-show="subTab === 'images'"
      :images="state?.images ?? []"
      :containers="state?.containers ?? []"
      :loading="state?.loading ?? false"
      :error="state?.imagesError ?? null"
      :available="state?.available ?? false"
      :pulling="pullingRefs"
      @remove="doRemoveImage"
      @retry="refreshDocker(sessionId)"
      @pull="doPullImage"
      @update="doUpdateImage"
      @inspect="showImageInspect"
      @registry="registryOpen = true"
      @container-click="subTab = 'containers'; showLogs($event)"
    />

    <!-- 卷列表 -->
    <DockerVolumes
      v-show="subTab === 'volumes'"
      :volumes="state?.volumes ?? []"
      :loading="state?.loading ?? false"
      :error="state?.volumesError ?? null"
      :available="state?.available ?? false"
      @remove="doRemoveVolume"
      @inspect="showVolumeInspect"
      @prune="doPruneVolumes"
      @retry="refreshDocker(sessionId)"
    />

    <!-- 网络列表 -->
    <DockerNetworks
      v-show="subTab === 'networks'"
      :networks="state?.networks ?? []"
      :loading="state?.loading ?? false"
      :error="state?.networksError ?? null"
      :available="state?.available ?? false"
      @remove="doRemoveNetwork"
      @inspect="showNetworkInspect"
      @prune="doPruneNetworks"
      @retry="refreshDocker(sessionId)"
    />

    <!-- Compose stack 列表 -->
    <DockerStacks
      v-show="subTab === 'stacks'"
      :stacks="state?.stacks ?? []"
      :loading="state?.loading ?? false"
      :error="state?.stacksError ?? null"
      :available="state?.available ?? false"
      :busy="stackBusy"
      @up="doStackUp"
      @down="doStackDown"
      @restart="doStackRestart"
      @deploy="doStackDeploy"
      @retry="refreshDocker(sessionId)"
    />

    <!-- 日志查看弹窗:自持有 loading/正文/流式跟随/过滤 -->
    <DockerLogDialog
      :open="logContainer !== null"
      :session-id="sessionId"
      :container-id="logContainerId"
      :container-name="logContainer"
      @update:open="(v) => { if (!v) { logContainer = null; logContainerId = null } }"
    />

    <!-- 详情查看弹窗 -->
    <DockerInspectDialog
      :open="inspectContainer !== null"
      :container="inspectContainer"
      :loading="inspectLoading"
      :data="inspectData"
      @update:open="(v) => { if (!v) inspectContainer = null }"
    />

    <!-- 卷/网络原始 JSON 详情弹窗 -->
    <DockerRawInspectDialog
      :open="rawInspectOpen"
      :title="rawInspectTitle"
      :subject="rawInspectSubject"
      :loading="rawInspectLoading"
      :data="rawInspectData"
      @update:open="rawInspectOpen = $event"
    />

    <!-- 系统清理弹窗 -->
    <DockerSystemDialog
      :open="systemOpen"
      :session-id="sessionId"
      @update:open="systemOpen = $event"
      @pruned="refreshDocker(sessionId)"
    />

    <!-- 新建容器向导 -->
    <DockerRunDialog
      :open="runOpen"
      :session-id="sessionId"
      :images="state?.images ?? []"
      @update:open="runOpen = $event"
      @created="refreshDocker(sessionId)"
    />

    <!-- 容器编辑(改名 / 资源限制) -->
    <DockerContainerEditDialog
      :open="editInspect !== null"
      :session-id="sessionId"
      :inspect="editInspect"
      @update:open="(v) => { if (!v) editInspect = null }"
      @updated="refreshDocker(sessionId)"
    />

    <!-- 镜像详情 + 构建层 -->
    <DockerImageInspectDialog
      :open="imageInspectOpen"
      :image-ref="imageInspectRef"
      :loading="imageInspectLoading"
      :data="imageInspectData"
      :history="imageInspectHistory"
      @update:open="imageInspectOpen = $event"
    />

    <!-- 私有 Registry 登录 / 登出 -->
    <DockerRegistryDialog
      :open="registryOpen"
      :session-id="sessionId"
      @update:open="registryOpen = $event"
    />
  </div>
</template>
