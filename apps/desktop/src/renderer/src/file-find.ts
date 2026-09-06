export interface FileFindOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regexp: boolean
  allChanges: boolean
  changesOnly: boolean
}
export interface FileFindDocument { id: string; text: string }
export interface FileFindMatch { documentId: string; from: number; to: number }
export interface FileFindResult { matches: FileFindMatch[]; limited: boolean; error?: string }
export const FILE_FIND_LIMIT = 10_000
export const EMPTY_FILE_FIND: FileFindOptions = {
  query: '', caseSensitive: false, wholeWord: false, regexp: false, allChanges: false, changesOnly: false
}

// Runs in a disposable worker: even a pathological regular expression cannot block the reader.
export function matchFileDocuments(documents: FileFindDocument[], options: FileFindOptions): FileFindResult {
  const matches: FileFindMatch[] = []
  if (!options.query) return { matches, limited: false }
  if (options.query.length > 512) return { matches, limited: false, error: '查找内容最多 512 个字符。' }
  let pattern: RegExp
  try {
    pattern = new RegExp(options.regexp ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), options.caseSensitive ? 'gu' : 'giu')
  } catch {
    return { matches, limited: false, error: '正则表达式无效，请检查括号或转义符。' }
  }
  const word = /[\p{L}\p{N}\p{M}_]/u
  for (const document of documents) {
    pattern.lastIndex = 0
    for (const match of document.text.matchAll(pattern)) {
      if (!match[0].length) continue
      const from = match.index
      const to = from + match[0].length
      if (options.wholeWord) {
        const before = document.text.slice(Math.max(0, from - 2), from)
        const after = document.text.slice(to, to + 2)
        if (word.test(Array.from(before).at(-1) ?? '') || word.test(Array.from(after)[0] ?? '')) continue
      }
      if (matches.length === FILE_FIND_LIMIT) return { matches, limited: true }
      matches.push({ documentId: document.id, from, to })
    }
  }
  return { matches, limited: false }
}
