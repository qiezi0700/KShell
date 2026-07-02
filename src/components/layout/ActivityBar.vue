<script setup lang="ts">
import { mainPanels, activePanel } from '@/stores/sidebar-panels'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
</script>

<template>
  <nav class="flex w-[44px] shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-2">
    <Tooltip v-for="p in mainPanels" :key="p.key">
      <TooltipTrigger as-child>
        <button
          :class="cn(
            'flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            activePanel === p.key && 'bg-sidebar-accent/60 text-foreground',
          )"
          @click="activePanel = p.key"
        >
          <component :is="p.icon" class="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{{ p.label }}</TooltipContent>
    </Tooltip>
  </nav>
</template>
