/**
 * M5/M6：限流/封顶键的 IP 归一——保留 IPv4 前三段（/24 网段）与 IPv6 前 64 位，
 * 折叠其余部分以在"来源维度独立计数"与"防 key 空间爆炸"之间取平衡。
 *
 * 背景：审计匿名封顶原用 replace(/\d+/g, ':id') 把任意 IPv4 折叠成同一键
 * （audit:record:ip:.:id.:id.:id.:id），全网匿名共享同一 10/min 预算——botnet
 * 用 ≥3 个 IP 打登录失败即可烧穿，此后同分钟内其他来源的匿名审计记录被静默丢弃，
 * 爆破痕迹只剩最早几条，取证完整性被实现手法自毁。
 *
 * IPv4：保留前三段，末段折叠为 ':id' → 1.2.3.4 / 1.2.3.99 同桶（/24），1.2.4.x 异桶。
 * IPv6：先做等价写法归一（压缩 / 大小写 / IPv4 映射），再按前 4 组（/64）折叠——
 * P2-02：原实现直接丢弃 '::' 零组，导致同一 /64 的等价写法落入不同桶。
 * 非法/缺失：归一为 'unknown'，同一 fallback 桶。
 */
const IPV6_GROUP_COUNT = 8
const IPV6_PREFIX_GROUPS = 4

/** 将 IPv6 文本展开为 8 组 16 位整数；非法输入返回 null */
function expandIpv6(input: string): number[] | null {
  let addr = input.toLowerCase()
  const zoneIndex = addr.indexOf('%')
  if (zoneIndex >= 0) addr = addr.slice(0, zoneIndex)

  // 末尾内嵌 IPv4（::ffff:1.2.3.4 等）转为两组十六进制
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    if (lastColon < 0) return null
    const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr.slice(lastColon + 1))
    if (!v4Match) return null
    const octets = v4Match.slice(1).map(Number)
    if (octets.some((part) => part > 255)) return null
    const [a, b, c, d] = octets as [number, number, number, number]
    addr = `${addr.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const parts = addr.split('::')
  if (parts.length > 2) return null
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []

  let groups: string[]
  if (parts.length === 2) {
    const missing = IPV6_GROUP_COUNT - head.length - tail.length
    if (missing < 1) return null
    groups = [...head, ...new Array<string>(missing).fill('0'), ...tail]
  } else {
    if (head.length !== IPV6_GROUP_COUNT) return null
    groups = head
  }

  const parsed: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    parsed.push(Number.parseInt(group, 16))
  }
  return parsed
}

/** IPv4 /24 桶格式；非法 IPv4 返回 null */
function normalizeIpv4(value: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!match) return null
  if (!match.slice(1).every((part) => Number(part) <= 255)) return null
  return `${match[1]}.${match[2]}.${match[3]}.:id`
}

export function normalizeIpForKey(ip: string | undefined): string {
  if (!ip) return 'unknown'
  const raw = ip.trim()
  const lower = raw.toLowerCase()

  // IPv4（含 ::ffff:a.b.c.d 映射地址取内嵌 v4；L17⑤：各段 ≤255 校验，
  // 999.999.999.999 之类非法串不再自成一桶，落 unknown）
  const v4 = lower.startsWith('::ffff:') ? raw.slice(7) : raw
  const v4Key = normalizeIpv4(v4)
  if (v4Key) return v4Key

  if (raw.includes(':')) {
    const groups = expandIpv6(raw)
    if (!groups) return 'unknown'
    // 展开后的 IPv4 映射地址（0:0:0:0:0:ffff:a.b.c.d）与压缩写法归同一桶
    const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
    if (isMapped) {
      const [high, low] = [groups[6] as number, groups[7] as number]
      const mapped = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
      return normalizeIpv4(mapped) ?? 'unknown'
    }
    const prefix = groups
      .slice(0, IPV6_PREFIX_GROUPS)
      .map((group) => group.toString(16))
      .join(':')
    return `${prefix}:id`
  }

  return 'unknown'
}
