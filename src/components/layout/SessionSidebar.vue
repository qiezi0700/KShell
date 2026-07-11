<script setup lang="ts">
import { Sidebar, SidebarContent, SidebarFooter } from '@/components/ui/sidebar'
import ActivityBar from '@/components/layout/ActivityBar.vue'
import { currentPanel, footerPanels, sidebarWidth, sidebarResizing, setSidebarWidth, persistSidebarWidth } from '@/stores/sidebar-panels'
import { toast } from '@/stores/toast'

function startResize(e: MouseEvent) {
  e.preventDefault()
  sidebarResizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  const onMove = (ev: MouseEvent) => {
    setSidebarWidth(startWidth + ev.clientX - startX)
  }
  const onUp = () => {
    sidebarResizing.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    void persistSidebarWidth().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error), '侧栏宽度保存失败')
    })
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<template>
  <Sidebar
    collapsible="offcanvas"
    class="border-r border-sidebar-border"
  >
    <div class="flex h-full">
      <ActivityBar />
      <div class="flex min-w-0 flex-1 flex-col">
        <SidebarContent class="px-0">
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <component v-if="currentPanel" :is="currentPanel.component" />
          </div>
        </SidebarContent>

        <SidebarFooter class="p-0">
          <component
            v-for="f in footerPanels"
            :key="f.key"
            :is="f.component"
          />
        </SidebarFooter>
      </div>
    </div>
    <!-- 拖拽调整侧栏宽度 -->
    <div
      class="absolute right-0 top-0 bottom-0 z-20 w-1 cursor-col-resize hover:bg-primary/30"
      :class="sidebarResizing && 'bg-primary/40'"
      @mousedown="startResize"
    />
  </Sidebar>
</template>
