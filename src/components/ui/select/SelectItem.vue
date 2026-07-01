<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import {
  SelectItem,
  SelectItemIndicator,
  type SelectItemProps,
  SelectItemText,
  useForwardProps,
} from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<SelectItemProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = computed(() => {
  const { class: _, ...rest } = props
  return rest
})
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectItem
    v-bind="forwardedProps"
    :class="cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1 pl-6 pr-2 text-[12px] outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50',
      props.class,
    )"
  >
    <span class="absolute left-1 flex size-4 items-center justify-center">
      <SelectItemIndicator>
        <Check class="size-3.5" />
      </SelectItemIndicator>
    </span>
    <SelectItemText>
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
