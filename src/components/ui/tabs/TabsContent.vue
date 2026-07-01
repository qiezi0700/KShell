<script setup lang="ts">
import { TabsContent, type TabsContentProps, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsContentProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <TabsContent
    v-bind="forwarded"
    :class="cn('flex-1 min-h-0 outline-none', props.class)"
  >
    <slot />
  </TabsContent>
</template>
