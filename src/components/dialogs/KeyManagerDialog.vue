<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  KeyRound,
  Plus,
  Upload,
  Trash2,
  Pencil,
  Copy,
  Rocket,
  Eye,
  Loader2,
  Check,
} from 'lucide-vue-next'
import { open as openFileDialog } from '@tauri-apps/plugin-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { keys, keyManagerDialogOpen, refreshKeys, deleteKey, renameKey } from '@/stores/keys'
import {
  sshKeyGenerate,
  sshKeyImport,
  sshKeyPublicKey,
  sshKeyDeploy,
  type SshKey,
} from '@/api/keys'
import { tabs } from '@/stores/tabs'
import { toast } from '@/stores/toast'

// ============================================================
// 状态
// ============================================================

const busy = ref(false)
const err = ref<string | null>(null)

// 当前选中查看公钥的密钥
const viewingKey = ref<SshKey | null>(null)
const publicKeyText = ref('')
const publicKeyLoading = ref(false)
const copied = ref(false)

// 生成密钥表单
const showGenerate = ref(false)
const genForm = ref({
  name: '',
  algorithm: 'ed25519',
  comment: '',
  passphrase: '',
})

// 导入密钥表单
const showImport = ref(false)
const importForm = ref({
  name: '',
  sourcePath: '',
  passphrase: '',
})

// 活跃终端会话(用于部署公钥)
const activeTerminals = computed(() =>
  tabs.value.filter((t) => t.type === 'terminal'),
)

// 部署目标选择
const deployTarget = ref<string>('')
const deployingKeyId = ref<string | null>(null)

// ============================================================
// 操作
// ============================================================

const ALGORITHM_LABELS: Record<string, string> = {
  'ed25519': 'ED25519',
  'rsa-2048': 'RSA 2048',
  'rsa-3072': 'RSA 3072',
  'rsa-4096': 'RSA 4096',
  'rsa': 'RSA',
  'ecdsa-p256': 'ECDSA P256',
  'ecdsa-p384': 'ECDSA P384',
  'ecdsa-p521': 'ECDSA P521',
}

function algoLabel(algo: string): string {
  return ALGORITHM_LABELS[algo] ?? algo.toUpperCase()
}

function shortFp(fp: string): string {
  // SHA256:xxxx...xxxx → 取前 20 字符 + ...
  if (fp.length > 24) return fp.slice(0, 20) + '…'
  return fp
}

async function viewPublicKey(key: SshKey) {
  viewingKey.value = key
  publicKeyText.value = ''
  publicKeyLoading.value = true
  try {
    publicKeyText.value = await sshKeyPublicKey(key.id)
  } catch (e: any) {
    publicKeyText.value = `加载失败: ${e?.message ?? e}`
  } finally {
    publicKeyLoading.value = false
  }
}

