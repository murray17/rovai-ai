import { describe, expect, it } from 'vitest'
import { parseUnifiedPatch } from './file-preview-patch'

describe('parseUnifiedPatch', () => {
  it('groups a unified patch by file and hunk with reliable old and new line numbers', () => {
    const patch = parseUnifiedPatch([
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,2 +2,3 @@ export function value()',
      ' keep',
      '-old',
      '+new',
      '+more',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -10 +10 @@',
      '-before',
      '+after'
    ].join('\n'))

    expect(patch?.files.map((file) => file.displayPath)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(patch?.files[0].hunks[0].label).toBe('export function value()')
    expect(patch?.files[0].hunks[0].lines).toMatchObject([
      { kind: 'context', oldLine: 2, newLine: 2 },
      { kind: 'deletion', oldLine: 3, newLine: null },
      { kind: 'addition', oldLine: null, newLine: 3 },
      { kind: 'addition', oldLine: null, newLine: 4 }
    ])
  })

  it('returns null for non-unified content so the viewer can use text fallback', () => {
    expect(parseUnifiedPatch('This is not a patch.')).toBeNull()
  })
})
