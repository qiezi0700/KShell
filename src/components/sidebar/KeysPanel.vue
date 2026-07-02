<script setup lang="ts">
import { onMounted } from 'vue'
import { KeyRound, Plus, FolderOpen, RefreshCw, Eye, Pencil, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  keys,
  refreshKeys,
  deleteKey,
  renameKey,
  algoLabel,
  shortFp,
  openKeyManagerGenerate,
  openKeyManagerImport,
  openKeyManagerViewKey,
} from '@/stores/keys'
import { toast } from '@/stores/toast'
import { openConfirm, openPrompt } from '@/stores/prompt'
import type { SshKey } from '@/api/keys'

onMounted(() => {
  refreshKeys()
})

async function confirmDelete(key: SshKey) {
  const ok = await openConfirm({
    title: '删除密钥',
    message: `确定删除密钥「${key.name}」吗?此操作不可撤销。`,
    confirmText: '删除',
    cancelText: '取消',
    destructive: true,
  })
  if (!ok) return
  try {
    await deleteKey(key.id)
    toast.info('密钥已删除')
  } catch (e: any) {
    toast.error(`删除失败: ${e?.message ?? e}`)
  }
}

async function startRename(key: SshKey) {
  const name = await openPrompt({
    title: '重命名密钥',
    message: '输入新名称',
    defaultValue: key.name,
    placeholder: '例如 my-key',
    confirmText: '保存',
    cancelText: '取消',
  })
  if (name === null) return
  if (!name.trim()) {
    toast.error('名称不能为空')
    return
  }
  try {
    await renameKey(key.id, name.trim())
    toast.success('已重命名')
  } catch (e: any) {
    toast.error(`重命名失败: ${e?.message ?? e}`)
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 工具栏 -->
    <div class="border-b border-sidebar-border px-2 py-1.5">
      <div class="flex items-center gap-1 pb-1.5">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="openKeyManagerGenerate()"><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent>生成密钥</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="openKeyManagerImport()"><FolderOpen /></Button>
          </TooltipTrigger>
          <TooltipContent>导入密钥</TooltipContent>
        </Tooltip>
        <span class="flex-1" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" @click="refreshKeys()"><RefreshCw /></Button>
          </TooltipTrigger>
          <TooltipContent>刷新</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- 密钥列表 -->
    <div class="flex-1 overflow-y-auto p-1">
      <div
        v-if="keys.length === 0"
        class="text-body px-3 py-6 text-center text-muted-foreground"
      >
        密钥库为空,点上方 + 生成或导入
      </div>

      <ContextMenu v-for="key in keys" :key="key.id" class="block">
        <ContextMenuTrigger as-child>
          <button
            class="group flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
            @dblclick="openKeyManagerViewKey(key.id)"
          >
            <KeyRound class="size-3.5 shrink-0 text-muted-foreground" />
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-body truncate font-medium">{{ key.name }}</span>
              <div class="text-caption truncate font-mono text-muted-foreground/80">
                {{ algoLabel(key.algorithm) }} · {{ shortFp(key.fingerprint) }}
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @select="openKeyManagerViewKey(key.id)">
            <Eye class="size-3.5" /> 查看公钥
          </ContextMenuItem>
          <ContextMenuItem @select="startRename(key)">
            <Pencil class="size-3.5" /> 重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" @select="confirmDelete(key)">
            <Trash2 class="size-3.5" /> 删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </div>
</template>
