import { describe, expect, it } from 'vitest'
import { resourceReferenceVisualKind, type ResourceReferenceVisualKind } from './file-reference-presentation'

describe('resource-reference visual classification', () => {
  it.each<[string, ResourceReferenceVisualKind]>([
    ['https://example.com/docs/app.ts', 'web'],
    ['docs/README.md#L20-L24', 'markdown'],
    ['prototype/index.HTML?theme=night', 'html'],
    ['src/App.tsx:20:4', 'code'],
    ['~/.config/rovai/config.toml', 'config'],
    ['logs/runtime.log', 'text'],
    ['assets/camp.webp', 'image'],
    ['build/icon.svg', 'svg'],
    ['changes/review.diff', 'patch'],
    ['docs/prototypes/demo/', 'folder'],
    ['docs/spec.pdf', 'pdf'],
    ['handoff.docx', 'document'],
    ['results.xlsx', 'spreadsheet'],
    ['review.pptx', 'presentation'],
    ['analysis.ipynb', 'notebook'],
    ['artifacts/source.tar.gz', 'archive'],
    ['recordings/note.m4a', 'audio'],
    ['recordings/demo.mp4', 'video'],
    ['state/rovai.sqlite3', 'database'],
    ['release/Rovai.dmg', 'executable'],
    ['artifacts/unknown.bin', 'file']
  ])('classifies %s as %s', (target, expected) => {
    expect(resourceReferenceVisualKind(target)).toBe(expected)
  })

  it('removes line ranges, fragments, and queries before classifying', () => {
    expect(resourceReferenceVisualKind('src/main.rs:44-46')).toBe('code')
    expect(resourceReferenceVisualKind('docs/guide.mdx#L2-L8')).toBe('markdown')
    expect(resourceReferenceVisualKind('assets/icon.svg?raw=1#preview')).toBe('svg')
    expect(resourceReferenceVisualKind('C:\\work\\settings.json:10:2')).toBe('config')
  })
})
