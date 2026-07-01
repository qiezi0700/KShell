<script setup lang="ts">
import { DropdownMenuItem, type DropdownMenuItemProps, type DropdownMenuItemEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuItemProps & { class?: string; inset?: boolean }>()
const emits = defineEmits<DropdownMenuItemEmits>()
</script>

<template>
  <DropdownMenuItem
    v-bind="props"
    @select="emits('select', $event)"
    :class="cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[length:var(--text-sm)] text-foreground outline-none',
      'focus:bg-accent focus:text-accent-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-8',
      props.class,
    )"
  >
    <slot />
  </DropdownMenuItem>
</template>
