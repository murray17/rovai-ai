import type { AgentRunFileChangesView } from '@contracts'

export function agentRunFileChangesSummaryLabel(changes: AgentRunFileChangesView): string {
  if (changes.additions !== undefined && changes.deletions !== undefined) {
    return `${changes.fileCount} 个文件 · +${changes.additions} −${changes.deletions}`
  }
  return `${changes.fileCount} 个文件 · ${changes.operationCount} 次修改`
}

export function agentRunFileChangeModeLabel(
  presentationKind: AgentRunFileChangesView['files'][number]['presentationKind']
): string {
  if (presentationKind === 'full_net_diff') return '完整差异'
  if (presentationKind === 'exact_mutations') return '片段差异'
  if (presentationKind === 'operation_history') return '操作记录'
  return '仅文件操作'
}

export function agentRunFileChangeKindMark(changeKind: string): string {
  if (changeKind === 'add' || changeKind === 'create') return 'A'
  if (changeKind === 'delete' || changeKind === 'remove') return 'D'
  return 'M'
}

export function agentRunFilePathParts(path: string): { basename: string; directory: string } {
  const normalized = path.replaceAll('\\', '/')
  const separator = normalized.lastIndexOf('/')
  if (separator < 0) return { basename: normalized, directory: '当前目录' }
  return {
    basename: normalized.slice(separator + 1) || normalized,
    directory: normalized.slice(0, separator) || '/'
  }
}

export function agentRunFilePathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

type InlineDiffLine = {
  kind: 'context' | 'addition' | 'deletion' | 'hunk' | 'metadata'
  text: string
  oldLine: number | null
  newLine: number | null
}

export function inlineDiffLines(diff: string): InlineDiffLine[] {
  const result: InlineDiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let insideHunk = false
  for (const rawLine of diff.split('\n')) {
    if (rawLine.startsWith('diff --git ')) {
      insideHunk = false
      continue
    }
    if (rawLine.startsWith('index ')
      || rawLine.startsWith('--- ')
      || rawLine.startsWith('+++ ')) continue
    if (rawLine.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine)
      if (match) {
        oldLine = Number(match[1])
        newLine = Number(match[2])
      }
      insideHunk = true
      result.push({ kind: 'hunk', text: rawLine, oldLine: null, newLine: null })
      continue
    }
    if (!insideHunk || rawLine === '\\ No newline at end of file') {
      if (rawLine !== '') {
        result.push({ kind: 'metadata', text: rawLine, oldLine: null, newLine: null })
      }
      continue
    }
    if (rawLine.startsWith('+')) {
      result.push({ kind: 'addition', text: rawLine.slice(1), oldLine: null, newLine })
      newLine += 1
      continue
    }
    if (rawLine.startsWith('-')) {
      result.push({ kind: 'deletion', text: rawLine.slice(1), oldLine, newLine: null })
      oldLine += 1
      continue
    }
    if (rawLine === '' && result.length > 0) continue
    const text = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine
    result.push({ kind: 'context', text, oldLine, newLine })
    oldLine += 1
    newLine += 1
  }
  return result
}

export function exactMutationDiffLines(diff: string): InlineDiffLine[] {
  return diff.split('\n').flatMap((rawLine): InlineDiffLine[] => {
    if (rawLine === '') return []
    if (rawLine.startsWith('+')) {
      return [{ kind: 'addition', text: rawLine.slice(1), oldLine: null, newLine: null }]
    }
    if (rawLine.startsWith('-')) {
      return [{ kind: 'deletion', text: rawLine.slice(1), oldLine: null, newLine: null }]
    }
    return []
  })
}
