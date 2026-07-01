<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
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
      'flex w-full items-center justify-between rounded-md border border-input bg-transparent px-2 py-1 shadow-sm outline-none ring-0 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 [&>span]:truncate',
      props.class,
    )"
    :style="{ height: 'var(--size-input)', fontSize: 'var(--text-sm)' }"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="size-3.5 shrink-0 text-muted-foreground opacity-70" />
    </SelectIcon>
  </SelectTrigger>
</template>
