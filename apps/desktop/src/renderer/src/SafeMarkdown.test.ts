import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SafeMarkdown } from './SafeMarkdown'

describe('SafeMarkdown default HTML sanitization', () => {
  it('renders allowed HTML and keeps code and escaped tags literal', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: '| 项目 | 说明 |\n| --- | --- |\n| <b>粗体</b> | 一<br>二<br/>三 |\n\n`<br>` &lt;b&gt;字面&lt;/b&gt;\\<br>\n\n```html\n<br/><script>literal</script>\n```'
    }))
    expect(markup).toContain('<b>粗体</b>')
    expect(markup).toContain('<td>一<br/>二<br/>三</td>')
    expect(markup).toContain('<code>&lt;br&gt;</code>')
    expect(markup).toContain('&lt;b&gt;字面&lt;/b&gt;&lt;br&gt;')
    expect(markup).toContain('&lt;br/&gt;&lt;script&gt;literal&lt;/script&gt;')
    expect(markup).toContain('markdown-code-copy')
    expect(markup).toContain('markdown-table-scroll')
  })

  it('cleans untrusted HTML before inserting trusted content', () => {
    const token = 'TRUSTEDTOKEN'
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: '<div onclick="alert(1)">\n' + token + '\n<span data-rovai-inline-content="TRUSTEDTOKEN">plain</span>\n<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a>\n</div>',
      inlineContent: { [token]: createElement('button', { className: 'trusted-mention' }, '@用户') }
    }))
    expect(markup).toContain('<div>\n<button class="trusted-mention">@用户</button>')
    expect(markup.match(/trusted-mention/g)).toHaveLength(1)
    expect(markup).toContain('plain')
    expect(markup).not.toMatch(/TRUSTEDTOKEN|onclick|onerror|javascript:|<script|<img/u)
  })

  it('uses the same default rules in message and document readers', () => {
    for (const mode of ['message', 'document'] as const) {
      const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
        children: '<!-- lang:en -->\n\n<unknown>kept text</unknown>\n\n<UUID>\n\n<div>visible</div>\n\n`<UUID>`', mode
      }))
      expect(markup).not.toContain('lang:en')
      expect(markup).not.toContain('<unknown>')
      expect(markup).toContain('kept text')
      expect(markup).toContain('<div>visible</div>')
      expect(markup).toContain('<code>&lt;UUID&gt;</code>')
    }
  })
})

