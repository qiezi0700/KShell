<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Loader2, KeyRound, Lock, Eye, EyeOff, FolderOpen, Cpu, MessageSquareText } from 'lucide-vue-next'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, Network } from 'lucide-vue-next'
import { newConnectionPrefill, showNewConnection } from '@/stores/dialogs'
import { addTab, nextTabId } from '@/stores/tabs'
import { sshConnect, type SshConfig } from '@/api/ssh'
import { keys as sshKeys, refreshKeys, openKeyManager } from '@/stores/keys'
import { sshKeyPassphrase } from '@/api/keys'
import {
  DEFAULT_GROUP_NAME,
  ensureDefaultGroup,
  findDuplicate,
  groupsRef,
  refreshAll,
  saveSession,
  type SaveSessionInput,
} from '@/stores/sessions'
import type { AuthKind, StoredSession } from '@/api/sessions'

// 特殊值:表示"不保存,仅本次连接"
const NO_SAVE = '__no_save__'
const DEFAULT_GROUP = '__default__'

const form = reactive({
  savedSessionId: '',
  name: '',
  host: '',
  port: 22,
  user: 'root',
  authKind: 'password' as AuthKind,
  password: '',
  keyPath: '',
  passphrase: '',
  groupId: DEFAULT_GROUP as string,
  // 代理跳板(凭据不保存)
  useJump: false,
  jumpHost: '',
  jumpPort: 22,
  jumpUser: 'root',
  jumpAuthKind: 'password' as AuthKind,
  jumpPassword: '',
  jumpKeyPath: '',
  jumpPassphrase: '',
})

const busy = ref(false)
const err = ref<string | null>(null)
const showPassword = ref(false)
const showPassphrase = ref(false)
const showJumpPassword = ref(false)
const showJumpPassphrase = ref(false)
// 从密钥库选择的密钥 id;空串表示手动指定路径
const selectedKeyId = ref('')

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
  showJumpPassword.value = false
  showJumpPassphrase.value = false
  selectedKeyId.value = ''
  err.value = null
  refreshKeys().catch(() => {})
  const p = newConnectionPrefill.value
  if (p) {
    form.savedSessionId = p.id
    form.name = p.name
    form.host = p.host
    form.port = p.port
    form.user = p.username
    form.authKind = p.authKind
    form.keyPath = p.keyPath ?? ''
    form.useJump = Boolean(p.jumpHost)
    form.jumpHost = p.jumpHost ?? ''
    form.jumpPort = p.jumpPort || 22
    form.jumpUser = p.jumpUsername ?? 'root'
    form.jumpAuthKind = p.jumpAuthKind ?? 'password'
    form.jumpKeyPath = p.jumpKeyPath ?? ''
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
  selectedKeyId.value = ''
  form.useJump = false
  form.jumpHost = ''
  form.jumpPort = 22
  form.jumpUser = 'root'
  form.jumpAuthKind = 'password'
  form.jumpPassword = ''
  form.jumpKeyPath = ''
  form.jumpPassphrase = ''
}

async function pickKeyFile(target: 'main' | 'jump' = 'main') {
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
      if (target === 'jump') {
        form.jumpKeyPath = selected
      } else {
        form.keyPath = selected
        selectedKeyId.value = ''
      }
    }
  } catch {
    // 文件选择取消或失败,静默忽略
  }
}

// 从密钥库下拉选择密钥时,自动填充路径和 passphrase
async function onKeyLibrarySelect(keyId: string) {
  if (!keyId) {
    form.keyPath = ''
    form.passphrase = ''
    return
  }
  const key = sshKeys.value.find((k) => k.id === keyId)
  if (!key) return
  form.keyPath = key.keyPath
  selectedKeyId.value = keyId
  // 尝试获取已存储的 passphrase
  try {
    const pass = await sshKeyPassphrase(keyId)
    form.passphrase = pass ?? ''
  } catch {
    form.passphrase = ''
  }
}

