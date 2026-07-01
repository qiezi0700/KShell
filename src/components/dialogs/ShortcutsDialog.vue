<script setup lang="ts">
import { ref } from 'vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const open = ref(false)

defineExpose({ open: () => (open.value = true) })

interface ShortcutItem {
  keys: string[]
  desc: string
  disabled?: boolean
}

interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

const groups: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { keys: ['Ctrl', 'N'], desc: '新建连接' },
      { keys: ['Ctrl', 'T'], desc: '新建标签' },
      { keys: ['Ctrl', 'W'], desc: '关闭标签' },
      { keys: ['Ctrl', 'B'], desc: '切换侧边栏' },
      { keys: ['Ctrl', 'K'], desc: '命令面板', disabled: true },
    ],
  },
  {
    title: '标签切换',
    items: [
      { keys: ['Ctrl', 'PgDn'], desc: '下一个标签' },
      { keys: ['Ctrl', 'PgUp'], desc: '上一个标签' },
    ],
  },
  {
    title: 'SFTP 文件操作',
    items: [
      { keys: ['Ctrl', 'C'], desc: '复制选中文件' },
      { keys: ['Ctrl', 'X'], desc: '剪切选中文件' },
      { keys: ['Ctrl', 'V'], desc: '粘贴到当前目录' },
    ],
  },
  {
    title: '终端',
    items: [
      { keys: ['Ctrl', 'Shift', 'C'], desc: '复制选中文本(终端内)' },
      { keys: ['Ctrl', 'Shift', 'V'], desc: '粘贴到终端' },
    ],
  },
]
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-[480px]">
      <DialogHeader>
        <DialogTitle class="text-[15px]">快捷键参考</DialogTitle>
        <DialogDescription class="text-[length:var(--text-xs)]">KShell 所有键盘快捷键</DialogDescription>
      </DialogHeader>

      <div class="max-h-[420px] space-y-4 overflow-y-auto py-1">
        <div v-for="g in groups" :key="g.title">
          <div class="mb-2 text-[length:var(--text-xs)] font-medium text-muted-foreground">{{ g.title }}</div>
          <div class="space-y-1.5">
            <div
              v-for="item in g.items"
              :key="item.desc"
              class="flex items-center justify-between rounded-sm px-1 py-1 text-[length:var(--text-sm)]"
              :class="item.disabled ? 'opacity-50' : ''"
            >
              <span :class="item.disabled ? 'text-muted-foreground line-through' : 'text-foreground'">
                {{ item.desc }}
                <span v-if="item.disabled" class="ml-1 text-[length:var(--text-xs)] text-muted-foreground">(待实现)</span>
              </span>
              <div class="flex gap-1">
                <kbd
                  v-for="k in item.keys"
                  :key="k"
                  class="inline-block rounded-[3px] border border-border bg-panel-2 px-1.5 py-px font-mono text-[length:var(--text-xs)] text-foreground"
                >{{ k }}</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
