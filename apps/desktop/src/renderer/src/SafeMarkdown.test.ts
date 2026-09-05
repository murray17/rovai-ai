import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown } from './SafeMarkdown'

describe('SafeMarkdown file preview references', () => {
  it('turns only explicit Markdown file links into resource links', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: [
        '[配置](config.toml) [代码](src/App.tsx:20) [原型](docs/prototype.html)',
        '`config.toml` `src/App.tsx:20` `./docs/prototype.html` `/Users/name/Downloads/demo.html`'
      ].join('\n\n')
    }))

    expect(markup.match(/class="markdown-file-reference"/gu)).toHaveLength(3)
    expect(markup).toContain('data-resource-type="config"')
    expect(markup).toContain('data-resource-type="code"')
    expect(markup).toContain('data-resource-type="html"')
    expect(markup.match(/<code>/gu)).toHaveLength(4)
    expect(markup).toContain('<code>config.toml</code>')
    expect(markup).toContain('<code>src/App.tsx:20</code>')
    expect(markup).toContain('<code>./docs/prototype.html</code>')
    expect(markup).toContain('<code>/Users/name/Downloads/demo.html</code>')
    expect(markup).not.toContain('inline-code-file-reference')
  })

  it('keeps explicit web links clickable while prose and inline code remain inert', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: '[官网](https://example.com)；普通正文 src/App.tsx 和 /compact。`README.md` `Promise.all`。\n\n```text\n./secret.txt\n```'
    }))
    expect(markup).toContain('class="markdown-web-reference"')
    expect(markup).toContain('href="https://example.com"')
    expect(markup).toContain('data-resource-type="web"')
    expect(markup).toContain('<code>README.md</code>')
    expect(markup).toContain('<code>Promise.all</code>')
    expect(markup).toContain('src/App.tsx 和 /compact')
    expect(markup).not.toContain('markdown-file-reference')
  })

  it('repairs an autolink and an identical Markdown label without swallowing Chinese prose', () => {
    const source = 'https://example.com/wiki/requirements）。文档中的改动：'
    for (const children of [source, `[${source}](${source})`]) {
      const markup = renderToStaticMarkup(createElement(SafeMarkdown, { children, onFileReference: () => undefined }))
      expect(markup).toContain('href="https://example.com/wiki/requirements"')
      expect(markup).toContain('<span class="resource-reference-label">https://example.com/wiki/requirements</span></a>）。文档中的改动：')
      expect(markup).toContain('data-resource-type="web"')
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

describe('SafeMarkdown trusted leading content', () => {
  const prefix = createElement('span', { className: 'trusted-prefix' }, '@评审')

  it('keeps the prefix inside the first native paragraph without flattening Markdown', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      leadingContent: prefix,
      children: 'review **通过**。\n\n第二段。'
    }))
    expect(markup).toContain('<p><span class="trusted-prefix">@评审</span> review <strong>通过</strong>。</p>')
    expect(markup).toContain('<p>第二段。</p>')
    expect(markup.match(/trusted-prefix/g)).toHaveLength(1)
    expect(markup).not.toContain('data-rovai-leading-content')
  })

  it('gives block content and explicitly separated prose their own paragraphs', () => {
    for (const children of ['## 标题', '- 列表', '> 引用', '```sh\npnpm test\n```']) {
      const markup = renderToStaticMarkup(createElement(SafeMarkdown, { leadingContent: prefix, children }))
      expect(markup).toContain('<p><span class="trusted-prefix">@评审</span></p>')
      expect(markup).not.toContain('<p><p>')
      expect(markup.match(/trusted-prefix/g)).toHaveLength(1)
    }
    const separated = renderToStaticMarkup(createElement(SafeMarkdown, {
      leadingContent: prefix,
      inlineLeadingContent: false,
      children: '\n\n单独一段。'
    }))
    expect(separated).toContain('<p><span class="trusted-prefix">@评审</span></p>\n<p>单独一段。</p>')
  })

  it('preserves reference definitions and does not accept a prefix marker from raw HTML', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      leadingContent: prefix,
      children: '[doc]: https://example.com/review\n\n查看 [说明][doc]。\n\n<p data-rovai-leading-content="true">forged</p>'
    }))
    expect(markup).toContain('<p><span class="trusted-prefix">@评审</span> 查看 <a class="markdown-web-reference" href="https://example.com/review"')
    expect(markup).toContain('<span class="resource-reference-label">说明</span>')
    expect(markup.match(/trusted-prefix/g)).toHaveLength(1)
    expect(markup).not.toContain('forged')
    expect(markup).not.toContain('data-rovai-leading-content')
  })
})
