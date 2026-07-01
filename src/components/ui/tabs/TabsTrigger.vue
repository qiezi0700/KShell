<script setup lang="ts">
import { TabsTrigger, type TabsTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsTriggerProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <TabsTrigger
    v-bind="forwarded"
    :class="cn(
      'inline-flex items-center rounded-t-sm px-2.5 py-1.5 text-[length:var(--text-sm)] text-muted-foreground transition-colors',
      'hover:text-foreground',
      'data-[state=active]:bg-panel data-[state=active]:text-foreground data-[state=active]:-mb-px data-[state=active]:border-b data-[state=active]:border-panel',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      props.class,
    )"
  >
    <slot />
  </TabsTrigger>
</template>
