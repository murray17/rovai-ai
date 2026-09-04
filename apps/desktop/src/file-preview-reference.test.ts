import { describe, expect, it } from 'vitest'
import { parseFileReference } from './file-preview-reference'

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
    expect(parseFileReference('artifact.custom:20')).toMatchObject({
      pathPart: 'artifact.custom', target: { line: 20 }
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
    expect(parseFileReference('javascript:20')).toBeNull()
    expect(parseFileReference('data:text/plain,hello')).toBeNull()
    expect(parseFileReference('https://example.com/a.ts:44-46')).toBeNull()
    expect(parseFileReference('javascript:a.ts:44')).toBeNull()
  })
})
