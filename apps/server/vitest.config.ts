import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 注：vitest 4 默认 oxc 转换器不读 tsconfig 的 experimentalDecorators，
  // spec 文件里不能写装饰器语法——需测装饰器行为时直接引用真实生产代码（见 audit.interceptor.spec.ts）
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.d.ts'],
      // T01：分阶段上调至 TESTING.md 要求的 80/70；当前为基线防回归门禁（略低于实测基线）
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
    setupFiles: ['./test/setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
})
