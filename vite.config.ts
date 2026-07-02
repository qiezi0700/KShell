import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const host = process.env.TAURI_DEV_HOST

export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  build: {
    // 把大依赖拆成独立 chunk,避免主 bundle 过大
    rollupOptions: {
      output: {
        manualChunks: {
          // xterm 体量大且只在终端 tab 用,独立成块
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          // echarts 由 MonitorDialog 动态 import 自动 code-split + tree-shake,不在此强制合并
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
