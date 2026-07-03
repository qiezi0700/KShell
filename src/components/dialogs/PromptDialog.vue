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
import { promptOpen, promptState, resolvePrompt } from '@/stores/prompt'

const value = ref('')

watch(promptOpen, (open) => {
  if (open) value.value = promptState.value?.defaultValue ?? ''
})

function submit() {
  resolvePrompt(value.value)
}

function onOpenChange(open: boolean) {
  if (!open) resolvePrompt(null)
}
</script>

<template>
  <Dialog :open="promptOpen" @update:open="onOpenChange">
    <DialogContent class="max-w-[400px]">
      <DialogHeader>
        <DialogTitle>{{ promptState?.title }}</DialogTitle>
        <DialogDescription v-if="promptState?.message">
          {{ promptState.message }}
        </DialogDescription>
      </DialogHeader>

      <form class="grid gap-2" @submit.prevent="submit">
        <Label for="prompt-value" class="sr-only">值</Label>
        <Input
          id="prompt-value"
          v-model="value"
          :placeholder="promptState?.placeholder ?? ''"
          autofocus
        />
        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="resolvePrompt(null)">
            {{ promptState?.cancelText ?? '取消' }}
          </Button>
          <Button type="submit">
            {{ promptState?.confirmText ?? '确定' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
