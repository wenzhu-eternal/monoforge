import { describe, expect, it } from 'vitest'
import {
  emailRule,
  notifyContentRule,
  notifyTitleRule,
  passwordRule,
  phoneRule,
  usernameRule,
} from './form-rules'

// 辅助：把 Rule.validator 转成 Promise<boolean>，resolve 视为通过、reject 视为拒绝
// antd Rule 是复杂联合类型（含 RuleRender 函数形式），helper 一律按 unknown 接收

// biome-ignore lint/suspicious/noExplicitAny: antd Rule 联合类型过于复杂，测试 helper 统一放宽
type AnyRule = { validator?: (...args: any[]) => any }

function callValidator(rule: unknown, value: string): Promise<unknown> {
  const r = rule as AnyRule
  if (!r.validator) throw new Error('rule has no validator')
  return Promise.resolve(r.validator({}, value))
}

function runRule(rule: unknown, value: string) {
  return callValidator(rule, value).then(
    () => true,
    (err: unknown) => {
      throw err
    },
  )
}

async function runRuleReject(rule: unknown, value: string) {
  return callValidator(rule, value).then(
    () => {
      throw new Error('Expected rule to reject, but it resolved')
    },
    (err: unknown) => err,
  )
}

describe('form-rules', () => {
  describe('passwordRule', () => {
    it('合法密码（字母+数字，≥8 位）通过', async () => {
      await expect(runRule(passwordRule, 'abc12345')).resolves.toBe(true)
      await expect(runRule(passwordRule, 'Passw0rd')).resolves.toBe(true)
    })

    it('空值通过（可选字段，由 required 控制必填）', async () => {
      await expect(runRule(passwordRule, '')).resolves.toBe(true)
    })

    it('纯数字密码被拒（缺字母）', async () => {
      const err = await runRuleReject(passwordRule, '12345678')
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('字母')
    })

    it('纯字母密码被拒（缺数字）', async () => {
      const err = await runRuleReject(passwordRule, 'abcdefgh')
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('数字')
    })

    it('过短密码被拒（<8 位）', async () => {
      const err = await runRuleReject(passwordRule, 'ab1')
      expect((err as Error).message).toContain('8')
    })
  })

  describe('usernameRule', () => {
    it('合法用户名（字母/数字/下划线，3-50 位）通过', async () => {
      await expect(runRule(usernameRule, 'admin')).resolves.toBe(true)
      await expect(runRule(usernameRule, 'user_1')).resolves.toBe(true)
      await expect(runRule(usernameRule, 'ABC_123')).resolves.toBe(true)
    })

    it('空值通过（可选字段）', async () => {
      await expect(runRule(usernameRule, '')).resolves.toBe(true)
    })

    it('过短用户名被拒（<3 位）', async () => {
      const err = await runRuleReject(usernameRule, 'ab')
      expect((err as Error).message).toContain('3')
    })

    it('含空格被拒（防注入）', async () => {
      const err = await runRuleReject(usernameRule, 'a b')
      expect((err as Error).message).toContain('字母、数字、下划线')
    })

    it('含连字符被拒', async () => {
      const err = await runRuleReject(usernameRule, 'a-b')
      expect((err as Error).message).toContain('字母、数字、下划线')
    })
  })

  describe('emailRule', () => {
    it('合法邮箱通过', async () => {
      await expect(runRule(emailRule, 'admin@example.com')).resolves.toBe(true)
      await expect(runRule(emailRule, 'user.name@sub.example.co')).resolves.toBe(true)
    })

    it('空值通过（可选字段）', async () => {
      await expect(runRule(emailRule, '')).resolves.toBe(true)
    })

    it('缺 @ 被拒', async () => {
      const err = await runRuleReject(emailRule, 'adminexample.com')
      expect(err).toBeInstanceOf(Error)
    })

    it('微信占位邮箱域被拒（系统保留）', async () => {
      const err = await runRuleReject(emailRule, 'user@wechat.placeholder')
      expect((err as Error).message).toContain('保留')
    })
  })

  describe('phoneRule', () => {
    it('合法手机号通过', async () => {
      await expect(runRule(phoneRule, '13800138000')).resolves.toBe(true)
      await expect(runRule(phoneRule, '19912345678')).resolves.toBe(true)
    })

    it('空值通过（选填字段）', async () => {
      await expect(runRule(phoneRule, '')).resolves.toBe(true)
    })

    it('第二位非 3-9 被拒', async () => {
      const err = await runRuleReject(phoneRule, '12345678901')
      expect((err as Error).message).toContain('手机号')
    })

    it('位数不足被拒', async () => {
      const err = await runRuleReject(phoneRule, '1380013800')
      expect((err as Error).message).toContain('手机号')
    })

    it('非数字被拒', async () => {
      const err = await runRuleReject(phoneRule, 'abcdefghijk')
      expect((err as Error).message).toContain('手机号')
    })
  })

  describe('notify rules（复用 shared NotifySchema）', () => {
    it('标题 200 字符通过，201 字符被拒', async () => {
      await expect(runRule(notifyTitleRule, 'a'.repeat(200))).resolves.toBe(true)
      const err = await runRuleReject(notifyTitleRule, 'a'.repeat(201))
      expect((err as Error).message).toContain('200')
    })

    it('标题空值交给 required 控制，validator 放行', async () => {
      await expect(runRule(notifyTitleRule, '')).resolves.toBe(true)
    })

    it('内容空值/2000 字符通过，2001 字符被拒', async () => {
      await expect(runRule(notifyContentRule, '')).resolves.toBe(true)
      await expect(runRule(notifyContentRule, 'a'.repeat(2000))).resolves.toBe(true)
      const err = await runRuleReject(notifyContentRule, 'a'.repeat(2001))
      expect((err as Error).message).toContain('2000')
    })
  })
})
