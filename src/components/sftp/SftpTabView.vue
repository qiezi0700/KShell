<script setup lang="ts">
import SftpView from './SftpView.vue'
import type { SftpTab } from '@/stores/tabs'

defineProps<{ tab: SftpTab }>()
</script>

<template>
  <SftpView
    :tab-id="tab.id"
    :session-id="tab.sessionId"
    :sftp-id="tab.sftpId"
    :host="tab.host"
    :user="tab.user"
  />
</template>
