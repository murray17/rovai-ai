import { describe, expect, it } from 'vitest'
import {
  projectInlineFileReferenceCandidates,
  projectMessageInlineCodes,
  projectMessageFileReferences,
  safeMarkdownHasRenderableContent
} from './safe-markdown-model'

describe('safe Markdown presentation admission', () => {
  it.each([
    ['whitespace', '\n\n', false],
    ['an HTML-only Runtime control fragment', '</think>\n\n', false],
    ['an HTML block hidden by the safe Renderer', '<div>\nprivate\n</div>', false],
    ['an image removed by the safe Renderer', '![remote](https://example.com/image.png)', false],
    ['plain narration', '正在分析。\n\n', true],
    ['visible text between inline HTML tags', '<think>仍然可见</think>', true],
    ['a literal control fragment in code', '`</think>`', true],
    ['a visible Markdown divider', '---', true],
    ['a visible task control', '- [ ]', true]
  ])('classifies %s', (_label, source, expected) => {
    expect(safeMarkdownHasRenderableContent(source)).toBe(expected)
  })
})

describe('message file-reference projection', () => {
  it('preserves unresolved references and ordinary expressions as inline code', () => {
    expect(projectMessageInlineCodes('`missing.toml` 与 `Promise.all`')).toMatchObject([
      { value: 'missing.toml' },
      { value: 'Promise.all' }
    ])
  })

  it('projects known whole-inline-code candidates without scanning prose or fenced code', () => {
    const source = '`config.toml` `demo.mp4` missing.toml\n\n```md\n`secret.toml`\n```\n\n`Promise.all`'
    expect(projectInlineFileReferenceCandidates(source)).toEqual(['config.toml', 'demo.mp4'])
  })

  it('keeps unresolved inline-code inert while preserving explicit Markdown links', () => {
    const source = '[配置](config.toml) `config.toml` `missing.toml`'
    const references = projectMessageFileReferences(source, new Set(['config.toml']))
    expect(references.map(({ rawReference, inlineCode }) => ({ rawReference, inlineCode }))).toEqual([
      { rawReference: 'config.toml', inlineCode: false },
      { rawReference: 'config.toml', inlineCode: true }
    ])
  })

  it('uses source offsets, including Unicode and Markdown escapes before the link', () => {
    const source = '📝 **原文** &amp; \\* [计划](docs/plan.md)；代码 `src/app.ts:20`。'
    const references = projectMessageFileReferences(source)
    expect(references.map((reference) => source.slice(reference.start, reference.end))).toEqual([
      '[计划](docs/plan.md)', '`src/app.ts:20`'
    ])
    expect(references.map(({ rawReference, label, inlineCode }) => ({ rawReference, label, inlineCode }))).toEqual([
      { rawReference: 'docs/plan.md', label: '计划', inlineCode: false },
      { rawReference: 'src/app.ts:20', label: 'src/app.ts:20', inlineCode: true }
    ])
  })

  it('preserves URL, image, HTML and fenced/indented code boundaries', () => {
    const source = [
      '![图片](src/image.png)',
      '[网站](https://example.com/src/app.ts)',
      '<https://example.com/src/app.ts>',
      '',
      '<div data-path="src/private.ts">src/hidden.ts</div>',
      '',
      '    src/indented.ts',
      '',
      '```ts',
      'src/fenced.ts',
      '```',
      '',
      '外部 src/visible.ts:20'
    ].join('\n')
    expect(projectMessageFileReferences(source)).toEqual([])
  })

  it('does not scan ordinary message text for path-shaped prose', () => {
    expect(projectMessageFileReferences('src/App.tsx:20 /compact docs/prototypes/demo/')).toEqual([])
  })

  it('does not interpret ordinary prose, unsafe URLs, inline code or incomplete code fences as files', () => {
    expect(projectMessageFileReferences('v1.30 test@example.com `value + 1` [危险](javascript:alert)')).toEqual([])
    expect(projectMessageFileReferences('```md\n[路径](src/hidden.ts)')).toEqual([])
  })

  it('bounds parsing and uses the path when a Markdown link has no description', () => {
    expect(projectMessageFileReferences('[](src/app.ts)')[0]).toMatchObject({ label: 'src/app.ts', rawReference: 'src/app.ts' })
    expect(projectMessageFileReferences('x'.repeat(1_048_577))).toEqual([])
  })
})
