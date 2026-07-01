<script setup lang="ts">
import { TooltipContent, type TooltipContentEmits, type TooltipContentProps, TooltipPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<TooltipContentProps & { class?: string }>(), {
  sideOffset: 4,
})
const emits = defineEmits<TooltipContentEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="forwarded"
      :class="cn(
        'z-50 overflow-hidden rounded-sm border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md',
        'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        props.class,
      )"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
