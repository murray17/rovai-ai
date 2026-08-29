import { describe, expect, it } from 'vitest'
import {
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
  })

  it('rejects network and executable URL schemes', () => {
    expect(parseFileReference('https://example.com/a.ts')).toBeNull()
    expect(parseFileReference('javascript:alert(1)')).toBeNull()
    expect(parseFileReference('data:text/plain,hello')).toBeNull()
  })
})

describe('isInlineFileReference', () => {
  it('keeps ordinary inline code inert while accepting intentional file references', () => {
    expect(isInlineFileReference('方案 B')).toBe(false)
    expect(isInlineFileReference('notes.txt')).toBe(true)
    expect(isInlineFileReference('./Makefile')).toBe(true)
    expect(isInlineFileReference('src/app.ts:42')).toBe(true)
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
})
