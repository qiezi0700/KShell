<script setup lang="ts">
import { SelectGroup, type SelectGroupProps } from 'reka-ui'

defineProps<SelectGroupProps>()
</script>

<template>
  <SelectGroup v-bind="$attrs">
    <slot />
  </SelectGroup>
</template>
