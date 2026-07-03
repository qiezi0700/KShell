<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '@/lib/utils'
import { nextZIndex } from '@/lib/z-index'
import DialogOverlay from './DialogOverlay.vue'

const props = defineProps<DialogContentProps & { class?: string, overlayClass?: string }>()
const emits = defineEmits<DialogContentEmits>()
// overlayClass / class 是宿主样式,不透传给 reka-ui 的 DialogContent
const forwardedProps = computed(() => {
  const { overlayClass: _o, class: _c, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(forwardedProps, emits)

// 多重弹窗按打开时序分配递增 z-index,后打开的总在更上层。
// 内联 style 优先级高于 class,覆盖下方默认的 z-50。
const ctx = injectDialogRootContext()
const zIndex = ref(50)
watch(
  () => ctx?.open.value,
  (open) => {
    if (open) zIndex.value = nextZIndex()
  },
  { immediate: true },
)
</script>

<template>
  <DialogPortal>
    <DialogOverlay :class="overlayClass" :style="{ zIndex }" />
    <DialogContent
      v-bind="forwarded"
      :class="cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
        'gap-4 border border-border bg-card p-5 shadow-lg rounded-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        props.class,
      )"
      :style="{ zIndex }"
    >
      <slot />
      <DialogClose class="absolute right-3 top-3 rounded-sm text-muted-foreground opacity-70 hover:opacity-100 focus:outline-none">
        <X class="size-4" />
        <span class="sr-only">Close</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
