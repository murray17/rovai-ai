export type FeishuBrand = 'feishu' | 'lark'

// One trusted set per provider. The sets are disjoint: a hop into the other
// provider's hosts is rejected, and brand is never inferred from a substring.
export interface OpenPlatformDomains {
  readonly brand: FeishuBrand
  readonly defaultOrigin: string
  readonly portalHosts: ReadonlySet<string>
  readonly loginHosts: ReadonlySet<string>
  readonly cookieRoots: readonly string[]
}

// larkoffice is also used by mainland Feishu. Brand is an exact host mapping.
export const FEISHU_DOMAINS: OpenPlatformDomains = Object.freeze({
  brand: 'feishu',
  defaultOrigin: 'https://open.feishu.cn',
  portalHosts: new Set(['open.feishu.cn', 'open.larkoffice.com']),
  loginHosts: new Set([
    'accounts.feishu.cn', 'passport.feishu.cn',
    'accounts.larkoffice.com', 'passport.larkoffice.com'
  ]),
  cookieRoots: Object.freeze(['feishu.cn', 'larkoffice.com'])
})

export const LARK_DOMAINS: OpenPlatformDomains = Object.freeze({
  brand: 'lark',
  defaultOrigin: 'https://open.larksuite.com',
  portalHosts: new Set(['open.larksuite.com']),
  loginHosts: new Set(['accounts.larksuite.com', 'passport.larksuite.com']),
  cookieRoots: Object.freeze(['larksuite.com'])
})

export function trustedFeishuUrl(value: string, base: string | undefined, domains: OpenPlatformDomains): URL {
  let url: URL
  try { url = new URL(value, base) } catch { throw new Error('feishu_session_url_rejected') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || (!domains.portalHosts.has(url.hostname) && !domains.loginHosts.has(url.hostname))) {
    throw new Error('feishu_session_url_rejected')
  }
  return url
}

export function isFeishuLoginUrl(value: string, domains: OpenPlatformDomains): boolean {
  try { return domains.loginHosts.has(trustedFeishuUrl(value, undefined, domains).hostname) } catch { return false }
}

export function openPlatformOrigin(value: string, domains: OpenPlatformDomains): string {
  let url: URL
  try { url = trustedFeishuUrl(value, undefined, domains) } catch {
    throw new Error('feishu_open_platform_origin_rejected')
  }
  if (!domains.portalHosts.has(url.hostname)) throw new Error('feishu_open_platform_origin_rejected')
  return url.origin
}

export function brandForPortal(value: string, domains: OpenPlatformDomains): FeishuBrand {
  openPlatformOrigin(value, domains)
  return domains.brand
}

export function portalUrlFor(domains: OpenPlatformDomains, origin?: string): string {
  return `${origin ? openPlatformOrigin(origin, domains) : domains.defaultOrigin}/app?lang=zh-CN`
}

export function openPlatformApiUrl(value: string, origin: string, domains: OpenPlatformDomains): string {
  let url: URL
  try { url = trustedFeishuUrl(value, openPlatformOrigin(origin, domains), domains) } catch {
    throw new Error('feishu_open_platform_api_url_rejected')
  }
  if (url.origin !== origin || !url.pathname.startsWith('/developers/') || url.hash) {
    throw new Error('feishu_open_platform_api_url_rejected')
  }
  return url.href
}

export function isFeishuCookieDomain(domain: string, domains: OpenPlatformDomains): boolean {
  const host = domain.replace(/^\./, '').toLowerCase()
  return domains.cookieRoots.some((root) => host === root || host.endsWith(`.${root}`))
}
