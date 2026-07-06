<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { SelectIcon, SelectTrigger, type SelectTriggerProps, useForwardProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<SelectTriggerProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="cn(
      'flex h-[var(--control-md)] w-full items-center justify-between rounded-md border border-input bg-transparent px-[var(--control-md-px)] py-[var(--control-md-py)] text-[var(--control-md-text)] shadow-sm outline-none ring-0 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 [&>span]:truncate',
      props.class,
    )"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="size-[var(--control-md-icon)] shrink-0 text-muted-foreground opacity-70" />
    </SelectIcon>
  </SelectTrigger>
</template>
