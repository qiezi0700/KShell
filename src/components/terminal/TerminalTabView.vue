<script setup lang="ts">
import TerminalSplit from './TerminalSplit.vue'
import type { TerminalTab } from '@/stores/tabs'

defineProps<{ tab: TerminalTab }>()
</script>

<template>
  <TerminalSplit
    :tab-id="tab.id"
    :session-id="tab.sessionId"
    :channel-id="tab.channelId"
    :host="tab.host"
    :user="tab.user"
  />
</template>
