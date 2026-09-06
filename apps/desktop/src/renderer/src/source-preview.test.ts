import { describe, expect, it } from 'vitest'
import {
  highlightSourceCode,
  loadSourceLanguageForName,
  sourceCodeMirrorTheme,
  sourceLanguageForFilename,
  sourceLanguageForName,
  sourceLineNumber,
  sourceTargetLocalLines
} from './source-preview'

describe('source preview languages', () => {
  it('matches filenames and fenced language names through CodeMirror language-data', () => {
    expect(sourceLanguageForFilename('Component.tsx')?.name).toBe('TSX')
    expect(sourceLanguageForFilename('main.rs')?.name).toBe('Rust')
    expect(sourceLanguageForFilename('script.py')?.name).toBe('Python')
    expect(sourceLanguageForFilename('notes.unknownrovai')).toBeNull()
    expect(sourceLanguageForName('tsx')?.name).toBe('TSX')
    expect(sourceLanguageForName('madeup')).toBeNull()
  })

  it('produces static syntax spans without changing the source text', async () => {
    const language = await loadSourceLanguageForName('tsx')
    expect(language).not.toBeNull()
    if (!language) return

    const code = 'const App = () => <main>{value}</main>\n'
    const highlighted = highlightSourceCode(code, language, 'night')

    expect(highlighted.map((segment) => segment.text).join('')).toBe(code)
    expect(highlighted.some((segment) => Boolean(segment.className))).toBe(true)
  })
})

describe('source preview real line coordinates', () => {
  it('keeps paged line numbers and clips a target range to loaded content', () => {
    expect(sourceLineNumber(95, 1)).toBe('95')
    expect(sourceLineNumber(95, 8)).toBe('102')
    expect(sourceTargetLocalLines(95, 8, { line: 100, endLine: 104 })).toEqual({ from: 6, to: 8 })
    expect(sourceTargetLocalLines(95, 8, { line: 20, endLine: 30 })).toBeNull()
  })

  it('maps the resolved Rovai theme directly to the CodeMirror base theme', () => {
    expect(sourceCodeMirrorTheme('day')).toBe('light')
    expect(sourceCodeMirrorTheme('night')).toBe('dark')
  })
})
