<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Loader2, KeyRound, Lock, Eye, EyeOff, FolderOpen } from 'lucide-vue-next'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { newConnectionPrefill, showNewConnection } from '@/stores/dialogs'
import { addTab, nextTabId } from '@/stores/tabs'
import { sshConnect, type SshConfig } from '@/api/ssh'
import {
  DEFAULT_GROUP_NAME,
  ensureDefaultGroup,
  findDuplicate,
  groupsRef,
  refreshAll,
  saveSession,
  type SaveSessionInput,
} from '@/stores/sessions'
import type { StoredSession } from '@/api/sessions'

// 特殊值:表示"不保存,仅本次连接"
const NO_SAVE = '__no_save__'
const DEFAULT_GROUP = '__default__'

const form = reactive({
  savedSessionId: '',
  name: '',
  host: '',
  port: 22,
  user: 'root',
  authKind: 'password' as 'password' | 'private_key',
  password: '',
  keyPath: '',
  passphrase: '',
  groupId: DEFAULT_GROUP as string,
})

const busy = ref(false)
const err = ref<string | null>(null)
const showPassword = ref(false)
const showPassphrase = ref(false)

// 编辑模式:预填了已保存会话时,标题/按钮变化
const isEditMode = computed(() => Boolean(form.savedSessionId))

// 当前组列表中是否存在真实数据库里的"默认分组"id(防止 select 里两个同名)
const defaultGroupOption = computed(() =>
  groupsRef.value.find((g) => g.name === DEFAULT_GROUP_NAME),
)

onMounted(() => {
  refreshAll().catch(() => {})
})

watch(showNewConnection, async (open) => {
  if (!open) return
  showPassword.value = false
  showPassphrase.value = false
  err.value = null
  const p = newConnectionPrefill.value
  if (p) {
    form.savedSessionId = p.id
    form.name = p.name
    form.host = p.host
    form.port = p.port
    form.user = p.username
    form.authKind = p.authKind
    form.keyPath = p.keyPath ?? ''
    // 凭据不持久化,每次都需重新输入
    form.password = ''
    form.passphrase = ''
    // 如果预填会话属于"默认分组",统一用 DEFAULT_GROUP 这个占位符
    const inDefault =
      p.groupId && groupsRef.value.find((g) => g.id === p.groupId)?.name === DEFAULT_GROUP_NAME
    form.groupId = inDefault ? DEFAULT_GROUP : (p.groupId ?? DEFAULT_GROUP)
  } else {
    reset()
  }
})

function reset() {
  form.savedSessionId = ''
  form.name = ''
  form.host = ''
  form.port = 22
  form.user = 'root'
  form.authKind = 'password'
  form.password = ''
  form.keyPath = ''
  form.passphrase = ''
  form.groupId = DEFAULT_GROUP
}

