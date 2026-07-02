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
import { multiPromptOpen, multiPromptState, resolveMultiPrompt } from '@/stores/prompt'

const values = ref<string[]>([])
const show = ref<boolean[]>([])

watch(multiPromptOpen, (open) => {
  if (open) {
    const prompts = multiPromptState.value?.prompts ?? []
    values.value = prompts.map(() => '')
    show.value = prompts.map((p) => p.echo)
  }
})

function submit() {
  resolveMultiPrompt(values.value)
}

function onOpenChange(open: boolean) {
  if (!open) resolveMultiPrompt(null)
}

function toggleVisibility(idx: number) {
  show.value[idx] = !show.value[idx]
}
</script>

<template>
  <Dialog :open="multiPromptOpen" @update:open="onOpenChange">
    <DialogContent class="z-[60] max-w-[420px]" overlay-class="z-[60]">
      <DialogHeader>
        <DialogTitle>{{ multiPromptState?.title }}</DialogTitle>
        <DialogDescription v-if="multiPromptState?.message" class="whitespace-pre-line">
          {{ multiPromptState.message }}
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-3" @submit.prevent="submit">
        <div
          v-for="(p, idx) in multiPromptState?.prompts"
          :key="idx"
          class="grid gap-1.5"
        >
          <Label :for="`ki-prompt-${idx}`">{{ p.label }}</Label>
          <div class="relative">
            <Input
              :id="`ki-prompt-${idx}`"
              v-model="values[idx]"
              :type="show[idx] ? 'text' : 'password'"
              class="pr-8"
              autofocus
            />
            <Button
              v-if="!p.echo"
              type="button"
              variant="ghost"
              size="icon-sm"
              class="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-muted hover:text-foreground"
              :title="show[idx] ? '隐藏' : '显示'"
              tabindex="-1"
              @click="toggleVisibility(idx)"
            >
              <Eye v-if="!show[idx]" class="size-3.5" />
              <EyeOff v-else class="size-3.5" />
            </Button>
          </div>
        </div>
        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="resolveMultiPrompt(null)">
            {{ multiPromptState?.cancelText ?? '取消' }}
          </Button>
          <Button type="submit">
            {{ multiPromptState?.confirmText ?? '确定' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
