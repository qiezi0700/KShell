<script setup lang="ts">
// 统一状态圆点。所有"在线/离线/成功/警告/失败"指示器
// 都应走此原语,禁止业务代码再写 size-[7px]、size-2 之类的散点。
import { cn } from '@/lib/utils'

type Variant = 'success' | 'warning' | 'destructive' | 'primary' | 'muted'

const props = withDefaults(defineProps<{
  variant?: Variant
  class?: string
  pulse?: boolean
}>(), {
  variant: 'muted',
  pulse: false,
})

const variantMap: Record<Variant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  primary: 'bg-primary',
  muted: 'bg-muted-foreground',
}
</script>

<template>
  <span
    :class="cn(
      'inline-block size-1.5 rounded-full shrink-0',
      variantMap[props.variant],
      props.pulse && 'animate-pulse',
      props.class,
    )"
    aria-hidden="true"
  />
</template>