async function pickKeyFile() {
  try {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: '选择私钥文件',
      filters: [
        { name: '私钥', extensions: ['pem', 'key', 'ppk'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (typeof selected === 'string' && selected) {
      form.keyPath = selected
    }
  } catch {
    // 文件选择取消或失败,静默忽略
  }
}

async function submit() {
  err.value = null
  if (!form.host || !form.user) {
    err.value = '主机与用户名不能为空'
    return
  }

  busy.value = true
  try {
    const cfg: SshConfig = {
      host: form.host,
      port: Number(form.port) || 22,
      user: form.user,
      auth:
        form.authKind === 'password'
          ? { kind: 'password', password: form.password }
          : {
              kind: 'private_key',
              path: form.keyPath,
              passphrase: form.passphrase || null,
            },
    }
    const sessionId = await sshConnect(cfg)

    // 连接成功 → 入库(除非用户选了"不保存")
    if (form.groupId !== NO_SAVE) {
      const targetGroup =
        form.groupId === DEFAULT_GROUP
          ? (defaultGroupOption.value?.id ?? (await ensureDefaultGroup()))
          : form.groupId

      // 同组 + 同主机 + 同用户 + 同端口去重:命中则复用 id 更新,而不是新建
      const duplicate = findDuplicate(
        targetGroup,
        form.host,
        form.user,
        Number(form.port) || 22,
        form.savedSessionId,
      )

      try {
        const input: SaveSessionInput = {
          id: duplicate?.id || form.savedSessionId || undefined,
          groupId: targetGroup,
          name: form.name || `${form.user}@${form.host}`,
          host: form.host,
          port: Number(form.port) || 22,
          username: form.user,
          authKind: form.authKind,
          keyPath: form.authKind === 'private_key' ? form.keyPath : null,
          password: form.authKind === 'password' ? form.password || null : null,
          passphrase: form.authKind === 'private_key' ? form.passphrase || null : null,
        }
        const saved = await saveSession(input)
        // 新建连接后,把这个会话 id 绑定到 tab,侧栏才能显示"已打开"状态
        if (!form.savedSessionId) form.savedSessionId = saved.id
      } catch {
        // 入库失败不阻断终端 tab,仅不保存会话
      }
    }

    addTab({
      id: nextTabId('term'),
      type: 'terminal',
      title: form.name || `${form.user}@${form.host}`,
      sessionId,
      channelId: null,
      host: form.host,
      user: form.user,
      storedSessionId: form.groupId !== NO_SAVE ? form.savedSessionId : undefined,
    })
    showNewConnection.value = false
    reset()
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message ?? String(e)
    // 公钥校验失败已由 host-key 弹框自解释,不再重复提示
    if (msg.includes('主机公钥校验未通过')) return
    err.value = msg
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="showNewConnection">
    <DialogContent class="max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? '编辑 SSH 连接' : '新建 SSH 连接' }}</DialogTitle>
        <DialogDescription>
          {{ isEditMode
            ? '修改后保存并连接,已保存的密码会同步更新。'
            : '连接成功后会自动保存到所选分组,下次可直接双击复用。' }}
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-3" @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label for="name">名称(可选)</Label>
          <Input id="name" v-model="form.name" placeholder="例如 生产 web-01" />
        </div>

        <div class="grid grid-cols-[1fr_80px] gap-2">
          <div class="grid gap-1.5">
            <Label for="host">主机</Label>
            <Input id="host" v-model="form.host" placeholder="10.0.1.11 / example.com" />
          </div>
          <div class="grid gap-1.5">
            <Label for="port">端口</Label>
            <Input id="port" v-model.number="form.port" type="number" />
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="user">用户名</Label>
          <Input id="user" v-model="form.user" />
        </div>

        <div class="grid gap-1.5">
          <Label>认证方式</Label>
          <div class="flex gap-2">
            <button
              type="button"
              :class="cn(
                'flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                form.authKind === 'password'
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )"
              @click="form.authKind = 'password'"
            >
              <Lock class="size-3.5" /> 密码
            </button>
            <button
              type="button"
              :class="cn(
                'flex flex-1 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors',
                form.authKind === 'private_key'
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )"
              @click="form.authKind = 'private_key'"
            >
              <KeyRound class="size-3.5" /> 私钥
            </button>
          </div>
        </div>

        <div v-if="form.authKind === 'password'" class="grid gap-1.5">
          <Label for="password">密码</Label>
          <div class="relative">
            <Input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              class="pr-8"
            />
            <button
              type="button"
              class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              @click="showPassword = !showPassword"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              tabindex="-1"
            >
              <Eye v-if="!showPassword" class="size-3.5" />
              <EyeOff v-else class="size-3.5" />
            </button>
          </div>
        </div>

        <template v-else>
          <div class="grid gap-1.5">
            <Label for="keyPath">私钥文件</Label>
            <div class="flex gap-1.5">
              <Input
                id="keyPath"
                v-model="form.keyPath"
                placeholder="点右侧按钮选择,或手动粘贴路径"
                class="flex-1"
              />
              <Button type="button" variant="outline" size="icon" @click="pickKeyFile" title="浏览…">
                <FolderOpen />
              </Button>
            </div>
          </div>
          <div class="grid gap-1.5">
            <Label for="passphrase">Passphrase(可选)</Label>
            <div class="relative">
              <Input
                id="passphrase"
                v-model="form.passphrase"
                :type="showPassphrase ? 'text' : 'password'"
                class="pr-8"
              />
              <button
                type="button"
                class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                @click="showPassphrase = !showPassphrase"
                :title="showPassphrase ? '隐藏' : '显示'"
                tabindex="-1"
              >
                <Eye v-if="!showPassphrase" class="size-3.5" />
                <EyeOff v-else class="size-3.5" />
              </button>
            </div>
          </div>
        </template>

        <div class="grid gap-1.5">
          <Label for="groupId">保存到</Label>
          <Select v-model="form.groupId">
            <SelectTrigger id="groupId">
              <SelectValue placeholder="选择分组" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="DEFAULT_GROUP">{{ defaultGroupOption?.name ?? DEFAULT_GROUP_NAME }}</SelectItem>
              <SelectItem
                v-for="g in groupsRef.filter((g) => g.name !== DEFAULT_GROUP_NAME)"
                :key="g.id"
                :value="g.id"
              >{{ g.name }}</SelectItem>
              <SelectSeparator />
              <SelectItem :value="NO_SAVE">仅本次连接,不保存</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          v-if="err"
          class="rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
        >
          {{ err }}
        </div>

        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" :disabled="busy" @click="showNewConnection = false">
            取消
          </Button>
          <Button type="submit" :disabled="busy">
            <Loader2 v-if="busy" class="animate-spin" />
            {{ busy ? '连接中…' : (isEditMode ? '保存并连接' : '连接') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
