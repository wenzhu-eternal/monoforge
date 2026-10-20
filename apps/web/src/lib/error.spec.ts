import { describe, expect, it } from 'vitest'
import { extractErrorMessage } from './error'

describe('extractErrorMessage（L5）', () => {
  it('responseType=blob 的错误体不落 axios 英文裸文案', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: { data: new Blob(['{"message":"文件不存在"}'], { type: 'application/json' }) },
    }
    expect(extractErrorMessage(error, '预览失败')).toBe('预览失败')
  })

  it('普通 JSON 错误体仍优先取后端 message', () => {
    const error = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { data: { message: '文件名过长' } },
    }
    expect(extractErrorMessage(error)).toBe('文件名过长')
  })
})
