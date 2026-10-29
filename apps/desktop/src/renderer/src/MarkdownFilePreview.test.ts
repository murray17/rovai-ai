import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownFilePreview } from './MarkdownFilePreview'
import { SafeMarkdown } from './SafeMarkdown'

describe('MarkdownFilePreview', () => {
  it('renders front matter as metadata and leaves the document heading hierarchy intact', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownFilePreview, {
      source: [
        '---',
        'document_type: contract',
        'authority: renderer-file-preview',
        'last_updated: 2026-09-19',
        '---',
        '',
        '# File Preview',
        '',
        '<!-- private-metadata -->',
        '',
        '<div>allowed-html-body</div>'
      ].join('\n')
    }))

    expect(markup).toContain('class="file-preview-metadata"')
    expect(markup).toContain('class="file-preview-metadata-caption"')
    expect(markup).toContain('<dt>document_type</dt><dd><span class="file-preview-metadata-value">contract</span></dd>')
    expect(markup).toContain('<h1 data-markdown-heading="File Preview">File Preview</h1>')
    expect(markup).not.toContain('data-markdown-heading="document_type')
    expect(markup).not.toContain('private-metadata')
    expect(markup).toContain('<div>allowed-html-body</div>')
  })

  it('renders nested values as selectable text without interpreting embedded HTML', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownFilePreview, {
      source: [
        '---',
        'tags: [markdown, accessibility]',
        'owners:',
        '  renderer: desktop-team',
        '  review: design-team',
        'unsafe: "<button onclick=\'alert(1)\'>text</button>"',
        '---',
        'Body'
      ].join('\n')
    }))

    expect(markup).toContain('- markdown\n- accessibility')
    expect(markup).toContain('renderer: desktop-team\nreview: design-team')
    expect(markup).toContain('&lt;button onclick=&#x27;alert(1)&#x27;&gt;text&lt;/button&gt;')
    expect(markup).not.toContain('<button onclick=')
  })

  it('shows a malformed header as raw code without blocking the Markdown body', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownFilePreview, {
      source: '---\nauthority: [renderer\n---\n\n# Body still renders'
    }))

    expect(markup).toContain('元数据格式有误，已保留原始文件头。')
    expect(markup).toContain('<pre class="file-preview-metadata-raw"><code>---\nauthority: [renderer\n---\n</code></pre>')
    expect(markup).toContain('<h1 data-markdown-heading="Body still renders">Body still renders</h1>')
  })

  it('adds no metadata surface or spacing for an ordinary Markdown file', () => {
    const source = '# Ordinary\n\n```yaml\n---\nauthority: example\n---\n```\n\n---\n'
    const markup = renderToStaticMarkup(createElement(MarkdownFilePreview, { source }))

    expect(markup).not.toContain('file-preview-metadata')
    expect(markup).toContain('<h1 data-markdown-heading="Ordinary">Ordinary</h1>')
    expect(markup).toContain('<code data-code-language="yaml">---\nauthority: example\n---\n</code>')
    expect(markup).toContain('<hr/>')
  })

  it('does not change the shared message Markdown renderer', () => {
    const source = '---\ndocument_type: contract\n---\n\n# Message body'
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, { children: source }))

    expect(markup).not.toContain('file-preview-metadata')
    expect(markup).toContain('document_type: contract')
    expect(markup).toContain('<h3 data-markdown-heading="Message body">Message body</h3>')
  })
})
