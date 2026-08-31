import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileReferenceLink, FileReferenceText } from './FileReferenceLink'
import { SafeMarkdown } from './SafeMarkdown'

const examples = [
  '- Markdown：[v1.30 方案](docs/versions/v1.30/README.md)',
  '- HTML：[成员管理原型](docs/prototypes/camp-member-management/index.html)',
  '- 代码：`apps/desktop/src/renderer/src/FilePreviewPane.tsx:1`',
  '- 图片：[Camp 会话截图](docs/assets/readme/camp-conversation.png)',
  '- SVG：[应用图标](build/icon.svg)'
].join('\n')

const renderers = [{
  name: 'user message text',
  render: (source: string) => renderToStaticMarkup(createElement(FileReferenceText, {
    text: source,
    onActivate: () => undefined
  }))
}, {
  name: 'safe Markdown',
  render: (source: string) => renderToStaticMarkup(createElement(SafeMarkdown, {
    children: source,
    onFileReference: () => undefined
  }))
}]

describe.each(renderers)('file-link presentation in $name', ({ render }) => {
  it('shows descriptions once, keeps targets in tooltips, and distinguishes code file links', () => {
    const markup = render(examples)
    const visibleText = markup.replace(/<[^>]*>/gu, '')
    expect(markup.match(/<a /gu)).toHaveLength(5)
    expect(markup).not.toContain('<button')
    for (const [label, target] of [
      ['v1.30 方案', 'docs/versions/v1.30/README.md'],
      ['成员管理原型', 'docs/prototypes/camp-member-management/index.html'],
      ['Camp 会话截图', 'docs/assets/readme/camp-conversation.png'],
      ['应用图标', 'build/icon.svg']
    ]) {
      expect(visibleText).toContain(label)
      expect(visibleText).not.toContain(target)
      expect(markup).toContain(`title="${target}"`)
      expect(visibleText).not.toContain(`[${label}]`)
    }
    expect(markup.match(/class="(?:message|markdown)-file-reference inline-code-file-reference"/gu)).toHaveLength(1)
    expect(markup.match(/<svg /gu)).toHaveLength(1)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('<span class="inline-code-file-reference-label">apps/desktop/src/renderer/src/FilePreviewPane.tsx:1</span>')
    expect(markup).not.toContain('<code>')
    expect(visibleText.match(/apps\/desktop\/src\/renderer\/src\/FilePreviewPane.tsx:1/gu)).toHaveLength(1)
  })

  it('does not nest file links inside labels or web URLs, or activate code blocks', () => {
    const markup = render([
      '[src/label.ts](src/target.ts:20)',
      'https://example.com/src/remote.ts',
      '[网站](https://example.com/src/remote.ts)',
      '`sum()`',
      '',
      '```md',
      '[不要打开](src/secret.md)',
      'src/secret.ts:3',
      '```',
      '',
      '请查看 src/bare.ts:20。'
    ].join('\n'))
    expect(markup).toContain('title="src/target.ts:20"')
    expect(markup).toContain('title="src/bare.ts:20"')
    expect(markup).not.toContain('title="src/label.ts"')
    expect(markup).not.toContain('title="src/secret')
    expect(markup).not.toContain('title="https:')
    expect(markup.match(/class="(?:message|markdown)-file-reference"/gu)).toHaveLength(2)
  })

  it('keeps labels separate from targets with spaces, escapes and line fragments', () => {
    const markup = render('请看 [**规划** 与 `配置`](<docs/my plan.md#L3> "额外说明") 和 [Windows](C:/work/app.ts:20)。')
    expect(markup).toContain('title="docs/my plan.md#L3"')
    expect(markup).toContain('title="C:/work/app.ts:20"')
    const visibleText = markup.replace(/<[^>]*>/gu, '')
    expect(visibleText).toContain('规划 与 配置')
    expect(visibleText).not.toContain('docs/my plan.md')
    expect(visibleText).not.toContain('C:/work/app.ts')
  })

  it('keeps a visible name for empty labels and uses the same literal tilde rules', () => {
    const markup = render('[](src/app.ts) [~原样~](docs/plan.md)')
    expect(markup).toContain('title="src/app.ts">src/app.ts</a>')
    expect(markup).toContain('title="docs/plan.md">~原样~</a>')
  })

  it('leaves field lists and unqualified filenames inert, and links a located short name only with a source', () => {
    const markup = render('WBS(外码)/WBS描述/成本中心/FBP/GR-手工金额，心/FBP）有值。`run_gr_reminder.py`；`run_report.py:44-46`')
    expect(markup).not.toContain('<a ')
    const resolved = render('主实现 `src/report/run_report.py`，定位 `run_report.py:44-46`；`run_gr_reminder.py` 保持原文。')
    expect(resolved.match(/<a /gu)).toHaveLength(2)
    expect(resolved).toContain('title="run_report.py:44-46"')
    expect(resolved).not.toContain('title="run_gr_reminder.py"')
    expect(render('`src/a/run_report.py` `src/b/run_report.py` `run_report.py:44-46`'))
      .not.toContain('title="run_report.py:44-46"')
    expect(render('```\nsrc/run_report.py\n```\n\n`run_report.py:44-46`')).not.toContain('<a ')
  })
})

