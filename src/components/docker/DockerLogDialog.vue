<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { ScrollText, Copy } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/stores/toast'

const props = defineProps<{
  open: boolean
  container: string | null
  loading: boolean
  text: string
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

// 日志正文容器,用于打开/更新后自动滚到底部(docker logs 默认最新在末尾)
const bodyRef = ref<HTMLDivElement | null>(null)

async function scrollToBottom() {
  await nextTick()
  const el = bodyRef.value
  if (el) el.scrollTop = el.scrollHeight
}

// 打开或日志内容变化时滚到底部
watch(
  () => [props.open, props.text] as const,
  ([open]) => {
    if (open) scrollToBottom()
  },
)

async function copyLog() {
  if (!props.text) return
  try {
    await navigator.clipboard.writeText(props.text)
    toast.success('日志已复制到剪贴板')
  } catch {
    toast.error('复制失败,请手动选择文本')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent class="max-w-4xl w-[92vw] max-h-[80vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ScrollText class="size-4" />
          <span>容器日志:{{ container }}</span>
          <Button variant="ghost" size="icon-sm" class="ml-auto" :disabled="!text || loading" @click="copyLog">
            <Copy class="size-3.5" />
          </Button>
        </DialogTitle>
      </DialogHeader>
      <div
        ref="bodyRef"
        class="overflow-y-auto rounded-md bg-muted/30 p-3 font-mono text-caption"
        :style="{ maxHeight: '60vh' }"
      >
        <span v-if="loading" class="text-muted-foreground">加载中…</span>
        <pre v-else class="whitespace-pre-wrap break-words text-foreground">{{ text }}</pre>
      </div>
    </DialogContent>
  </Dialog>
</template>
