import type { FileLocationTarget, ParsedFileReference } from '@contracts'

const DISALLOWED_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i
const UNC_PATH = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const LINE_FRAGMENT = /^L([1-9]\d*)(?:C([1-9]\d*))?(?:-L?([1-9]\d*)(?:C([1-9]\d*))?)?$/i
const LINE_AND_COLUMN_SUFFIX = /^(.*):([1-9]\d*):([1-9]\d*)$/
const LINE_SUFFIX = /^(.*):([1-9]\d*)$/
const KNOWN_FILE_EXTENSION = /\.(?:md|markdown|mdown|mkd|mdx|html?|tsx?|mts|cts|jsx?|mjs|cjs|pyw?|pyi|rb|rake|php|lua|rs|go|java|kts?|swift|dart|c|h|cc|cpp|cxx|hh|hpp|hxx|cs|m|mm|sh|bash|zsh|fish|ps1|psm1|bat|cmd|css|scss|sass|less|vue|svelte|hbs|handlebars|pug|jsonc?|json5|ya?ml|toml|ini|cfg|conf|env|properties|xml|xsd|xsl|plist|sql|pgsql|graphql|gql|cypher|tf|tfvars|hcl|proto|csv|tsv|txt|log|diff|patch|png|jpe?g|gif|webp|avif|bmp|ico|svg|pdf|docx?|xlsx?|pptx?|zip|tar|gz|7z|rar)(?=$|[:#?])/i
const TRAILING_PUNCTUATION = /[.,;!?，。；！？、'"”’)>\]}]+$/u
const LEADING_PUNCTUATION = /^[('"“‘<\[{]+/u

function decodeOnce(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.includes('\0') ? null : decoded
  } catch {
    return null
  }
}

function stripBalancedWrapper(raw: string): string {
  const pairs: Record<string, string> = {
    '`': '`',
    '"': '"',
    "'": "'",
    '(': ')',
    '[': ']',
    '{': '}',
    '<': '>'
  }
  const end = pairs[raw[0] ?? '']
  return end && raw.endsWith(end) ? raw.slice(1, -1) : raw
}

function parseFragment(fragment: string | undefined): FileLocationTarget | undefined {
  if (!fragment) return undefined
  const line = LINE_FRAGMENT.exec(fragment)
  if (line) {
    return {
      line: Number(line[1]),
      column: line[2] ? Number(line[2]) : undefined,
      endLine: line[3] ? Number(line[3]) : undefined,
      endColumn: line[4] ? Number(line[4]) : undefined
    }
  }
  return { heading: fragment, htmlFragment: fragment }
}

function splitLineSuffix(path: string): { path: string; target?: FileLocationTarget } {
  const lineAndColumn = LINE_AND_COLUMN_SUFFIX.exec(path)
  if (lineAndColumn?.[1] && !/^[a-z]$/i.test(lineAndColumn[1])) {
    return {
      path: lineAndColumn[1],
      target: { line: Number(lineAndColumn[2]), column: Number(lineAndColumn[3]) }
    }
  }
  const line = LINE_SUFFIX.exec(path)
  if (line?.[1] && !/^[a-z]$/i.test(line[1])) {
    return { path: line[1], target: { line: Number(line[2]) } }
  }
  return { path }
}

function splitQueryAndFragment(reference: string): {
  path: string
  query?: string
  fragment?: string
} {
  const hashIndex = reference.indexOf('#')
  const beforeHash = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference
  const fragment = hashIndex >= 0 ? reference.slice(hashIndex + 1) : undefined
  const queryIndex = beforeHash.indexOf('?')
  return {
    path: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    query: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : undefined,
    fragment
  }
}

function fileUriParts(reference: string): {
  path: string
  query?: string
  fragment?: string
} | null {
  try {
    const url = new URL(reference)
    if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) return null
    const decoded = decodeOnce(url.pathname)
    if (decoded === null) return null
    const windowsPath = /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1) : decoded
    return {
      path: windowsPath,
      query: url.search ? url.search.slice(1) : undefined,
      fragment: url.hash ? url.hash.slice(1) : undefined
    }
  } catch {
    return null
  }
}

export function parseFileReference(input: string): ParsedFileReference | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4_096) return null
  const raw = input.trim()
  if (!raw || raw.includes('\0')) return null
  const reference = stripBalancedWrapper(raw)
  if (!reference || reference.includes('\0')) return null

  const isFileUri = /^file:\/\//i.test(reference)
  if (!isFileUri && DISALLOWED_SCHEME.test(reference) && !WINDOWS_ABSOLUTE.test(reference)) {
    return null
  }

  const parts = isFileUri ? fileUriParts(reference) : splitQueryAndFragment(reference)
  if (!parts || !parts.path) return null
  const decodedPath = isFileUri ? parts.path : decodeOnce(parts.path)
  if (decodedPath === null || !decodedPath.trim()) return null

  const decodedFragment = parts.fragment === undefined ? undefined : decodeOnce(parts.fragment)
  if (decodedFragment === null) return null
  let pathPart = decodedPath
  let target = parseFragment(decodedFragment)
  if (decodedFragment && /^L/i.test(decodedFragment) && target?.heading !== undefined) return null
  if (!decodedFragment) {
    const suffix = splitLineSuffix(pathPart)
    pathPart = suffix.path
    target = suffix.target
  }

  const pathKind: ParsedFileReference['pathKind'] = isFileUri
    ? 'file_uri'
    : WINDOWS_ABSOLUTE.test(pathPart)
      ? 'windows_absolute'
      : UNC_PATH.test(pathPart)
        ? 'unc'
        : pathPart.startsWith('/')
          ? 'unix_absolute'
          : pathPart.startsWith('~/') || pathPart.startsWith('~\\')
            ? 'home_relative'
            : 'relative'

  return {
    raw,
    pathPart,
    query: parts.query || undefined,
    fragment: decodedFragment || undefined,
    target,
    pathKind
  }
}

