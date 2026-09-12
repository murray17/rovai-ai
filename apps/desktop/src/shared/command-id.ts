/** UUID v4 also works on explicitly enabled HTTP LAN origins, where browsers
 * expose getRandomValues but can omit randomUUID. Never use Math.random. */
export function newCommandId(source: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (source?.randomUUID) return source.randomUUID()
  if (!source?.getRandomValues) throw new Error('浏览器缺少安全随机数能力，无法提交命令。')
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