function buildAuth(kind: AuthKind, password: string, keyPath: string, passphrase: string) {
  if (kind === 'password') return { kind: 'password' as const, password }
  if (kind === 'private_key') {
    return { kind: 'private_key' as const, path: keyPath, passphrase: passphrase || null }
  }
  if (kind === 'agent') return { kind: 'agent' as const }
  return { kind: 'keyboard_interactive' as const }
}

async function submit() {
  err.value = null
  if (!form.host || !form.user) {
    err.value = '主机与用户名不能为空'
    return
  }
  if (form.useJump && (!form.jumpHost || !form.jumpUser)) {
    err.value = '跳板机主机与用户名不能为空'
    return
  }

  busy.value = true
  try {
    const cfg: SshConfig = {
      host: form.host,
      port: Number(form.port) || 22,
      user: form.user,
      auth: buildAuth(form.authKind, form.password, form.keyPath, form.passphrase),
      jump: form.useJump
        ? {
            host: form.jumpHost,
            port: Number(form.jumpPort) || 22,
            user: form.jumpUser,
            auth: buildAuth(form.jumpAuthKind, form.jumpPassword, form.jumpKeyPath, form.jumpPassphrase),
          }
        : undefined,
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
          jumpHost: form.useJump ? form.jumpHost : null,
          jumpPort: form.useJump ? Number(form.jumpPort) || 22 : 22,
          jumpUsername: form.useJump ? form.jumpUser : null,
          jumpAuthKind: form.useJump ? form.jumpAuthKind : null,
          jumpKeyPath: form.useJump && form.jumpAuthKind === 'private_key' ? form.jumpKeyPath : null,
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
          <ToggleGroup
            type="single"
            :model-value="form.authKind"
            variant="outline"
            size="sm"
            class="w-full"
            @update:model-value="(v: string) => v && (form.authKind = v as AuthKind)"
          >
            <ToggleGroupItem
              value="password"
              class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              <Lock class="size-3.5" /> 密码
            </ToggleGroupItem>
            <ToggleGroupItem
              value="private_key"
              class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              <KeyRound class="size-3.5" /> 私钥
            </ToggleGroupItem>
            <ToggleGroupItem
              value="agent"
              class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              <Cpu class="size-3.5" /> Agent
            </ToggleGroupItem>
            <ToggleGroupItem
              value="keyboard_interactive"
              class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              <MessageSquareText class="size-3.5" /> 交互
            </ToggleGroupItem>
          </ToggleGroup>
          <p v-if="form.authKind === 'agent'" class="text-[11px] text-muted-foreground">
            使用本机 SSH agent(OpenSSH agent / Pageant)持有的密钥;不保存任何凭据。
          </p>
          <p v-else-if="form.authKind === 'keyboard_interactive'" class="text-[11px] text-muted-foreground">
            连接时由服务器下发提示(如 OTP、密码),不保存任何凭据。
          </p>
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              tabindex="-1"
              @click="showPassword = !showPassword"
            >
              <Eye v-if="!showPassword" class="size-3.5" />
              <EyeOff v-else class="size-3.5" />
            </Button>
          </div>
        </div>

        <template v-else>
          <!-- 密钥库快速选择(可选) -->
          <div v-if="sshKeys.length > 0" class="grid gap-1.5">
            <Label>从密钥库选择</Label>
            <div class="flex gap-1.5">
              <Select
                :model-value="selectedKeyId"
                @update:model-value="(v) => onKeyLibrarySelect(String(v ?? ''))"
              >
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="选择已管理的密钥…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">手动指定路径</SelectItem>
                  <SelectSeparator />
                  <SelectItem
                    v-for="key in sshKeys"
                    :key="key.id"
                    :value="key.id"
                  >{{ key.name }} · {{ key.algorithm }}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" @click="openKeyManager()" title="管理密钥库…">
                <KeyRound />
              </Button>
            </div>
          </div>
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
                :title="showPassphrase ? '隐藏' : '显示'"
                tabindex="-1"
                @click="showPassphrase = !showPassphrase"
              >
                <Eye v-if="!showPassphrase" class="size-3.5" />
                <EyeOff v-else class="size-3.5" />
              </Button>
            </div>
          </div>
        </template>

        <Collapsible v-model:open="form.useJump" class="grid gap-1.5">
          <CollapsibleTrigger as-child>
            <Button type="button" variant="ghost" size="sm" class="justify-start gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground">
              <Network class="size-3.5" />
              代理跳板
              <ChevronDown class="size-3 transition-transform" :class="form.useJump ? 'rotate-180' : ''" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="grid gap-3 rounded-md border border-border p-3">
            <div class="grid grid-cols-[1fr_80px] gap-2">
              <div class="grid gap-1.5">
                <Label for="jumpHost">跳板机主机</Label>
                <Input id="jumpHost" v-model="form.jumpHost" placeholder="jump.example.com" />
              </div>
              <div class="grid gap-1.5">
                <Label for="jumpPort">端口</Label>
                <Input id="jumpPort" v-model.number="form.jumpPort" type="number" />
              </div>
            </div>

            <div class="grid gap-1.5">
              <Label for="jumpUser">跳板机用户名</Label>
              <Input id="jumpUser" v-model="form.jumpUser" />
            </div>

            <div class="grid gap-1.5">
              <Label>跳板机认证</Label>
              <ToggleGroup
                type="single"
                :model-value="form.jumpAuthKind"
                variant="outline"
                size="sm"
                class="w-full"
                @update:model-value="(v: string) => v && (form.jumpAuthKind = v as AuthKind)"
              >
                <ToggleGroupItem
                  value="password"
                  class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
                >
                  <Lock class="size-3.5" /> 密码
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="private_key"
                  class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
                >
                  <KeyRound class="size-3.5" /> 私钥
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="agent"
                  class="flex-1 gap-1.5 border-border text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
                >
                  <Cpu class="size-3.5" /> Agent
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div v-if="form.jumpAuthKind === 'password'" class="grid gap-1.5">
              <Label for="jumpPassword">跳板机密码</Label>
              <div class="relative">
                <Input
                  id="jumpPassword"
                  v-model="form.jumpPassword"
                  :type="showJumpPassword ? 'text' : 'password'"
                  class="pr-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
                  :title="showJumpPassword ? '隐藏密码' : '显示密码'"
                  tabindex="-1"
                  @click="showJumpPassword = !showJumpPassword"
                >
                  <Eye v-if="!showJumpPassword" class="size-3.5" />
                  <EyeOff v-else class="size-3.5" />
                </Button>
              </div>
            </div>

            <template v-else-if="form.jumpAuthKind === 'private_key'">
              <div class="grid gap-1.5">
                <Label for="jumpKeyPath">跳板机私钥文件</Label>
                <div class="flex gap-1.5">
                  <Input
                    id="jumpKeyPath"
                    v-model="form.jumpKeyPath"
                    placeholder="点右侧按钮选择,或手动粘贴路径"
                    class="flex-1"
                  />
                  <Button type="button" variant="outline" size="icon" @click="pickKeyFile('jump')" title="浏览…">
                    <FolderOpen />
                  </Button>
                </div>
              </div>
              <div class="grid gap-1.5">
                <Label for="jumpPassphrase">Passphrase(可选)</Label>
                <div class="relative">
                  <Input
                    id="jumpPassphrase"
                    v-model="form.jumpPassphrase"
                    :type="showJumpPassphrase ? 'text' : 'password'"
                    class="pr-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
                    :title="showJumpPassphrase ? '隐藏' : '显示'"
                    tabindex="-1"
                    @click="showJumpPassphrase = !showJumpPassphrase"
                  >
                    <Eye v-if="!showJumpPassphrase" class="size-3.5" />
                    <EyeOff v-else class="size-3.5" />
                  </Button>
                </div>
              </div>
            </template>
          </CollapsibleContent>
        </Collapsible>

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

        <Alert v-if="err" variant="destructive" class="text-[length:var(--text-xs)]">
          <AlertDescription>{{ err }}</AlertDescription>
        </Alert>

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