describe('SafeMarkdown file preview references', () => {
  it('keeps document headings at their native levels without changing the default message hierarchy', () => {
    const source = [
      '# 一级',
      '## 二级',
      '### 三级',
      '#### 四级',
      '##### 五级',
      '###### 六级'
    ].join('\n\n')
    const documentMarkup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: source,
      mode: 'document'
    }))
    const messageMarkup = renderToStaticMarkup(createElement(SafeMarkdown, { children: source }))

    expect(documentMarkup).toContain('class="safe-markdown is-document"')
    for (const [level, label] of ['一级', '二级', '三级', '四级', '五级', '六级'].entries()) {
      expect(documentMarkup).toContain(`<h${level + 1} data-markdown-heading="${label}">${label}</h${level + 1}>`)
    }
    expect(messageMarkup).toContain('<h3 data-markdown-heading="一级">一级</h3>')
    expect(messageMarkup).toContain('<h3 data-markdown-heading="二级">二级</h3>')
    expect(messageMarkup).not.toContain('class="safe-markdown is-document"')
  })

  it('renders fenced document code through the static source highlighter surface', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: '```tsx\nconst App = () => <main />\n```\n\n```\nplain text\n```',
      mode: 'document',
      theme: 'night'
    }))

    expect(markup.match(/class="markdown-code-block"/gu)).toHaveLength(2)
    expect(markup).toContain('<code data-code-language="tsx">const App = () =&gt; &lt;main /&gt;\n</code>')
    expect(markup).toContain('<code>plain text\n</code>')
    expect(markup).not.toContain('cm-editor')
  })

  it('gives document tables their own horizontal scroll surface', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      children: '| 项目 | 说明 |\n| --- | --- |\n| 预览 | 宽内容 |',
      mode: 'document'
    }))

    expect(markup).toContain('<div class="markdown-table-scroll"><table>')
    expect(markup).toContain('<th>项目</th>')
    expect(markup).toContain('<td>宽内容</td>')
  })

  it('turns only explicit Markdown file links into resource links', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: [
        '[配置](config.toml) [代码](src/App.tsx:20) [原型](docs/prototype.html)',
        '`config.toml` `src/App.tsx:20` `./docs/prototype.html` `/Users/name/Downloads/demo.html`',
        '<div>[原样文字](hidden.md)</div>'
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
    expect(markup).toContain('<div>[原样文字](hidden.md)</div>')
  })

  it.each([
    ['Chinese text on both sides', '前[文件](docs/plan.md)后', true, true],
    ['Latin text and a digit', 'A[文件](docs/plan.md)9', true, true],
    ['formatted sibling text', '**前**[文件](docs/plan.md)*后*', true, true],
    ['formatted text around the link', '**前[文件](docs/plan.md)后**', true, true],
    ['inline code on both sides', '`前`[文件](docs/plan.md)`后`', true, true],
    ['text only before the link', '前[文件](docs/plan.md)，', true, false],
    ['text only after the link', '（[文件](docs/plan.md)后', false, true],
    ['cleaned HTML before the link', '文</b>[文件](README.md)', true, false],
    ['rendered HTML after the link', '[文件](README.md)<b>文', false, true],
    ['existing whitespace', '前 [文件](docs/plan.md) 后', false, false],
    ['punctuation', '（[文件](docs/plan.md)）。', false, false],
    ['a soft line break', '前\n[文件](docs/plan.md)\n后', false, false],
    ['paragraph boundaries', '前\n\n[文件](docs/plan.md)\n\n后', false, false],
    ['emoji', '🙂[文件](docs/plan.md)🙂', false, false],
    ['HTML formatting', '<b>前</b>[文件](docs/plan.md)<i>后</i>', true, true],
    ['removed script', '<script>hidden</script>[文件](docs/plan.md)', false, false],
    ['HTML break', '前<br>[文件](docs/plan.md)<br/>后', false, false]
  ])('marks inline file-reference spacing for %s', (_label, source, marginInlineStart, marginInlineEnd) => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: source
    }))
    const className = /<a class="([^"]*markdown-file-reference[^"]*)"/u.exec(markup)?.[1] ?? ''
    expect(className.includes('has-adjacent-text-before')).toBe(marginInlineStart)
    expect(className.includes('has-adjacent-text-after')).toBe(marginInlineEnd)
    if (marginInlineStart && marginInlineEnd) {
      expect(markup.replace(/<[^>]*>/gu, '')).toBe(source.includes('A[') ? 'A文件9' : '前文件后')
    }
  })

  it.each([
    ['文</b>[文件](README.md)', true, false],
    ['[文件](README.md)<b>文', false, true]
  ])('uses visible HTML text when spacing %s', (source, marginInlineStart, marginInlineEnd) => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
            children: source
    }))
    const className = /<a class="([^"]*markdown-file-reference[^"]*)"/u.exec(markup)?.[1] ?? ''
    expect(className.includes('has-adjacent-text-before')).toBe(marginInlineStart)
    expect(className.includes('has-adjacent-text-after')).toBe(marginInlineEnd)
    expect(markup).not.toContain('&lt;')
  })

  it('keeps spacing markers scoped to message file references', () => {
    const webMarkup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: '前[官网](https://example.com)后'
    }))
    const documentMarkup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      mode: 'document',
      children: '前[文件](docs/plan.md)后'
    }))

    expect(webMarkup).toContain('class="markdown-web-reference"')
    expect(webMarkup).not.toContain('has-adjacent-text-')
    expect(documentMarkup).toContain('class="markdown-file-reference"')
    expect(documentMarkup).not.toContain('has-adjacent-text-')
  })

  it('does not add body-text margins between adjacent file references', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      onFileReference: () => undefined,
      children: '[前一份](docs/first.md)[后一份](docs/second.md)'
    }))

    expect(markup.match(/class="markdown-file-reference"/gu)).toHaveLength(2)
    expect(markup).not.toContain('has-adjacent-text-')
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

  it('trims bare URL prose but preserves an explicitly written target even with an identical label', () => {
    const source = 'https://example.com/wiki/requirements）。文档中的改动：'
    const bare = renderToStaticMarkup(createElement(SafeMarkdown, { children: source }))
    expect(bare).toContain('href="https://example.com/wiki/requirements"')
    expect(bare).toContain('<span class="resource-reference-label">https://example.com/wiki/requirements</span></a>）。文档中的改动：')
    const explicit = renderToStaticMarkup(createElement(SafeMarkdown, { children: `[${source}](${source})` }))
    expect(explicit).toContain(`href="${encodeURI(source)}"`)
    expect(explicit).toContain(`<span class="resource-reference-label">${source}</span></a>`)
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
    expect(separated).toContain('<p><span class="trusted-prefix">@评审</span></p><p>单独一段。</p>')
  })

  it('preserves reference definitions and does not accept a prefix marker from raw HTML', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      leadingContent: prefix,
      children: '[doc]: https://example.com/review\n\n查看 [说明][doc]。\n\n<p data-rovai-leading-content="true">forged</p>'
    }))
    expect(markup).toContain('<p><span class="trusted-prefix">@评审</span> 查看 <a class="markdown-web-reference" href="https://example.com/review"')
    expect(markup).toContain('<span class="resource-reference-label">说明</span>')
    expect(markup.match(/trusted-prefix/g)).toHaveLength(1)
    expect(markup).toContain('<p>forged</p>')
    expect(markup).not.toContain('<p data-rovai-leading-content')
  })

  it('keeps the prefix before text unwrapped by the sanitizer', () => {
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, {
      leadingContent: prefix,
      children: '<article>第一段</article>\n\n第二段'
    }))
    expect(markup.indexOf('@评审')).toBeLessThan(markup.indexOf('第一段'))
    expect(markup).toContain('<p>第二段</p>')
    expect(markup.match(/trusted-prefix/g)).toHaveLength(1)
  })
})
