import { env } from '@/lib/env'

/**
 * 品牌配置 - 集中管理所有品牌相关文案
 *
 * 新项目接入时修改 VITE_APP_NAME 环境变量即可，无需改代码
 */

/** 应用名称（侧边栏 Logo、页面标题等） */
export const APP_NAME = env.VITE_APP_NAME

/** 应用简称（折叠态显示） */
export const APP_SHORT_NAME = env.VITE_APP_SHORT_NAME
