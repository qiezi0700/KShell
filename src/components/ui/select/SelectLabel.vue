<script setup lang="ts">
import { SelectLabel, type SelectLabelProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<SelectLabelProps & { class?: HTMLAttributes['class'] }>()
const delegated = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
</script>

<template>
  <SelectLabel
    v-bind="delegated"
    :class="cn('px-2 py-1 text-[length:var(--text-xs)] font-semibold text-muted-foreground', props.class)"
  >
    <slot />
  </SelectLabel>
</template>
