export type UnifiedPatchLineKind =
  | 'context'
  | 'addition'
  | 'deletion'
  | 'metadata'

export interface UnifiedPatchLine {
  kind: UnifiedPatchLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface UnifiedPatchHunk {
  id: string
  header: string
  label: string
  lines: UnifiedPatchLine[]
}

export interface UnifiedPatchFile {
  id: string
  displayPath: string
  rawReference: string | null
  metadata: string[]
  hunks: UnifiedPatchHunk[]
}

export interface UnifiedPatchDocument {
  files: UnifiedPatchFile[]
}

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/u

function cleanPatchPath(raw: string): string | null {
  const withoutTimestamp = raw.split('\t', 1)[0]?.trim() ?? ''
  if (!withoutTimestamp || withoutTimestamp === '/dev/null') return null
  const unquoted = withoutTimestamp.startsWith('"') && withoutTimestamp.endsWith('"')
    ? withoutTimestamp.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, '\\')
    : withoutTimestamp
  return unquoted.replace(/^[ab]\//u, '') || null
}

function fileLabel(oldPath: string | null, newPath: string | null, fallbackIndex: number): string {
  return newPath ?? oldPath ?? `变更 ${fallbackIndex + 1}`
}

export function parseUnifiedPatch(text: string): UnifiedPatchDocument | null {
  const sourceLines = text.split('\n').map((line) => line.replace(/\r$/u, ''))
  const files: UnifiedPatchFile[] = []
  let current: {
    metadata: string[]
    oldPath: string | null
    newPath: string | null
    hunks: UnifiedPatchHunk[]
  } | null = null
  let currentHunk: UnifiedPatchHunk | null = null
  let oldLine = 0
  let newLine = 0
  let expectingNewPath = false

  const ensureFile = (): NonNullable<typeof current> => {
    current ??= { metadata: [], oldPath: null, newPath: null, hunks: [] }
    return current
  }
  const finishFile = (): void => {
    if (!current) return
    if (current.hunks.length > 0) {
      const index = files.length
      const displayPath = fileLabel(current.oldPath, current.newPath, index)
      files.push({
        id: `patch-file-${index + 1}`,
        displayPath,
        rawReference: current.newPath ?? current.oldPath,
        metadata: current.metadata,
        hunks: current.hunks
      })
    }
    current = null
    currentHunk = null
    expectingNewPath = false
  }

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index]
    if (line.startsWith('diff --git ')) {
      finishFile()
      ensureFile().metadata.push(line)
      continue
    }
    if (line.startsWith('--- ') && (!currentHunk || sourceLines[index + 1]?.startsWith('+++ '))) {
      if (currentHunk) finishFile()
      const file = ensureFile()
      file.oldPath = cleanPatchPath(line.slice(4))
      file.metadata.push(line)
      expectingNewPath = true
      continue
    }
    if (line.startsWith('+++ ') && expectingNewPath) {
      const file = ensureFile()
      file.newPath = cleanPatchPath(line.slice(4))
      file.metadata.push(line)
      expectingNewPath = false
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (header) {
      const file = ensureFile()
      expectingNewPath = false
      oldLine = Number(header[1])
      newLine = Number(header[3])
      const trailingLabel = header[5]?.trim()
      currentHunk = {
        id: `patch-hunk-${files.length + 1}-${file.hunks.length + 1}`,
        header: line,
        label: trailingLabel || `-${header[1]} +${header[3]}`,
        lines: []
      }
      file.hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) {
      if (current || line.trim()) ensureFile().metadata.push(line)
      continue
    }
    if (line.startsWith('+')) {
      currentHunk.lines.push({ kind: 'addition', text: line, oldLine: null, newLine })
      newLine += 1
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ kind: 'deletion', text: line, oldLine, newLine: null })
      oldLine += 1
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({ kind: 'context', text: line, oldLine, newLine })
      oldLine += 1
      newLine += 1
    } else {
      currentHunk.lines.push({ kind: 'metadata', text: line, oldLine: null, newLine: null })
    }
  }
  finishFile()
  return files.length > 0 ? { files } : null
}
