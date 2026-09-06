import { describe, expect, it } from 'vitest'
import { EMPTY_FILE_FIND, FILE_FIND_LIMIT, matchFileDocuments } from './file-find'

describe('file-local matching', () => {
  it('keeps UTF-16 offsets stable across case folding and astral characters', () => {
    const result = matchFileDocuments([{ id: 'one', text: '😀Preview preview 预览' }], { ...EMPTY_FILE_FIND, query: 'preview' })
    expect(result.matches).toEqual([{ documentId: 'one', from: 2, to: 9 }, { documentId: 'one', from: 10, to: 17 }])
    expect(matchFileDocuments([{ id: 'one', text: 'Preview preview' }], { ...EMPTY_FILE_FIND, query: 'Preview', caseSensitive: true }).matches).toHaveLength(1)
  })
  it('treats regex punctuation literally by default and rejects malformed regex', () => {
    expect(matchFileDocuments([{ id: 'code', text: 'a.b a-b' }], { ...EMPTY_FILE_FIND, query: 'a.b' }).matches).toHaveLength(1)
    expect(matchFileDocuments([{ id: 'code', text: 'a.b a-b' }], { ...EMPTY_FILE_FIND, query: 'a.b', regexp: true }).matches).toHaveLength(2)
    expect(matchFileDocuments([], { ...EMPTY_FILE_FIND, query: '(', regexp: true }).error).toBeTruthy()
  })
  it('does not cross file boundaries or treat a substring inside a Unicode word as a whole word', () => {
    const documents = [{ id: 'a', text: 'preview 预览器 预览' }, { id: 'b', text: ' preview' }]
    expect(matchFileDocuments(documents, { ...EMPTY_FILE_FIND, query: '预览', wholeWord: true }).matches).toEqual([{ documentId: 'a', from: 12, to: 14 }])
    expect(matchFileDocuments([{ id: 'a', text: 'pre' }, { id: 'b', text: 'view' }], { ...EMPTY_FILE_FIND, query: 'preview' }).matches).toEqual([])
  })
  it('ignores zero-width matches and reports a bounded result as incomplete', () => {
    expect(matchFileDocuments([{ id: 'a', text: 'abc' }], { ...EMPTY_FILE_FIND, query: '^', regexp: true }).matches).toEqual([])
    const limited = matchFileDocuments([{ id: 'a', text: 'x'.repeat(FILE_FIND_LIMIT + 1) }], { ...EMPTY_FILE_FIND, query: 'x' })
    expect(limited.matches).toHaveLength(FILE_FIND_LIMIT)
    expect(limited.limited).toBe(true)
  })
})
