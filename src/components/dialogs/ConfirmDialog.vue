<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { confirmOpen, confirmState, resolveConfirm } from '@/stores/prompt'

// 关闭时视为取消
function onOpenChange(open: boolean) {
  if (!open) resolveConfirm(false)
}
</script>

<template>
  <Dialog :open="confirmOpen" @update:open="onOpenChange">
    <DialogContent class="max-w-[400px]">
      <DialogHeader>
        <DialogTitle>{{ confirmState?.title }}</DialogTitle>
        <DialogDescription :class="confirmState?.message ? 'whitespace-pre-line' : 'sr-only'">
          {{ confirmState?.message || '确认是否继续执行此操作' }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="pt-2">
        <Button variant="ghost" @click="resolveConfirm(false)">
          {{ confirmState?.cancelText ?? '取消' }}
        </Button>
        <Button
          :variant="confirmState?.destructive ? 'destructive' : 'default'"
          @click="resolveConfirm(true)"
        >
          {{ confirmState?.confirmText ?? '确定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