export interface FileReferenceToken {
  start: number
  end: number
  raw: string
  parsed: ParsedFileReference
}

function highConfidenceBareReference(raw: string, parsed: ParsedFileReference): boolean {
  if (parsed.pathKind !== 'relative') return true
  if (raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('.\\') || raw.startsWith('..\\')) return true
  const hasSeparator = parsed.pathPart.includes('/') || parsed.pathPart.includes('\\')
  return hasSeparator && (KNOWN_FILE_EXTENSION.test(raw) || parsed.target?.line !== undefined)
}

export function isInlineFileReference(raw: string): boolean {
  const parsed = parseFileReference(raw)
  if (!parsed) return false
  return highConfidenceBareReference(raw, parsed)
    || (parsed.pathKind === 'relative' && KNOWN_FILE_EXTENSION.test(raw))
}

export function tokenizeFileReferences(text: string): FileReferenceToken[] {
  if (!text || text.length > 1_048_576) return []
  const tokens: FileReferenceToken[] = []
  const candidatePattern = /(?:file:\/\/\/[^\s<>`，。；！？、]+|[a-z]:[\\/][^\s<>`，。；！？、]+|\\\\[^\s<>`，。；！？、]+|\/\/[^\s<>`，。；！？、]+|~[\\/][^\s<>`，。；！？、]+|\.\.?[\\/][^\s<>`，。；！？、]+|\/[A-Za-z0-9._~%+@-][^\s<>`，。；！？、]*|[A-Za-z0-9_.@-]+(?:[\\/][A-Za-z0-9_.@%+()#?:=-]+)+)/giu
  for (const match of text.matchAll(candidatePattern)) {
    const matched = match[0]
    if (text[(match.index ?? 0) - 1] === '<') continue
    const leading = matched.match(LEADING_PUNCTUATION)?.[0].length ?? 0
    const withoutLeading = matched.slice(leading)
    const trailing = withoutLeading.match(TRAILING_PUNCTUATION)?.[0].length ?? 0
    const raw = withoutLeading.slice(0, withoutLeading.length - trailing)
    const parsed = parseFileReference(raw)
    const previousCharacter = text[(match.index ?? 0) - 1]
    if (parsed?.pathKind === 'windows_absolute' && previousCharacter && /[a-z0-9+.-]/i.test(previousCharacter)) continue
    if (!parsed || !highConfidenceBareReference(raw, parsed)) continue
    const start = (match.index ?? 0) + leading
    tokens.push({ start, end: start + raw.length, raw, parsed })
  }
  return tokens
}
