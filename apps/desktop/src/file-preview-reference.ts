import type { FileLocationTarget, ParsedFileReference } from '@contracts'

const DISALLOWED_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i
const UNC_PATH = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const LINE_FRAGMENT = /^L([1-9]\d*)(?:C([1-9]\d*))?(?:-L?([1-9]\d*)(?:C([1-9]\d*))?)?$/i
const LINE_AND_COLUMN_SUFFIX = /^(.*):([1-9]\d*):([1-9]\d*)$/
const LINE_SUFFIX = /^(.*):([1-9]\d*)$/
const LINE_RANGE_SUFFIX = /^(.*):([1-9]\d*)-([1-9]\d*)$/

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
  const range = LINE_RANGE_SUFFIX.exec(path)
  if (range?.[1]) {
    return { path: range[1], target: { line: Number(range[2]), endLine: Number(range[3]) } }
  }
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

function isLocatedFilePath(path: string): boolean {
  if (DISALLOWED_SCHEME.test(path) || WINDOWS_ABSOLUTE.test(path)) return false
  const fileName = path.split(/[\\/]/u).at(-1) ?? ''
  const extensionOffset = fileName.lastIndexOf('.')
  return extensionOffset > 0 && extensionOffset < fileName.length - 1
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
  const locatedFile = splitLineSuffix(reference)
  if (!isFileUri && DISALLOWED_SCHEME.test(reference) && !WINDOWS_ABSOLUTE.test(reference)
    && !(locatedFile.target && isLocatedFilePath(locatedFile.path))) {
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
  if (target && (
    [target.line, target.column, target.endLine, target.endColumn]
      .some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    || (target.line !== undefined && target.endLine !== undefined && target.endLine < target.line)
  )) return null

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
