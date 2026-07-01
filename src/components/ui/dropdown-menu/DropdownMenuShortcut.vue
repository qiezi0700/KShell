<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{ class?: string }>()
</script>

<template>
  <span :class="cn('ml-auto text-[length:var(--text-xs)] tracking-widest text-muted-foreground', $props.class)">
    <slot />
  </span>
</template>
