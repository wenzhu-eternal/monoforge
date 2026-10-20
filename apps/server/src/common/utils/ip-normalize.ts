/**
 * M5/M6：限流/封顶键的 IP 归一——保留 IPv4 前三段（/24 网段）与 IPv6 动态段，
 * 折叠末段以在"来源维度独立计数"与"防 key 空间爆炸"之间取平衡。
 *
 * 背景：审计匿名封顶原用 replace(/\d+/g, ':id') 把任意 IPv4 折叠成同一键
 * （audit:record:ip:.:id.:id.:id.:id），全网匿名共享同一 10/min 预算——botnet
 * 用 ≥3 个 IP 打登录失败即可烧穿，此后同分钟内其他来源的匿名审计记录被静默丢弃，
 * 爆破痕迹只剩最早几条，取证完整性被实现手法自毁。
 *
 * IPv4：保留前三段，末段折叠为 ':id' → 1.2.3.4 / 1.2.3.99 同桶（/24），1.2.4.x 异桶。
 * IPv6：保留前 4 组，其余折叠（动态隐私地址每请求变，末段无归一意义）。
 * 非法/缺失：归一为 'unknown'，同一 fallback 桶。
 */
export function normalizeIpForKey(ip: string | undefined): string {
  if (!ip) return 'unknown'
  const raw = ip.trim()

  // IPv4（含 ::ffff:a.b.c.d 映射地址取内嵌 v4）；L17⑤：校验各段 ≤255——
  // 999.999.999.999 之类非法串不再自成一桶，落 unknown
  const v4 = raw.startsWith('::ffff:') ? raw.slice(7) : raw
  const v4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
  if (v4Match && v4Match.slice(1).every((part) => Number(part) <= 255)) {
    return `${v4Match[1]}.${v4Match[2]}.${v4Match[3]}.:id`
  }

  // IPv6：按 ':' 分组，保留前 4 组，其余折叠
  if (raw.includes(':')) {
    const groups = raw.split(':').filter((g) => g !== '')
    return `${groups.slice(0, 4).join(':')}:id`
  }

  return 'unknown'
}
