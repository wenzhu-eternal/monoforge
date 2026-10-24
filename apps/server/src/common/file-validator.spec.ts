import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanForMalware, validateExtension, validateMimeType } from './file-validator'

describe('上传安全边界（M4/J1=A）', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mf-file-validator-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('text/html 已从 mime 白名单剔除，svg 仍允许', () => {
    expect(() => validateMimeType('text/html')).toThrow('不允许的文件类型')
    expect(() => validateMimeType('image/svg+xml')).not.toThrow()
  })

  it('html 扩展名同步剔除（与服务端 mime 口径一致）', () => {
    expect(() => validateExtension('page.html')).toThrow('不允许的文件扩展名')
    expect(() => validateExtension('icon.svg')).not.toThrow()
  })

  it.each([
    ['script', '<svg><script>alert(1)</script></svg>'],
    ['iframe', '<svg><iframe src="https://evil.example"></iframe></svg>'],
    ['embed', '<svg><embed src="https://evil.example"></svg>'],
    ['object', '<svg><object data="https://evil.example"></object></svg>'],
    ['foreignObject', '<svg><foreignObject><div onclick="x()">x</div></foreignObject></svg>'],
    ['事件属性', '<svg onload="alert(1)"></svg>'],
    ['javascript 协议', '<svg><a xlink:href="javascript:alert(1)">x</a></svg>'],
  ])('SVG 内嵌 %s 被隔离', async (_label, content) => {
    const file = join(dir, `${_label}.svg`)
    await writeFile(file, content, 'latin1')
    await expect(scanForMalware(file)).rejects.toThrow('文件已被隔离')
  })

  // L13：XML 实体/控制字符可在属性值内把协议与标签名拆开，绕过字面正则
  it.each([
    ['十六进制换行实体', '<svg><a xlink:href="jav&#x0A;ascript:alert(1)">x</a></svg>'],
    ['十进制字符实体', '<svg><a xlink:href="&#106;avascript:alert(1)">x</a></svg>'],
    ['冒号实体', '<svg><image href="data&#58;text/html;base64,PHNjcmlwdD4="/></svg>'],
    ['字面控制字符', '<svg><a xlink:href="jav\r\nascript:alert(1)">x</a></svg>'],
    [
      '命名实体拆分协议',
      '<svg><a xlink:href="jav&NewLine;a&Tab;script&colon;alert(1)">x</a></svg>',
    ],
    ['斜杠分隔事件属性', '<svg><image src=x/onerror=alert(1)></svg>'],
  ])('SVG 实体/控制字符变形 %s 被隔离', async (_label, content) => {
    const file = join(dir, `${_label}.svg`)
    await writeFile(file, content, 'latin1')
    await expect(scanForMalware(file)).rejects.toThrow('文件已被隔离')
  })

  it('普通 SVG 通过内容扫描', async () => {
    const file = join(dir, 'ok.svg')
    await writeFile(file, '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', 'latin1')
    await expect(scanForMalware(file)).resolves.toBeUndefined()
  })
})
