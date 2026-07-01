<script setup lang="ts">
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  type ScrollAreaRootProps,
  ScrollAreaViewport,
} from 'reka-ui'
import { cn } from '@/lib/utils'
import ScrollBar from './ScrollBar.vue'

const props = defineProps<ScrollAreaRootProps & { class?: string }>()
</script>

<template>
  <ScrollAreaRoot v-bind="props" :class="cn('relative overflow-hidden', props.class)">
    <ScrollAreaViewport class="h-full w-full rounded-[inherit]">
      <slot />
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
