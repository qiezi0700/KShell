<script setup lang="ts">
import { DialogTitle, type DialogTitleProps, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<DialogTitleProps & { class?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <DialogTitle
    v-bind="forwarded"
    :class="cn('text-title leading-none text-foreground', props.class)"
  >
    <slot />
  </DialogTitle>
</template>
