import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Node 端 MSW server，供单元测试使用
export const server = setupServer(...handlers)
