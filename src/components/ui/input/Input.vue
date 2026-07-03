<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  size?: "sm" | "md" | "lg"
  class?: HTMLAttributes["class"]
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const sizeClass = computed(() => {
  switch (props.size ?? "md") {
    case "sm":
      return "h-[var(--control-sm)] px-[var(--control-sm-px)] py-[var(--control-sm-py)] text-[var(--control-sm-text)]"
    case "lg":
      return "h-[var(--control-lg)] px-[var(--control-lg-px)] py-[var(--control-lg-py)] text-[var(--control-lg-text)]"
    default:
      return "h-[var(--control-md)] px-[var(--control-md-px)] py-[var(--control-md-py)] text-[var(--control-md-text)]"
  }
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      sizeClass,
      props.class,
    )"
  >
</template>
