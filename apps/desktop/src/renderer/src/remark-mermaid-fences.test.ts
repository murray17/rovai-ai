import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { remarkMermaidFences, type MermaidBlocks } from './remark-mermaid-fences'
import { MessageMarkdown } from './MessageMarkdown'
import { SafeMarkdown } from './SafeMarkdown'

function blocks(source: string): MermaidBlocks {
  const result: MermaidBlocks = new Map()
  const parser = unified().use(remarkParse).use(remarkMermaidFences, { blocks: result })
  parser.runSync(parser.parse(source), { value: source })
  return result
}

describe('streaming Mermaid admission in the existing Markdown parse', () => {
  it.each([
    ['```mermaid\ngraph TD\nA-->B\n', false],
    ['```mermaid\ngraph TD\n```', false],
    ['```mermaid\ngraph TD\n```  ', false],
    ['```mermaid\ngraph TD\n```\n', true],
    ['~~~mermaid\ngraph TD\n~~~~\r\n', true],
    ['```mermaid\ngraph TD\n```\r', true],
    ['````mermaid\ngraph TD\n```\n', false],
    ['```mermaid\ngraph TD\n~~~\n', false],
    ['```mermaid\ngraph TD\n```suffix\n', false],
    ['```mermaid\ngraph TD\n    ```\n', false],
    ['- ```mermaid\n  graph TD\n  ```\n', true],
    ['> ```mermaid\n> graph TD\n> ```\n', true],
    ['> 1. ~~~~mermaid\n>    graph TD\n>    ~~~~~\n', true],
    ['> ```mermaid\n> graph TD\n\noutside\n```\n', false],
    ['- ```mermaid\n  graph TD\n  ```', false]
  ])('recognizes only a complete explicit closing line: %j', (source, closed) => {
    expect([...blocks(source).values()][0]?.fenceClosed).toBe(closed)
  })

  it('associates multiple blocks with their own offsets and ignores HTML/other languages', () => {
    const source = '```js\nx\n```\n\n<pre><code class="language-mermaid">fake</code></pre>\n\n```mermaid\ngraph TD\n```\n\n~~~mermaid\nsequenceDiagram'
    expect([...blocks(source).values()]).toEqual([
      { source: 'graph TD', fenceClosed: true }, { source: 'sequenceDiagram', fenceClosed: false }
    ])
  })

  it('keeps trusted fence metadata associated after raw HTML and sanitizing', () => {
    const source = '<div onclick="attack()">before</div>\n\n> ```mermaid\n> graph TD\n> ```\n\n~~~mermaid\nsequenceDiagram'
    const html = renderToStaticMarkup(createElement(MessageMarkdown, { children: source, theme: 'day', contentComplete: false }))
    expect(html.match(/data-mermaid-state="loading"/g)).toHaveLength(1)
    expect(html.match(/data-mermaid-state="pending"/g)).toHaveLength(1)
    expect(html).not.toContain('onclick')
  })

  it('only complete bodies may use implicit EOF closing; the base stays code-only', () => {
    const source = '```mermaid\ngraph TD\n A-->B'
    const streaming = renderToStaticMarkup(createElement(MessageMarkdown, { children: source, theme: 'night', contentComplete: false }))
    expect(streaming).toContain('data-mermaid-state="pending"')
    expect(streaming).not.toContain('正在绘制图表')
    expect(renderToStaticMarkup(createElement(MessageMarkdown, { children: source, theme: 'night' }))).toContain('data-mermaid-state="loading"')
    expect(renderToStaticMarkup(createElement(SafeMarkdown, { children: source }))).not.toContain('markdown-mermaid')
  })

  it('preserves structured Mention children even inside a Mermaid-labelled block', () => {
    const html = renderToStaticMarkup(createElement(MessageMarkdown, { children: '```mermaid\ngraph TD\nTOKEN\n```\n', theme: 'day', inlineContent: { TOKEN: createElement('button', null, '用户') } }))
    expect(html).toContain('<button>用户</button>')
    expect(html).not.toContain('markdown-mermaid')
    expect(html).not.toContain('TOKEN')
  })
})
