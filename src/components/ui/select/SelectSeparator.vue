<script setup lang="ts">
import { SelectSeparator, type SelectSeparatorProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<SelectSeparatorProps & { class?: HTMLAttributes['class'] }>()
const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
</script>

<template>
  <SelectSeparator
    v-bind="delegated"
    :class="cn('-mx-1 my-1 h-px bg-border', props.class)"
  />
</template>
