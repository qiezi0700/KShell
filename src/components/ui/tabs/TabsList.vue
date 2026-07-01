<script setup lang="ts">
import { TabsList, type TabsListProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsListProps & { class?: string }>()
</script>

<template>
  <TabsList
    v-bind="props"
    :class="cn(
      'inline-flex items-center justify-start gap-0.5 border-b border-border px-1 pt-1',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
