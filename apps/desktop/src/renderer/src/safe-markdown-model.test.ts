import { describe, expect, it } from 'vitest'
import { safeMarkdownHasRenderableContent } from './safe-markdown-model'

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
