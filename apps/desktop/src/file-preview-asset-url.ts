const BLOCKED_SCHEME = /^[a-z][a-z0-9+.-]*:/iu

function decodedSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    if (!decoded || decoded.includes('/') || decoded.includes('\\') || /[\0\r\n]/u.test(decoded)) return null
    return decoded
  } catch {
    return null
  }
}

function pathSegments(value: string): string[] | null {
  const result: string[] = []
  for (const rawSegment of value.replace(/\\/gu, '/').split('/')) {
    if (!rawSegment || rawSegment === '.') continue
    const segment = decodedSegment(rawSegment)
    if (!segment) return null
    if (segment === '..') {
      if (result.length === 0) return null
      result.pop()
      continue
    }
    result.push(segment)
  }
  return result
}

export function filePreviewAssetUrl(
  rawReference: string,
  tabToken: string,
  basePath: string
): string | null {
  const reference = rawReference.trim()
  if (!reference || reference.startsWith('#') || BLOCKED_SCHEME.test(reference)) return null
  const suffixIndex = reference.search(/[?#]/u)
  const path = suffixIndex < 0 ? reference : reference.slice(0, suffixIndex)
  const suffix = suffixIndex < 0 ? '' : reference.slice(suffixIndex)
  const base = path.startsWith('/') || path.startsWith('\\')
    ? []
    : pathSegments(basePath)
  if (!base) return null
  const resolved = [...base]
  for (const rawSegment of path.replace(/\\/gu, '/').split('/')) {
    if (!rawSegment || rawSegment === '.') continue
    const segment = decodedSegment(rawSegment)
    if (!segment) return null
    if (segment === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
    } else {
      resolved.push(segment)
    }
  }
  if (resolved.length === 0) return null
  const encoded = resolved.map((segment) => encodeURIComponent(segment)).join('/')
  return `rovai-preview://asset/${encodeURIComponent(tabToken)}/${encoded}${suffix}`
}

export interface ParsedFilePreviewAssetUrl {
  tabToken: string
  pathSegments: string[]
}

export function parseFilePreviewAssetUrl(value: string): ParsedFilePreviewAssetUrl | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'rovai-preview:' || url.hostname !== 'asset' || url.username || url.password || url.port) {
    return null
  }
  const encoded = url.pathname.split('/').filter(Boolean)
  if (encoded.length < 2) return null
  const decoded = encoded.map(decodedSegment)
  if (decoded.some((segment) => segment === null || segment === '.' || segment === '..')) return null
  const [tabToken, ...segments] = decoded as string[]
  if (!/^[0-9a-f-]{36}$/iu.test(tabToken) || segments.length === 0) return null
  return { tabToken, pathSegments: segments }
}
