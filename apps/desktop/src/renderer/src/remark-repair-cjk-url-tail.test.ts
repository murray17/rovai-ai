import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { remarkRepairCjkUrlTail } from './remark-repair-cjk-url-tail'

type Node = { type?: string; value?: string; url?: string; children?: Node[] }
const parser = unified().use(remarkParse).use(remarkGfm)
const repair = remarkRepairCjkUrlTail()
const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? ''

describe('CJK URL tail repair', () => {
  it.each([
    ['https://x.com/a，然后', 'https://x.com/a', '，然后'],
    ['https://x.com/a)。', 'https://x.com/a', ')。'],
    ['https://x.com/a)。（下一句）', 'https://x.com/a', ')。（下一句）'],
    ['https://x.com/Foo_(bar)。', 'https://x.com/Foo_(bar)', '。'],
    ['https://x.com/Foo_(bar))。', 'https://x.com/Foo_(bar)', ')。'],
    ['https://x.com/a?b=1&c=2）。', 'https://x.com/a?b=1&c=2', '）。'],
    ['https://x.com/a?q=hello!。正文', 'https://x.com/a?q=hello!', '。正文'],
    ['https://x.com/a?value=%EF%BC%89）。正文', 'https://x.com/a?value=%EF%BC%89', '）。正文'],
    ['https://x.com/a,.。正文', 'https://x.com/a', ',.。正文'],
    ['http://x.com/a【说明】', 'http://x.com/a', '【说明】']
  ])('splits %s without losing or duplicating text', (source, url, tail) => {
    const root: Node = { type: 'paragraph', children: [{ type: 'link', url: source, children: [{ type: 'text', value: source }] }] }
    repair(root)
    expect(root.children).toEqual([
      { type: 'link', url, children: [{ type: 'text', value: url }] },
      { type: 'text', value: tail }
    ])
    expect(text(root)).toBe(source)
  })

  it('handles GFM www labels without changing the parser-provided protocol', () => {
    const tree = parser.parse('www.example.com/a）。正文')
    repair(tree)
    expect(tree.children[0]).toMatchObject({ children: [
      { type: 'link', url: 'http://www.example.com/a', children: [{ value: 'www.example.com/a' }] },
      { type: 'text', value: '）。正文' }
    ] })
  })

  it.each([
    '[需求文档](https://x.com/a）。后续正文)',
    '[需求文档](https://x.com/a)',
    '<https://x.com/a>',
    'https://x.com/Foo_(bar)',
    '`https://x.com/a）。`',
    '```\nhttps://x.com/a）。\n```',
    '[README.md](README.md)',
    '[file:///tmp/a）。](file:///tmp/a）。)',
    '[file](#rovai-file-reference=a.ts)',
    'https://x.com/a?value=%EF%BC%89&b=1'
  ])('leaves an ordinary or deliberately labelled link untouched: %s', (source) => {
    const tree = parser.parse(source)
    const original = structuredClone(tree)
    repair(tree)
    expect(tree).toEqual(original)
  })

  it('preserves all visible characters at every incomplete streaming boundary', () => {
    const url = 'https://x.com/a?b=1&c=2）。中文正文：'
    for (const source of [url, `[${url}](${url})`, `已读取（${url}`]) {
      for (let end = 1; end <= source.length; end += 1) {
        const tree = parser.parse(source.slice(0, end))
        const originalText = text(tree)
        repair(tree)
        expect(text(tree)).toBe(originalText)
      }
    }
  })
})
