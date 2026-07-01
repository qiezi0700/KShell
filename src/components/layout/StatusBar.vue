<script setup lang="ts">
// 占位:后续接入实际会话/传输状态
</script>

<template>
  <footer class="flex shrink-0 items-center gap-3 border-t border-border bg-titlebar px-2 text-muted-foreground" :style="{ height: 'var(--size-statusbar)', fontSize: 'var(--text-xs)' }">
    <span class="inline-flex items-center gap-1.5">
      <span class="size-[7px] rounded-full bg-success" />
      就绪
    </span>
    <span>0 会话</span>
    <span class="flex-1" />
    <span>UTF-8</span>
    <span>LF</span>
    <span>v0.1.0</span>
  </footer>
</template>
