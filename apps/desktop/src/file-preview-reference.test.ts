import { describe, expect, it } from 'vitest'
import {
  inlineFileReferenceSource,
  isInlineFileReference,
  parseFileReference,
  tokenizeFileReferences
} from './file-preview-reference'

describe('parseFileReference', () => {
  it('parses Unix, Windows, UNC, relative and file URI locations', () => {
    expect(parseFileReference('/Users/murray/project/app.ts:42:7')).toMatchObject({
      pathPart: '/Users/murray/project/app.ts',
      pathKind: 'unix_absolute',
      target: { line: 42, column: 7 }
    })
    expect(parseFileReference('C:\\project\\app.ts:20:8')).toMatchObject({
      pathPart: 'C:\\project\\app.ts',
      pathKind: 'windows_absolute',
      target: { line: 20, column: 8 }
    })
    expect(parseFileReference('\\\\server\\share\\README.md#L2-L8')).toMatchObject({
      pathKind: 'unc',
      target: { line: 2, endLine: 8 }
    })
    expect(parseFileReference('./docs/guide.md#快速开始')).toMatchObject({
      pathPart: './docs/guide.md',
      pathKind: 'relative',
      target: { heading: '快速开始' }
    })
    expect(parseFileReference('./docs/guide.md#quick%20start')).toMatchObject({
      fragment: 'quick start',
      target: { heading: 'quick start', htmlFragment: 'quick start' }
    })
    expect(parseFileReference('file:///Users/murray/project/a%20b.md#L3')).toMatchObject({
      pathPart: '/Users/murray/project/a b.md',
      pathKind: 'file_uri',
      target: { line: 3 }
    })
    expect(parseFileReference('run_report.py:44-46')).toMatchObject({
      pathPart: 'run_report.py', target: { line: 44, endLine: 46 }
    })
    expect(parseFileReference('app.ts:44-46')).toMatchObject({
      pathPart: 'app.ts', target: { line: 44, endLine: 46 }
    })
    expect(parseFileReference('C:\\project\\app.ts:44-46')).toMatchObject({
      pathPart: 'C:\\project\\app.ts', target: { line: 44, endLine: 46 }
    })
    expect(parseFileReference('./app.ts:46-44')).toBeNull()
    expect(parseFileReference('./app.ts:9007199254740992')).toBeNull()
  })

  it('rejects network and executable URL schemes', () => {
    expect(parseFileReference('https://example.com/a.ts')).toBeNull()
    expect(parseFileReference('javascript:alert(1)')).toBeNull()
    expect(parseFileReference('data:text/plain,hello')).toBeNull()
    expect(parseFileReference('https://example.com/a.ts:44-46')).toBeNull()
    expect(parseFileReference('javascript:a.ts:44')).toBeNull()
  })
})

describe('isInlineFileReference', () => {
  it('admits known basename types for existence resolution while rejecting ordinary inline code', () => {
    expect(isInlineFileReference('方案 B')).toBe(false)
    expect(isInlineFileReference('notes.txt')).toBe(true)
    expect(isInlineFileReference('run_gr_reminder.py')).toBe(true)
    expect(isInlineFileReference('demo.mp4')).toBe(true)
    expect(isInlineFileReference('notebook.ipynb')).toBe(true)
    expect(isInlineFileReference('data.sqlite')).toBe(true)
    expect(isInlineFileReference('Promise.all')).toBe(false)
    expect(isInlineFileReference('sum()')).toBe(false)
    expect(isInlineFileReference('./Makefile')).toBe(true)
    expect(isInlineFileReference('src/app.ts:42')).toBe(true)
  })

  it('resolves located short names only against a unique explicit source in this message', () => {
    const path = 'src/report/scripts/run_report.py'
    expect(inlineFileReferenceSource('run_report.py:44-46', [path])).toBe(path)
    expect(inlineFileReferenceSource('run_report.py:44-46', [])).toBeNull()
    expect(inlineFileReferenceSource('run_report.py:44-46', [path, 'other/run_report.py'])).toBeNull()
    expect(inlineFileReferenceSource('run_report.py', [path])).toBeNull()
    expect(inlineFileReferenceSource('run_report.py:44-46', ['https://example.com/run_report.py'])).toBeNull()
  })
})

describe('tokenizeFileReferences', () => {
  it('finds high-confidence paths without swallowing punctuation', () => {
    const tokens = tokenizeFileReferences('请看 ./src/app.ts:42，以及 C:\\project\\README.md#L2。')
    expect(tokens.map((token) => token.raw)).toEqual([
      './src/app.ts:42',
      'C:\\project\\README.md#L2'
    ])
  })

  it('does not turn ordinary prose, versions, emails or web URLs into file references', () => {
    expect(tokenizeFileReferences('v1.30 test@example.com https://example.com/a.ts hello/world')).toEqual([])
  })

  it('does not start Unix paths inside Chinese field lists or words', () => {
    expect(tokenizeFileReferences('WBS(外码)/WBS描述/成本中心/FBP/GR-手工金额')).toEqual([])
    expect(tokenizeFileReferences('心/FBP）有值')).toEqual([])
    expect(tokenizeFileReferences('path/src/app.tsx')).toHaveLength(1)
    expect(tokenizeFileReferences('字段/FBP、PR/PO、hello/world')).toEqual([])
    expect(tokenizeFileReferences('目录：/Users/example/project。')).toMatchObject([
      { raw: '/Users/example/project' }
    ])
  })
})
