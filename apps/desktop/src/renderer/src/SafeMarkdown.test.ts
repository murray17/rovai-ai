import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown } from './SafeMarkdown'

describe('SafeMarkdown file preview references', () => {
  it('enables only explicit inline-code and high-confidence bare file references in file contexts', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: '打开 `README.md` 或 ./src/app.ts:42。也可以点击 [`实现`](src/app.ts:4)。`Promise.all` 和 `sum()` 保持代码。\n\n```text\n./secret.txt\n```'
    }))
    expect(markup).not.toContain('title="README.md"')
    expect(markup).toContain('title="./src/app.ts:42"')
    expect(markup).not.toContain('title="./secret.txt"')
    expect(markup).toContain('<code>README.md</code>')
    expect(markup).toContain('<span class="inline-code-file-reference-label">实现</span>')
    expect(markup).not.toContain('<code>实现</code>')
    expect(markup).toContain('<code>Promise.all</code>')
    expect(markup).toContain('<code>sum()</code>')
  })

  it('repairs an autolink and an identical Markdown label without swallowing Chinese prose', () => {
    const source = 'https://example.com/wiki/requirements）。文档中的改动：'
    for (const children of [source, `[${source}](${source})`]) {
      const markup = renderToStaticMarkup(createElement(SafeMarkdown, { children, onFileReference: () => undefined }))
      expect(markup).toContain('href="https://example.com/wiki/requirements"')
      expect(markup).toContain('>https://example.com/wiki/requirements</a>）。文档中的改动：')
      expect(markup).not.toContain('markdown-file-reference')
    }
  })

  it('keeps local images disabled by default and admits only URLs projected by the preview', () => {
    const markdown = '![local](./images/diagram.png) ![remote](https://example.com/a.png)'
    const ordinary = renderToStaticMarkup(createElement(SafeMarkdown, { children: markdown }))
    const preview = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: markdown,
      onFileReference: () => undefined,
      localImageUrl: (reference: string) => reference.startsWith('./')
        ? `rovai-preview://asset/token/${reference.slice(2)}`
        : null
    }))
    expect(ordinary).not.toContain('<img')
    expect(preview).toContain('src="rovai-preview://asset/token/images/diagram.png"')
    expect(preview).not.toContain('https://example.com/a.png')
  })

  it('marks rendered headings for local anchor navigation and keeps same-document links interactive', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: '# Quick start\n\n[Jump](#quick-start)'
    }))
    expect(markup).toContain('data-markdown-heading="Quick start"')
    expect(markup).toContain('href="#quick-start"')
    expect(markup).not.toContain('markdown-inert-link')
  })

  it('keeps malformed or executable file-link fragments inert', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: '[broken](#rovai-file-reference=%ZZ) [unsafe](#rovai-file-reference=javascript%3Aalert%281%29)'
    }))
    expect(markup.match(/markdown-inert-link/g)).toHaveLength(2)
    expect(markup).not.toContain('class="markdown-file-reference"')
  })
})
