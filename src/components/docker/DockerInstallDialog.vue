<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Download, Globe, Server } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/stores/toast'
import {
  dockerInstallCommand,
  dockerInstall,
  type DockerInstallMirror,
} from '@/api/docker'

const props = defineProps<{
  open: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 安装成功后触发,父组件可重新检测可用性 */
  (e: 'installed'): void
}>()

const mirror = ref<DockerInstallMirror>('aliyun')
const addUserToDockerGroup = ref(true)
const busy = ref(false)

// 镜像源选项
const MIRROR_OPTIONS: Array<{ value: DockerInstallMirror; label: string; hint: string }> = [
  { value: 'aliyun', label: '阿里云镜像', hint: '国内推荐,下载速度快' },
  { value: 'azure', label: 'Azure 中国镜像', hint: '国内备选' },
  { value: 'official', label: '官方源', hint: '海外主机推荐' },
]

// 实时显示将要执行的命令
const commandPreview = computed(() =>
  dockerInstallCommand({
    mirror: mirror.value,
    addUserToDockerGroup: addUserToDockerGroup.value,
  }),
)

// 打开时重置状态
watch(
  () => props.open,
  (v) => {
    if (v) {
      mirror.value = 'aliyun'
      addUserToDockerGroup.value = true
      busy.value = false
    }
  },
)

async function submit() {
  if (busy.value) return
  busy.value = true
  toast.info('正在安装 Docker,预计 1-3 分钟,请耐心等待…')
  try {
    const out = await dockerInstall(props.sessionId, {
      mirror: mirror.value,
      addUserToDockerGroup: addUserToDockerGroup.value,
    })
    // 脚本成功末尾通常有 "Docker version x.y.z" 之类;失败会含 "Error"
    if (/Error:/i.test(out) && !/Successfully/i.test(out)) {
      throw new Error(out.trim().split('\n').slice(-5).join('\n'))
    }
    toast.success('Docker 安装完成')
    if (addUserToDockerGroup.value) {
      toast.info('如需免 sudo 使用 docker,请断开并重新连接当前 SSH 会话以刷新用户组')
    }
    emit('installed')
    emit('update:open', false)
  } catch (e: unknown) {
    toast.error(String(e), '安装失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-xl w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Download class="size-4 text-primary" />
          安装 Docker
        </DialogTitle>
        <DialogDescription class="text-caption text-muted-foreground">
          使用 Docker 官方一键脚本(get.docker.com)在远端主机安装 Docker Engine,
          支持 CentOS / Ubuntu / Debian / RHEL 等主流发行版。
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <!-- 镜像源选择 -->
        <section class="space-y-2">
          <div>
            <Label class="mb-1 block text-caption text-muted-foreground">镜像源</Label>
            <Select v-model="mirror">
              <SelectTrigger class="h-8 text-body">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in MIRROR_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  <div class="flex flex-col">
                    <span>{{ opt.label }}</span>
                    <span class="text-caption text-muted-foreground">{{ opt.hint }}</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- 加入 docker 组 -->
          <label class="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
            <input
              v-model="addUserToDockerGroup"
              type="checkbox"
              class="mt-0.5 size-3.5 accent-primary"
            />
            <div class="flex flex-col gap-0.5">
              <span class="text-body">同时将当前用户加入 docker 组</span>
              <span class="text-caption text-muted-foreground">
                勾选后免 sudo 使用 docker;需要 sudo 权限,且安装完成后需重新连接 SSH 会话才生效
              </span>
            </div>
          </label>
        </section>

        <!-- 命令预览 -->
        <section>
          <div class="mb-1 flex items-center gap-1.5">
            <Server class="size-3.5 text-muted-foreground" />
            <Label class="text-caption text-muted-foreground">将执行的命令</Label>
          </div>
          <Textarea
            :model-value="commandPreview"
            readonly
            class="h-28 resize-none bg-muted/40 font-mono text-caption"
          />
        </section>

        <!-- 提示信息 -->
        <section class="rounded-md border border-border/60 bg-muted/20 p-2.5 text-caption text-muted-foreground">
          <div class="flex items-start gap-1.5">
            <Globe class="mt-0.5 size-3.5 shrink-0" />
            <div class="space-y-1">
              <p>· 非 root 用户需配置 sudo 免密,否则脚本可能在提权时卡住。</p>
              <p>· 安装完成后建议重新连接 SSH 会话以刷新环境变量与用户组。</p>
              <p>· 生产环境建议走包管理器方式安装以便精确控制版本,本入口为便捷安装。</p>
            </div>
          </div>
        </section>
      </div>

      <DialogFooter class="shrink-0">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">取消</Button>
        <Button variant="default" :disabled="busy" @click="submit">
          {{ busy ? '安装中…' : '执行安装' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
