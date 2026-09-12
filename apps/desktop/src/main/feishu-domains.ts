export type FeishuBrand = 'feishu' | 'lark'

// larkoffice is also used by mainland Feishu. Brand is an exact host mapping.
const PORTALS: Readonly<Record<string, FeishuBrand>> = {
  'open.feishu.cn': 'feishu',
  'open.larkoffice.com': 'feishu',
  'open.larksuite.com': 'lark'
}
const LOGIN_HOSTS = new Set([
  'accounts.feishu.cn', 'passport.feishu.cn',
  'accounts.larkoffice.com', 'passport.larkoffice.com',
  'accounts.larksuite.com', 'passport.larksuite.com'
])
const COOKIE_ROOTS = ['feishu.cn', 'larkoffice.com', 'larksuite.com']

export function trustedFeishuUrl(value: string, base?: string): URL {
  let url: URL
  try { url = new URL(value, base) } catch { throw new Error('feishu_session_url_rejected') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || (!Object.hasOwn(PORTALS, url.hostname) && !LOGIN_HOSTS.has(url.hostname))) {
    throw new Error('feishu_session_url_rejected')
  }
  return url
}

export function isFeishuLoginUrl(value: string): boolean {
  try { return LOGIN_HOSTS.has(trustedFeishuUrl(value).hostname) } catch { return false }
}

export function openPlatformOrigin(value: string, brand?: FeishuBrand): string {
  let url: URL
  try { url = trustedFeishuUrl(value) } catch {
    throw new Error('feishu_open_platform_origin_rejected')
  }
  const actual = PORTALS[url.hostname]
  if (!actual || (brand && actual !== brand)) {
    throw new Error('feishu_open_platform_origin_rejected')
  }
  return url.origin
}

export function brandForPortal(value: string): FeishuBrand {
  return PORTALS[new URL(openPlatformOrigin(value)).hostname]!
}

export function portalUrlForBrand(brand: FeishuBrand, origin?: string): string {
  return `${origin ? openPlatformOrigin(origin, brand)
    : brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'}/app?lang=zh-CN`
}

export function openPlatformApiUrl(value: string, origin: string): string {
  let url: URL
  try { url = trustedFeishuUrl(value, openPlatformOrigin(origin)) } catch {
    throw new Error('feishu_open_platform_api_url_rejected')
  }
  if (url.origin !== origin || !url.pathname.startsWith('/developers/') || url.hash) {
    throw new Error('feishu_open_platform_api_url_rejected')
  }
  return url.href
}

export function isFeishuCookieDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return COOKIE_ROOTS.some((root) => host === root || host.endsWith(`.${root}`))
}