describe('file link activation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens the exact target without navigating the document and supports keyboard activation', () => {
    const onActivate = vi.fn()
    vi.stubGlobal('window', { getSelection: () => ({ toString: () => '' }) })
    const link = FileReferenceLink({ rawReference: 'src/app.ts:20', children: '实现', className: 'message-file-reference', onActivate })
    const props = link.props as { onClick(event: { detail: number; currentTarget: HTMLElement; preventDefault(): void }): void }
    const preventDefault = vi.fn()
    const currentTarget = {} as HTMLElement
    props.onClick({ detail: 1, currentTarget, preventDefault })
    props.onClick({ detail: 0, currentTarget, preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(onActivate.mock.calls).toEqual([
      ['src/app.ts:20', currentTarget, undefined], ['src/app.ts:20', currentTarget, undefined]
    ])
  })

  it('keeps mouse text selection from opening a file, without blocking keyboard activation', () => {
    const onActivate = vi.fn()
    vi.stubGlobal('window', { getSelection: () => ({ toString: () => '选中文字' }) })
    const link = FileReferenceLink({ rawReference: 'src/app.ts', children: '实现', className: 'message-file-reference', onActivate })
    const props = link.props as { onClick(event: { detail: number; preventDefault(): void }): void }
    props.onClick({ detail: 1, preventDefault: () => undefined })
    expect(onActivate).not.toHaveBeenCalled()
    props.onClick({ detail: 0, preventDefault: () => undefined })
    expect(onActivate).toHaveBeenCalledWith('src/app.ts', undefined, undefined)
  })

  it('keeps the verified source and the requested line range separate on activation', () => {
    const onActivate = vi.fn()
    vi.stubGlobal('window', { getSelection: () => null })
    const link = FileReferenceLink({
      rawReference: 'run_report.py:44-46', sourceReference: 'src/report/run_report.py',
      children: 'run_report.py:44-46', className: 'message-file-reference', onActivate
    })
    const currentTarget = {} as HTMLElement
    const props = link.props as { onClick(event: { detail: number; currentTarget: HTMLElement; preventDefault(): void }): void }
    props.onClick({ detail: 1, currentTarget, preventDefault: () => undefined })
    expect(onActivate).toHaveBeenCalledWith('src/report/run_report.py', currentTarget, { line: 44, endLine: 46 })
  })

  it('preserves the original source when there is no file opener', () => {
    const source = '[方案](docs/plan.md) `src/app.ts:20`'
    expect(renderToStaticMarkup(createElement(FileReferenceText, { text: source }))).toBe(source)
  })
})
