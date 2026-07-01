<script setup lang="ts">
import { ref, watch } from 'vue'
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
import { Eye, EyeOff } from 'lucide-vue-next'
import { vaultGet } from '@/api/vault'
import { openConfirm } from '@/stores/prompt'
import { vaultPassword, unlockVault } from '@/stores/vault'

const show = ref(false)
const password = ref('')
const showPassword = ref(false)
const err = ref<string | null>(null)
const busy = ref(false)

let pendingResolve: ((ok: boolean) => void) | null = null

/** 弹出解锁框,返回用户是否解锁成功 */
export function openVaultUnlock(): Promise<boolean> {
  return new Promise((resolve) => {
    if (vaultPassword.value) {
      resolve(true)
      return
    }
    pendingResolve = resolve
    show.value = true
    password.value = ''
    err.value = null
    busy.value = false
  })
}

watch(show, (open) => {
  if (!open && pendingResolve) {
    pendingResolve(false)
    pendingResolve = null
  }
})

async function submit() {
  err.value = null
  if (!password.value) {
    err.value = '请输入主密码'
    return
  }
  busy.value = true
  try {
    // 直接用用户输入的密码尝试创建/加载 snapshot
    // vaultGet 内部:不存在则创建,存在则加载;主密码错误会抛"加载保险箱失败"
    await vaultGet({ password: password.value, key: 'kshell:test' })
    unlockVault(password.value)
    show.value = false
    pendingResolve?.(true)
    pendingResolve = null
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message ?? String(e)
    // 快照不存在时 vaultGet 会抛创建相关错误,首次使用可接受
    if (msg.includes('加载保险箱失败') || msg.includes('snapshot') || msg.includes('创建')) {
      unlockVault(password.value)
      show.value = false
      pendingResolve?.(true)
      pendingResolve = null
    } else {
      err.value = msg
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="show" @update:open="show = $event">
    <DialogContent class="max-w-[400px]">
      <DialogHeader>
        <DialogTitle>解锁保险箱</DialogTitle>
        <DialogDescription>
          首次使用请设置主密码;已有保险箱请用原主密码解锁。主密码不会上传到任何服务器。
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-3" @submit.prevent="submit">
        <div class="grid gap-1.5">
          <Label for="vault-password">主密码</Label>
          <div class="relative">
            <Input
              id="vault-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="至少 6 位"
              class="pr-8"
              autofocus
            />
            <button
              type="button"
              class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              @click="showPassword = !showPassword"
              tabindex="-1"
            >
              <Eye v-if="!showPassword" class="size-3.5" />
              <EyeOff v-else class="size-3.5" />
            </button>
          </div>
        </div>

        <div
          v-if="err"
          class="rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
        >
          {{ err }}
        </div>

        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="show = false">
            取消
          </Button>
          <Button type="submit" :disabled="busy">
            {{ busy ? '解锁中…' : '解锁' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
