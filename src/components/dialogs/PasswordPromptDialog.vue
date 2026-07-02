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
import { passwordPromptOpen, passwordPromptState, resolvePasswordPrompt } from '@/stores/prompt'

const value = ref('')
const show = ref(false)

watch(passwordPromptOpen, (open) => {
  if (open) {
    value.value = ''
    show.value = false
  }
})

function submit() {
  resolvePasswordPrompt(value.value)
}

function onOpenChange(open: boolean) {
  if (!open) resolvePasswordPrompt(null)
}
</script>

<template>
  <Dialog :open="passwordPromptOpen" @update:open="onOpenChange">
    <DialogContent class="z-[60] max-w-[400px]" overlay-class="z-[60]">
      <DialogHeader>
        <DialogTitle>{{ passwordPromptState?.title }}</DialogTitle>
        <DialogDescription v-if="passwordPromptState?.message" class="whitespace-pre-line">
          {{ passwordPromptState.message }}
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-2" @submit.prevent="submit">
        <Label for="password-prompt-value" class="sr-only">密码</Label>
        <div class="relative">
          <Input
            id="password-prompt-value"
            v-model="value"
            :type="show ? 'text' : 'password'"
            :placeholder="passwordPromptState?.placeholder ?? ''"
            class="pr-8"
            autofocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
            :title="show ? '隐藏' : '显示'"
            tabindex="-1"
            @click="show = !show"
          >
            <Eye v-if="!show" class="size-3.5" />
            <EyeOff v-else class="size-3.5" />
          </Button>
        </div>
        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="resolvePasswordPrompt(null)">
            {{ passwordPromptState?.cancelText ?? '取消' }}
          </Button>
          <Button type="submit">
            {{ passwordPromptState?.confirmText ?? '确定' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
