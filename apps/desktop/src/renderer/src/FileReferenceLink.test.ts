import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileReferenceText } from './FileReferenceLink'
import { SafeMarkdown } from './SafeMarkdown'

const examples = [
  '- Markdown：[v1.30 方案](docs/versions/v1.30/README.md)',
  '- HTML：[成员管理原型](docs/prototypes/camp-member-management/index.html)',
  '- 代码：[预览实现](apps/desktop/src/renderer/src/FilePreviewPane.tsx:1)',
  '- 图片：[Camp 会话截图](docs/assets/readme/camp-conversation.png)',
  '- SVG：[应用图标](build/icon.svg)'
].join('\n')

const renderers = [{
  name: 'user message text',
  rendersWebLinks: false,
  render: (source: string) => renderToStaticMarkup(createElement(FileReferenceText, {
    text: source,
    onActivate: () => undefined
  }))
}, {
  name: 'safe Markdown',
  rendersWebLinks: true,
  render: (source: string) => renderToStaticMarkup(createElement(SafeMarkdown, {
    children: source,
    onFileReference: () => undefined
  }))
}]

describe.each(renderers)('file-link presentation in $name', ({ render, rendersWebLinks }) => {
  it('shows explicit labels once, keeps relative targets in tooltips, and uses true file-type icons', () => {
    const markup = render(examples)
    const visibleText = markup.replace(/<[^>]*>/gu, '')
    expect(markup.match(/<a /gu)).toHaveLength(5)
    expect(markup).not.toContain('<button')
    for (const [label, target] of [
      ['v1.30 方案', 'docs/versions/v1.30/README.md'],
      ['成员管理原型', 'docs/prototypes/camp-member-management/index.html'],
      ['预览实现', 'apps/desktop/src/renderer/src/FilePreviewPane.tsx:1'],
      ['Camp 会话截图', 'docs/assets/readme/camp-conversation.png'],
      ['应用图标', 'build/icon.svg']
    ]) {
      expect(visibleText).toContain(label)
      expect(visibleText).not.toContain(target)
      expect(markup).toContain(`title="${target}"`)
      expect(visibleText).not.toContain(`[${label}]`)
    }
    expect(markup.match(/<svg /gu)).toHaveLength(5)
    expect(markup).toContain('aria-hidden="true"')
    for (const kind of ['markdown', 'html', 'code', 'image', 'svg']) {
      expect(markup).toContain(`data-resource-type="${kind}"`)
    }
    expect(markup).not.toContain('inline-code-file-reference')
    expect(markup).not.toContain('file-reference-label is-code')
  })

  it('does not scan labels, inline code, code blocks, web URLs, or ordinary prose as files', () => {
    const markup = render([
      '[src/label.ts](src/target.ts:20)',
      'https://example.com/src/remote.ts',
      '[网站](https://example.com/src/remote.ts)',
      '`src/inline.ts:4` 与 `sum()`',
      '',
      '```md',
      '[不要打开](src/secret.md)',
      'src/secret.ts:3',
      '```',
      '',
      '请查看 src/bare.ts:20。'
    ].join('\n'))
    expect(markup).toContain('title="src/target.ts:20"')
    expect(markup).not.toContain('title="src/inline.ts:4"')
    expect(markup).not.toContain('title="src/bare.ts:20"')
    expect(markup).not.toContain('title="src/label.ts"')
    expect(markup).not.toContain('title="src/secret')
    expect(markup).not.toContain('title="https:')
    expect(markup).toContain('<code>src/inline.ts:4</code>')
    expect(markup.match(/class="(?:message|markdown)-file-reference"/gu)).toHaveLength(1)
    expect(markup.match(/data-resource-type="web"/gu) ?? []).toHaveLength(rendersWebLinks ? 2 : 0)
  })

  it('keeps labels separate from targets with spaces, escapes and line fragments', () => {
    const markup = render('请看 [**规划** 与 `配置`](<docs/my plan.md#L3> "额外说明") 和 [Windows](C:/work/app.ts:20)。')
    expect(markup).toContain('title="docs/my plan.md#L3"')
    expect(markup).not.toContain('title="C:/work/app.ts:20"')
    expect(markup).toContain('data-resource-type="code"')
    expect(markup).not.toContain('file-reference-label is-code')
    const visibleText = markup.replace(/<[^>]*>/gu, '')
    expect(visibleText).toContain('规划 与 配置')
    expect(visibleText).not.toContain('docs/my plan.md')
    expect(visibleText).not.toContain('C:/work/app.ts')
  })

  it('keeps a visible name for empty labels and uses the same literal tilde rules', () => {
    const markup = render('[](src/app.ts) [~原样~](docs/plan.md)')
    expect(markup).toContain('title="src/app.ts"')
    expect(markup).toContain('<span class="file-reference-label">src/app.ts</span>')
    expect(markup).toContain('title="docs/plan.md"')
    expect(markup).toContain('<span class="file-reference-label">~原样~</span>')
  })

  it('keeps every inline-code path inert and opens a located name only when explicitly linked', () => {
    const inert = render('`config.toml`；`run_gr_reminder.py`；`run_report.py:44-46`；`/Users/name/demo.html`')
    expect(inert).not.toContain('<a ')
    expect(inert.match(/<code>/gu)).toHaveLength(4)

    const linked = render('主实现 `src/report/run_report.py`，定位 [对应代码](run_report.py:44-46)。')
    expect(linked.match(/<a /gu)).toHaveLength(1)
    expect(linked).toContain('title="run_report.py:44-46"')
    expect(linked).toContain('<code>src/report/run_report.py</code>')
  })
})

// Pointer selection, keyboard activation, exact sources and range targets are exercised
// with native input in scripts/fixtures/file-reference-navigation/main.cjs.
describe('file references without an opener', () => {
  it('preserves the original source when there is no file opener', () => {
    const source = '[方案](docs/plan.md) `src/app.ts:20`'
    expect(renderToStaticMarkup(createElement(FileReferenceText, { text: source }))).toBe(source)
  })
})
