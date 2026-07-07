<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Download, Globe, Server, KeyRound, AlertTriangle } from '@lucide/vue'
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
import { Input } from '@/components/ui/input'
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
// sudo 密码(可选):非 root 且无免密 sudo 时填入;经 env + printf | sudo -S 走 stdin
const sudoPassword = ref('')
const showSudo = ref(false)
// 失败时保留完整日志,便于排查并可重试
const errorLog = ref('')
const errorHint = ref('')

// 镜像源选项
const MIRROR_OPTIONS: Array<{ value: DockerInstallMirror; label: string; hint: string }> = [
  { value: 'aliyun', label: '阿里云镜像', hint: '国内推荐,下载速度快' },
  { value: 'tuna', label: '清华镜像', hint: '国内备选,稳定' },
  { value: 'ustc', label: '中科大镜像', hint: '国内备选' },
  { value: 'azure', label: 'Azure 中国镜像', hint: '国内备选' },
  { value: 'official', label: '官方源', hint: '海外主机推荐' },
]

// 实时显示将要执行的命令(密码用占位符替代,避免明文暴露)
const commandPreview = computed(() =>
  dockerInstallCommand({
    mirror: mirror.value,
    addUserToDockerGroup: addUserToDockerGroup.value,
    sudoPassword: showSudo.value && sudoPassword.value ? '<密码>' : undefined,
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
      sudoPassword.value = ''
      showSudo.value = false
      errorLog.value = ''
      errorHint.value = ''
    }
  },
)

/** 识别安装日志中的常见错误并给出中文建议 */
function diagnoseError(log: string): string {
  const tips: string[] = []
  if (/sudo:.*not found|sudo: command not found/i.test(log)) {
    tips.push('远端未安装 sudo;请用 root 用户连接,或让管理员安装 sudo。')
  }
  if (/sudo:.*incorrect password|Sorry, try again/i.test(log)) {
    tips.push('sudo 密码错误;请检查输入的 sudo 密码。')
  }
  if (/is not in the sudoers file|not allowed to execute/i.test(log)) {
    tips.push('当前用户无 sudo 权限;请用 root 连接,或让管理员把该用户加入 sudoers。')
  }
  if (/Unsupported (arch|distribution|operating system)|Your distribution|not supported/i.test(log)) {
    tips.push('get.docker.com 不支持该发行版/架构;请手动用发行版包管理器安装 Docker。')
  }
  if (/curl.*failed|Could not resolve host|Connection timed out|Network is unreachable/i.test(log)) {
    tips.push('网络不通或 DNS 解析失败;请检查远端网络,或换用国内镜像源重试。')
  }
  if (/Failed to fetch|404 Not Found|Hash Sum mismatch/i.test(log)) {
    tips.push('镜像源同步异常;可换其他镜像源重试。')
  }
  if (/command execution timed? out|超时/i.test(log)) {
    tips.push('命令执行超时;可能是远端在等待 sudo 密码或网络卡住,可填入 sudo 密码后重试。')
  }
  return tips.join('\n')
}

async function submit() {
  if (busy.value) return
  busy.value = true
  errorLog.value = ''
  errorHint.value = ''
  toast.info('正在安装 Docker,预计 1-3 分钟,请耐心等待…')
  try {
    const out = await dockerInstall(props.sessionId, {
      mirror: mirror.value,
      addUserToDockerGroup: addUserToDockerGroup.value,
      sudoPassword: showSudo.value && sudoPassword.value ? sudoPassword.value : undefined,
    })
    // 脚本成功末尾通常有 "Docker version x.y.z" / "Successfully" 之类;失败会含 "Error"
    if (/Error:/i.test(out) && !/Successfully/i.test(out)) {
      errorLog.value = out
      errorHint.value = diagnoseError(out)
      throw new Error(out.trim().split('\n').slice(-5).join('\n'))
    }
    toast.success('Docker 安装完成')
    if (addUserToDockerGroup.value) {
      toast.info('如需免 sudo 使用 docker,请断开并重新连接当前 SSH 会话以刷新用户组')
    }
    emit('installed')
    emit('update:open', false)
  } catch (e: unknown) {
    const msg = String(e)
    // 后端超时返回的字符串异常无完整日志,补进 errorLog
    if (!errorLog.value) errorLog.value = msg
    if (!errorHint.value) errorHint.value = diagnoseError(msg)
    toast.error(msg, '安装失败')
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

        <!-- sudo 密码(可折叠) -->
        <section class="space-y-2">
          <button
            type="button"
            class="flex w-full items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
            @click="showSudo = !showSudo"
          >
            <KeyRound class="size-3.5" />
            <span>{{ showSudo ? '隐藏 sudo 密码' : '当前用户无免密 sudo?点此填入密码' }}</span>
          </button>
          <div v-if="showSudo" class="space-y-1">
            <Input
              v-model="sudoPassword"
              type="password"
              placeholder="sudo 密码(留空表示远端已配免密)"
              class="h-8 font-mono"
              autocomplete="off"
            />
            <p class="text-caption text-muted-foreground">
              密码经环境变量注入 + stdin 传给 sudo,不会出现在命令行参数或 shell 历史中。
            </p>
          </div>
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

        <!-- 失败日志(有内容时显示) -->
        <section v-if="errorLog" class="space-y-2">
          <div class="flex items-center gap-1.5 text-destructive">
            <AlertTriangle class="size-3.5" />
            <span class="text-body font-medium">安装失败,完整日志如下</span>
          </div>
          <Textarea
            :model-value="errorLog"
            readonly
            class="h-40 resize-none bg-muted/40 font-mono text-caption"
          />
          <div v-if="errorHint" class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-caption">
            <div class="mb-1 flex items-center gap-1.5 font-medium text-amber-600">
              <AlertTriangle class="size-3.5" />
              可能的原因与建议
            </div>
            <pre class="whitespace-pre-wrap font-sans">{{ errorHint }}</pre>
          </div>
          <p class="text-caption text-muted-foreground">
            可调整上方参数后点击「重试」重新安装。
          </p>
        </section>

        <!-- 提示信息 -->
        <section class="rounded-md border border-border/60 bg-muted/20 p-2.5 text-caption text-muted-foreground">
          <div class="flex items-start gap-1.5">
            <Globe class="mt-0.5 size-3.5 shrink-0" />
            <div class="space-y-1">
              <p>· 非 root 用户若无免密 sudo,请在上方填入 sudo 密码,否则脚本可能在提权时卡住。</p>
              <p>· 安装完成后建议重新连接 SSH 会话以刷新环境变量与用户组。</p>
              <p>· 生产环境建议走包管理器方式安装以便精确控制版本,本入口为便捷安装。</p>
            </div>
          </div>
        </section>
      </div>

      <DialogFooter class="shrink-0">
        <Button variant="outline" :disabled="busy" @click="emit('update:open', false)">取消</Button>
        <Button variant="default" :disabled="busy" @click="submit">
          {{ busy ? '安装中…' : errorLog ? '重试安装' : '执行安装' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
