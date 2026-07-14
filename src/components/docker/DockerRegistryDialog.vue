<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { KeyRound, LogIn, LogOut, Eye, EyeOff, Info } from '@lucide/vue'
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
import { toast } from '@/stores/toast'
import { dockerLogin, dockerLogout, dockerListRegistries } from '@/api/docker'

import { LatestOperationGuard } from './latest-operation-guard'

const props = defineProps<{
  open: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const registry = ref('')
const username = ref('')
const password = ref('')
const showPw = ref(false)
const busy = ref(false)
const loggedIn = ref<string[]>([])
const listGuard = new LatestOperationGuard()
const actionGuard = new LatestOperationGuard()

function isDialogContextCurrent(sessionId: string): boolean {
  return props.open && props.sessionId === sessionId
}

function handleOpenChange(nextOpen: boolean) {
  if (!nextOpen && busy.value) return
  if (!nextOpen) listGuard.invalidate()
  emit('update:open', nextOpen)
}

// 打开时清空敏感字段并刷新已登录列表;registry / username 保留便于连试
watch(
  () => [props.open, props.sessionId] as const,
  ([open]) => {
    listGuard.invalidate()
    actionGuard.invalidate()
    password.value = ''
    showPw.value = false
    if (open) void refresh()
  },
  { immediate: true },
)

async function refresh() {
  const sessionId = props.sessionId
  const requestVersion = listGuard.begin()
  try {
    const registries = await dockerListRegistries(sessionId)
    if (listGuard.isCurrent(requestVersion) && isDialogContextCurrent(sessionId)) {
      loggedIn.value = registries
    }
  } catch (e: unknown) {
    if (listGuard.isCurrent(requestVersion) && isDialogContextCurrent(sessionId)) {
      loggedIn.value = []
      toast.error(String(e), '读取 Registry 登录列表失败')
    }
  }
}

const canLogin = computed(() => !busy.value && !!username.value.trim() && password.value.length > 0)

async function doLogin() {
  if (!canLogin.value) return
  const sessionId = props.sessionId
  const actionVersion = actionGuard.begin()
  busy.value = true
  try {
    await dockerLogin(sessionId, registry.value, username.value, password.value)
    if (!actionGuard.isCurrent(actionVersion) || !isDialogContextCurrent(sessionId)) return
    toast.success('登录成功', registry.value || 'Docker Hub')
    password.value = ''
    await refresh()
  } catch (e: unknown) {
    if (actionGuard.isCurrent(actionVersion) && isDialogContextCurrent(sessionId)) {
      toast.error(String(e), '登录失败')
    }
  } finally {
    busy.value = false
  }
}

async function doLogout(reg: string) {
  if (busy.value) return
  const sessionId = props.sessionId
  const actionVersion = actionGuard.begin()
  busy.value = true
  try {
    await dockerLogout(sessionId, normalizeForLogout(reg))
    if (!actionGuard.isCurrent(actionVersion) || !isDialogContextCurrent(sessionId)) return
    toast.success('已登出', reg)
    await refresh()
  } catch (e: unknown) {
    if (actionGuard.isCurrent(actionVersion) && isDialogContextCurrent(sessionId)) {
      toast.error(String(e), '登出失败')
    }
  } finally {
    busy.value = false
  }
}

// docker 存 Docker Hub 时的 key 是 "https://index.docker.io/v1/",登出参数需要传空(默认)或域名。
// 简化:含 index.docker.io 视为默认 Hub,传空串走默认。
function normalizeForLogout(key: string): string {
  return /index\.docker\.io/.test(key) ? '' : key.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** 显示用:把 docker 存的 URL key 缩成友好文本 */
function displayRegistry(key: string): string {
  if (/index\.docker\.io/.test(key)) return 'Docker Hub'
  return key.replace(/^https?:\/\//, '').replace(/\/$/, '')
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="max-w-md w-[92vw]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <KeyRound class="size-4" />
          <span>私有 Registry</span>
        </DialogTitle>
        <DialogDescription class="sr-only">Docker registry 登录 / 登出</DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <!-- 已登录列表 -->
        <div v-if="loggedIn.length">
          <Label class="mb-1 block text-caption text-muted-foreground">当前已登录</Label>
          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="r in loggedIn"
              :key="r"
              variant="secondary"
              class="gap-1 pr-1 font-mono text-caption"
            >
              <span>{{ displayRegistry(r) }}</span>
              <button
                type="button"
                class="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                :disabled="busy"
                :title="`登出 ${displayRegistry(r)}`"
                @click="doLogout(r)"
              >
                <LogOut class="size-3" />
              </button>
            </Badge>
          </div>
        </div>

        <div>
          <Label class="mb-1 block text-caption text-muted-foreground">Registry 地址</Label>
          <Input
            v-model="registry"
            placeholder="留空登录 Docker Hub;私有库如 registry.example.com:5000"
            class="h-7 text-body font-mono"
          />
        </div>
        <div>
          <Label class="mb-1 block text-caption text-muted-foreground">用户名</Label>
          <Input v-model="username" class="h-7 text-body font-mono" />
        </div>
        <div>
          <Label class="mb-1 block text-caption text-muted-foreground">密码 / Token</Label>
          <div class="relative">
            <Input
              v-model="password"
              :type="showPw ? 'text' : 'password'"
              class="h-7 pr-8 text-body font-mono"
              @keydown.enter="doLogin"
            />
            <button
              type="button"
              class="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
              :title="showPw ? '隐藏' : '显示'"
              @click="showPw = !showPw"
            >
              <Eye v-if="!showPw" class="size-3.5" />
              <EyeOff v-else class="size-3.5" />
            </button>
          </div>
        </div>

        <p class="flex items-start gap-1.5 rounded-md bg-muted/40 p-2 text-caption text-muted-foreground">
          <Info class="mt-0.5 size-3.5 shrink-0" />
          <span>
            KShell 不保存密码。登录成功后 docker 会把 auth token(不是明文)写到远端
            <code class="font-mono">~/.docker/config.json</code>,下次拉取镜像自动生效。
            不需要时请在上方点击对应 Badge 的登出按钮清理。
          </span>
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="handleOpenChange(false)">关闭</Button>
        <Button variant="default" :disabled="!canLogin" @click="doLogin">
          <LogIn class="size-3.5" />
          {{ busy ? '登录中…' : '登录' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
