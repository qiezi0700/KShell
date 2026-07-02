<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RefreshCw, Box, Package } from 'lucide-vue-next'
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
  dockerLogs,
  dockerRemoveImage,
  type DockerContainer,
  type DockerImage,
} from '@/api/docker'
import type { DockerTab } from '@/stores/tabs'
import DockerContainers from './DockerContainers.vue'
import DockerImages from './DockerImages.vue'
import DockerLogDialog from './DockerLogDialog.vue'

const props = defineProps<{ tab: DockerTab }>()

const sessionId = computed(() => props.tab.sessionId)
const state = useDockerSession(sessionId.value)

const subTab = ref<'containers' | 'images'>('containers')

// 日志查看状态(容器名 + 正文 + loading)
const logContainer = ref<string | null>(null)
const logText = ref('')
const logLoading = ref(false)

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

async function showLogs(c: DockerContainer) {
  logContainer.value = c.name
  logText.value = ''
  logLoading.value = true
  try {
    logText.value = await dockerLogs(sessionId.value, c.id, 200)
  } catch (e: unknown) {
    logText.value = `加载日志失败: ${String(e)}`
  } finally {
    logLoading.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
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
      </div>
      <span class="flex-1" />
      <span v-if="state?.version" class="text-caption text-muted-foreground">Docker {{ state.version.version }}</span>
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
      :error="state?.error ?? null"
      :available="state?.available ?? false"
      @start="doStart"
      @stop="doStop"
      @restart="doRestart"
      @remove="doRemove"
      @logs="showLogs"
      @retry="refreshDocker(sessionId)"
    />

    <!-- 镜像列表 -->
    <DockerImages
      v-show="subTab === 'images'"
      :images="state?.images ?? []"
      :loading="state?.loading ?? false"
      @remove="doRemoveImage"
    />

    <!-- 日志查看弹窗 -->
    <DockerLogDialog
      :open="logContainer !== null"
      :container="logContainer"
      :loading="logLoading"
      :text="logText"
      @update:open="(v) => { if (!v) logContainer = null }"
    />
  </div>
</template>
