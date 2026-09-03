import { describe, expect, it } from 'vitest'
import {
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
  it('keeps every inline-code value as code, including path-shaped values', () => {
    expect(projectMessageInlineCodes('`config.toml` `src/App.tsx:20` `Promise.all`')).toMatchObject([
      { value: 'config.toml' },
      { value: 'src/App.tsx:20' },
      { value: 'Promise.all' }
    ])
    expect(projectMessageFileReferences('`config.toml` `src/App.tsx:20` `Promise.all`')).toEqual([])
  })

  it('projects only explicit local Markdown links', () => {
    const source = '[配置](config.toml) `config.toml` [代码](src/App.tsx:20) src/bare.ts'
    expect(projectMessageFileReferences(source).map(({ rawReference, label }) => ({ rawReference, label }))).toEqual([
      { rawReference: 'config.toml', label: '配置' },
      { rawReference: 'src/App.tsx:20', label: '代码' }
    ])
  })

  it('uses source offsets, including Unicode and Markdown escapes before a link', () => {
    const source = '📝 **原文** &amp; \\* [计划](docs/plan.md)；代码 `src/app.ts:20`。'
    const references = projectMessageFileReferences(source)
    expect(references.map((reference) => source.slice(reference.start, reference.end))).toEqual([
      '[计划](docs/plan.md)'
    ])
    expect(references.map(({ rawReference, label }) => ({ rawReference, label }))).toEqual([
      { rawReference: 'docs/plan.md', label: '计划' }
    ])
  })

  it('preserves URL, image, HTML, inline-code and fenced-code boundaries', () => {
    const source = [
      '![图片](src/image.png)',
      '[网站](https://example.com/src/app.ts)',
      '<https://example.com/src/app.ts>',
      '`src/inline.ts`',
      '',
      '<div data-path="src/private.ts">[隐藏](src/hidden.ts)</div>',
      '',
      '    [缩进](src/indented.ts)',
      '',
      '```md',
      '[围栏](src/fenced.ts)',
      '```',
      '',
      '外部 src/visible.ts:20'
    ].join('\n')
    expect(projectMessageFileReferences(source)).toEqual([])
  })

  it('does not interpret prose, unsafe URLs or incomplete code fences as files', () => {
    expect(projectMessageFileReferences('src/App.tsx:20 /compact docs/prototypes/demo/')).toEqual([])
    expect(projectMessageFileReferences('v1.30 test@example.com `value + 1` [危险](javascript:alert)')).toEqual([])
    expect(projectMessageFileReferences('```md\n[路径](src/hidden.ts)')).toEqual([])
  })

  it('bounds parsing and uses the path when a Markdown link has no description', () => {
    expect(projectMessageFileReferences('[](src/app.ts)')[0]).toMatchObject({ label: 'src/app.ts', rawReference: 'src/app.ts' })
    expect(projectMessageFileReferences('x'.repeat(1_048_577))).toEqual([])
  })
})
