import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @tailwindcss/vite 4.3.2 的 ESM 产物仅提供 default 导出（无 tailwindcss 命名导出），命名导入会在 vitest 加载 config 时抛 SyntaxError
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react-swc'
// 从 vitest/config 导入，使其同时识别 test 字段（vite 的 defineConfig 不含 test）
import { defineConfig } from 'vitest/config'

// 读根目录 .env 的指定变量（不用 vite 的 loadEnv：显式 import 'vite' 会与 vitest 内置 vite 形成双实例冲突）
function readRootEnv(key: string): string | undefined {
  const envPath = resolve(__dirname, '../../.env')
  if (!existsSync(envPath)) return undefined
  const line = readFileSync(envPath, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : undefined
}

// VITE_DEV_HOST: 默认仅监听 localhost（防局域网未授权访问）；ngrok 调试等场景设 0.0.0.0
const devHost = process.env.VITE_DEV_HOST || readRootEnv('VITE_DEV_HOST') || 'localhost'

export default defineConfig({
  plugins: [TanStackRouterVite({ quoteStyle: 'single' }), react(), tailwindcss()],
  // .env 在 monorepo 根目录，指定 envDir 让 Vite 正确加载并注入 index.html 的 %VITE_*%
  envDir: resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../../packages/shared/src/index'),
      '@shared/': resolve(__dirname, '../../packages/shared/src/'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 拆分大依赖，避免单个 chunk 过大
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@tanstack/')) return 'vendor-router'
          if (id.includes('antd/') || id.includes('@ant-design/')) return 'vendor-antd'
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    port: 3000,
    host: devHost,
    allowedHosts: ['.ngrok-free.dev'],
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'ws://localhost:9000',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/mocks/**',
        'src/test/**',
      ],
    },
  },
})