async function copyPublicKey() {
  if (!publicKeyText.value) return
  try {
    await navigator.clipboard.writeText(publicKeyText.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // 剪贴板可能被拒
  }
}

async function generate() {
  err.value = null
  if (!genForm.value.name.trim()) {
    err.value = '密钥名称不能为空'
    return
  }
  busy.value = true
  try {
    await sshKeyGenerate({
      name: genForm.value.name.trim(),
      algorithm: genForm.value.algorithm,
      comment: genForm.value.comment.trim() || null,
      passphrase: genForm.value.passphrase || null,
    })
    await refreshKeys()
    showGenerate.value = false
    genForm.value = { name: '', algorithm: 'ed25519', comment: '', passphrase: '' }
    toast.success('密钥已生成')
  } catch (e: any) {
    err.value = e?.message ?? String(e)
  } finally {
    busy.value = false
  }
}

async function pickImportFile() {
  try {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
      title: '选择私钥文件',
      filters: [
        { name: '私钥', extensions: ['pem', 'key', 'ppk', 'id_rsa', 'id_ed25519'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (typeof selected === 'string' && selected) {
      importForm.value.sourcePath = selected
    }
  } catch {
    // 取消
  }
}

async function importKey() {
  err.value = null
  if (!importForm.value.name.trim()) {
    err.value = '密钥名称不能为空'
    return
  }
  if (!importForm.value.sourcePath.trim()) {
    err.value = '请选择私钥文件'
    return
  }
  busy.value = true
  try {
    await sshKeyImport({
      name: importForm.value.name.trim(),
      sourcePath: importForm.value.sourcePath,
      passphrase: importForm.value.passphrase || null,
    })
    await refreshKeys()
    showImport.value = false
    importForm.value = { name: '', sourcePath: '', passphrase: '' }
    toast.success('密钥已导入')
  } catch (e: any) {
    err.value = e?.message ?? String(e)
  } finally {
    busy.value = false
  }
}

async function confirmDelete(key: SshKey) {
  if (!confirm(`确定删除密钥「${key.name}」吗?此操作不可撤销。`)) return
  try {
    await deleteKey(key.id)
    if (viewingKey.value?.id === key.id) viewingKey.value = null
    toast.info('密钥已删除')
  } catch (e: any) {
    toast.error(`删除失败: ${e?.message ?? e}`)
  }
}

async function startRename(key: SshKey) {
  const name = prompt('输入新名称', key.name)
  if (name === null) return
  if (!name.trim()) {
    toast.error('名称不能为空')
    return
  }
  try {
    await renameKey(key.id, name.trim())
    toast.success('已重命名')
  } catch (e: any) {
    toast.error(`重命名失败: ${e?.message ?? e}`)
  }
}

async function deployKey(key: SshKey) {
  if (!deployTarget.value) {
    toast.error('请先选择要部署到的 SSH 会话')
    return
  }
  deployingKeyId.value = key.id
  try {
    const msg = await sshKeyDeploy(deployTarget.value, key.id)
    toast.success(msg)
  } catch (e: any) {
    toast.error(`部署失败: ${e?.message ?? e}`)
  } finally {
    deployingKeyId.value = null
  }
}

// 对话框打开时刷新列表
watch(keyManagerDialogOpen, (v) => {
  if (v) {
    err.value = null
    showGenerate.value = false
    showImport.value = false
    viewingKey.value = null
  }
})
</script>

<template>
  <Dialog v-model:open="keyManagerDialogOpen">
    <DialogContent class="max-w-3xl w-[92vw] max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <KeyRound class="size-4" />
          <span>SSH 密钥库</span>
          <Badge variant="secondary" class="text-caption">{{ keys.length }}</Badge>
        </DialogTitle>
        <DialogDescription>管理 SSH 密钥对:生成、导入、部署公钥到远端服务器</DialogDescription>
      </DialogHeader>

      <!-- 工具栏 -->
      <div class="flex items-center gap-2">
        <Button size="sm" @click="showGenerate = !showGenerate; showImport = false; err = null">
          <Plus class="size-3.5" />
          生成密钥
        </Button>
        <Button size="sm" variant="outline" @click="showImport = !showImport; showGenerate = false; err = null">
          <Upload class="size-3.5" />
          导入密钥
        </Button>
        <span class="flex-1" />
        <Button size="sm" variant="ghost" @click="refreshKeys()">
          <Check class="size-3.5" />
          刷新
        </Button>
      </div>

      <!-- 生成密钥表单 -->
      <Card v-if="showGenerate" class="gap-3 rounded-md border-border bg-panel p-4 shadow-none">
        <div class="text-body font-medium text-foreground">生成新密钥对</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label>名称</Label>
            <Input v-model="genForm.name" placeholder="例如 work-key" />
          </div>
          <div class="grid gap-1.5">
            <Label>算法</Label>
            <Select v-model="genForm.algorithm">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ed25519">ED25519(推荐)</SelectItem>
                <SelectItem value="rsa-2048">RSA 2048</SelectItem>
                <SelectItem value="rsa-3072">RSA 3072</SelectItem>
                <SelectItem value="rsa-4096">RSA 4096</SelectItem>
                <SelectItem value="ecdsa-p256">ECDSA P-256</SelectItem>
                <SelectItem value="ecdsa-p384">ECDSA P-384</SelectItem>
                <SelectItem value="ecdsa-p521">ECDSA P-521</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label>注释(可选,通常填邮箱)</Label>
            <Input v-model="genForm.comment" placeholder="user@example.com" />
          </div>
          <div class="grid gap-1.5">
            <Label>Passphrase(可选)</Label>
            <Input v-model="genForm.passphrase" type="password" placeholder="留空则不加密" />
          </div>
        </div>
        <Alert v-if="err" variant="destructive" class="text-[length:var(--text-xs)]">
          <AlertDescription>{{ err }}</AlertDescription>
        </Alert>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" :disabled="busy" @click="showGenerate = false">取消</Button>
          <Button size="sm" :disabled="busy" @click="generate">
            <Loader2 v-if="busy" class="animate-spin" />
            {{ busy ? '生成中…' : '生成' }}
          </Button>
        </div>
      </Card>

      <!-- 导入密钥表单 -->
      <Card v-if="showImport" class="gap-3 rounded-md border-border bg-panel p-4 shadow-none">
        <div class="text-body font-medium text-foreground">导入已有私钥</div>
        <div class="grid gap-3">
          <div class="grid gap-1.5">
            <Label>名称</Label>
            <Input v-model="importForm.name" placeholder="例如 my-key" />
          </div>
          <div class="grid gap-1.5">
            <Label>私钥文件</Label>
            <div class="flex gap-1.5">
              <Input v-model="importForm.sourcePath" placeholder="点右侧按钮选择,或手动粘贴路径" class="flex-1" />
              <Button variant="outline" size="icon" @click="pickImportFile" title="浏览…">
                <Upload class="size-3.5" />
              </Button>
            </div>
          </div>
          <div class="grid gap-1.5">
            <Label>Passphrase(可选)</Label>
            <Input v-model="importForm.passphrase" type="password" placeholder="如密钥有密码则填写" />
          </div>
        </div>
        <Alert v-if="err" variant="destructive" class="text-[length:var(--text-xs)]">
          <AlertDescription>{{ err }}</AlertDescription>
        </Alert>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" :disabled="busy" @click="showImport = false">取消</Button>
          <Button size="sm" :disabled="busy" @click="importKey">
            <Loader2 v-if="busy" class="animate-spin" />
            {{ busy ? '导入中…' : '导入' }}
          </Button>
        </div>
      </Card>

      <!-- 密钥列表 -->
      <div v-if="keys.length === 0" class="text-body py-12 text-center text-muted-foreground">
        密钥库为空,点击上方按钮生成或导入密钥。
      </div>

      <Table v-else class="text-body">
        <TableHeader>
          <TableRow class="text-caption text-left hover:bg-transparent">
            <TableHead class="h-auto pb-1.5 font-medium">名称</TableHead>
            <TableHead class="h-auto pb-1.5 font-medium">算法</TableHead>
            <TableHead class="h-auto pb-1.5 font-medium">指纹</TableHead>
            <TableHead class="h-auto pb-1.5 text-right font-medium">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ContextMenu v-for="key in keys" :key="key.id">
            <ContextMenuTrigger as-child>
              <TableRow
                class="cursor-default border-t border-border/60 border-b-0 hover:bg-muted/30"
                :class="viewingKey?.id === key.id && 'bg-muted/40'"
                @click="viewPublicKey(key)"
              >
                <TableCell class="py-2">
                  <div class="flex items-center gap-2">
                    <KeyRound class="size-3.5 text-muted-foreground" />
                    <span class="font-medium text-foreground">{{ key.name }}</span>
                  </div>
                </TableCell>
                <TableCell class="py-2">
                  <Badge variant="outline" class="text-caption font-mono">{{ algoLabel(key.algorithm) }}</Badge>
                </TableCell>
                <TableCell class="py-2 font-mono text-caption text-muted-foreground">
                  {{ shortFp(key.fingerprint) }}
                </TableCell>
                <TableCell class="py-2 text-right">
                  <div class="flex items-center justify-end gap-0.5">
                    <Button variant="ghost" size="icon-sm" title="查看公钥" @click.stop="viewPublicKey(key)">
                      <Eye class="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="重命名" @click.stop="startRename(key)">
                      <Pencil class="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="hover:bg-destructive/20 hover:text-destructive"
                      title="删除"
                      @click.stop="confirmDelete(key)"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="viewPublicKey(key)">
                <Eye class="size-3.5" /> 查看公钥
              </ContextMenuItem>
              <ContextMenuItem @select="startRename(key)">
                <Pencil class="size-3.5" /> 重命名
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" @select="confirmDelete(key)">
                <Trash2 class="size-3.5" /> 删除
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </TableBody>
      </Table>

      <!-- 公钥详情 -->
      <Card v-if="viewingKey" class="gap-2 rounded-md border-border bg-panel p-3 shadow-none">
        <div class="flex items-center justify-between">
          <div class="text-caption flex items-center gap-1.5 text-muted-foreground">
            <KeyRound class="size-3.5" />
            <span class="font-medium text-foreground">{{ viewingKey.name }}</span>
            <span>公钥</span>
          </div>
          <Button variant="ghost" size="icon-sm" :title="copied ? '已复制' : '复制公钥'" @click="copyPublicKey">
            <Check v-if="copied" class="size-3.5 text-success" />
            <Copy v-else class="size-3.5" />
          </Button>
        </div>
        <div class="text-caption break-all rounded-md bg-panel-2 p-2 font-mono text-muted-foreground">
          <span v-if="publicKeyLoading">加载中…</span>
          <span v-else>{{ publicKeyText }}</span>
        </div>
        <div class="text-caption text-muted-foreground">
          <span>指纹:</span>
          <span class="ml-1 font-mono">{{ viewingKey.fingerprint }}</span>
        </div>

        <!-- 部署到服务器 -->
        <div class="mt-2 border-t border-border/40 pt-2">
          <div class="text-caption mb-1.5 flex items-center gap-1.5 text-muted-foreground">
            <Rocket class="size-3.5" />
            <span>部署公钥到远端 authorized_keys</span>
          </div>
          <div class="flex items-center gap-2">
            <Select v-model="deployTarget">
              <SelectTrigger class="flex-1">
                <SelectValue placeholder="选择 SSH 会话…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="t in activeTerminals"
                  :key="t.id"
                  :value="t.sessionId"
                >{{ t.user }}@{{ t.host }}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              :disabled="!deployTarget || deployingKeyId === viewingKey.id"
              @click="deployKey(viewingKey)"
            >
              <Loader2 v-if="deployingKeyId === viewingKey.id" class="animate-spin" />
              <Rocket v-else class="size-3.5" />
              部署
            </Button>
          </div>
          <div v-if="activeTerminals.length === 0" class="text-caption mt-1 text-muted-foreground/70">
            当前无活跃 SSH 连接,请先连接到目标服务器。
          </div>
        </div>
      </Card>
    </DialogContent>
  </Dialog>
</template>
