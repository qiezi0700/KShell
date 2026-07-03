<script setup lang="ts">
import { computed } from 'vue'
import { Info, Copy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from '@/stores/toast'

// 卷/网络 inspect 输出结构差异较大,不做归一化,直接展示 pretty-print JSON
const props = defineProps<{
  open: boolean
  title: string
  subject: string | null
  loading: boolean
  data: Record<string, unknown> | null
}>()

defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const pretty = computed(() => {
  if (!props.data) return ''
  try { return JSON.stringify(props.data, null, 2) } catch { return String(props.data) }
})

async function copyText() {
  if (!pretty.value) return
  try {
    await navigator.clipboard.writeText(pretty.value)
    toast.success('已复制')
  } catch {
    toast.error('复制失败')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
    <DialogContent class="max-w-3xl w-[92vw] max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Info class="size-4" />
          <span>{{ title }}:{{ subject }}</span>
          <Button variant="ghost" size="icon-sm" class="ml-auto" :disabled="!pretty" @click="copyText">
            <Copy class="size-3.5" />
          </Button>
        </DialogTitle>
        <DialogDescription class="sr-only">原始 inspect JSON</DialogDescription>
      </DialogHeader>
      <div class="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/30 p-3 font-mono text-caption">
        <span v-if="loading" class="text-muted-foreground">加载中…</span>
        <pre v-else class="whitespace-pre-wrap break-words text-foreground">{{ pretty }}</pre>
      </div>
    </DialogContent>
  </Dialog>
</template>
