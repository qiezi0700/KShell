import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const host = process.env.TAURI_DEV_HOST

// 需静默的 rolldown log code:
// - INVALID_ANNOTATION: @vueuse/core 14.x 上游 PURE 注释位置不规范,等上游修复
// - INEFFICIENT_DYNAMIC_IMPORT: @tauri-apps/api/webview 静态依赖 window,
//   TitleBar 的动态 import 无法拆 chunk,功能无影响
// - PLUGIN_TIMINGS: 插件耗时统计,桌面构建无需关注
const SILENCE_LOG_CODES = new Set(['INVALID_ANNOTATION', 'INEFFECTIVE_DYNAMIC_IMPORT', 'PLUGIN_TIMINGS'])

export default defineConfig(() => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  build: {
    // 桌面应用本地加载,chunk 略大无碍;放宽阈值避免误报
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      onLog(_level, log) {
        if (log.code && SILENCE_LOG_CODES.has(log.code)) return
      },
      output: {
        // vite 8 起 manualChunks 类型只接受函数形式
        manualChunks(id) {
          if (id.includes('node_modules/@xterm/')) return 'xterm'
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}))
