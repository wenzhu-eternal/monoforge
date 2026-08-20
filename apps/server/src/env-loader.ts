import { config } from 'dotenv'

// 与 db/index.ts 同路径加载根 .env；生产容器由 compose 注入环境变量，文件缺失时无害
config({ path: '../../.env' })
