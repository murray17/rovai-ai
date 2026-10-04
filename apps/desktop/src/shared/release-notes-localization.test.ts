import { describe, expect, it } from 'vitest'
import { hasReleaseNotesContent, parseReleaseNotesLanguages, selectReleaseNotesLanguage } from './release-notes-localization'

const bilingual = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\n## What’s new\n\n- English notes\n\n<!-- lang:zh-CN -->\n\n## 更新内容\n\n- 中文说明\n'

describe('Release Notes 语言选择', () => {
  it('仅选择匹配的语言正文，保留公共前言及原始 Markdown', () => {
    const english = selectReleaseNotesLanguage(bilingual, 'en')
    const chinese = selectReleaseNotesLanguage(bilingual, 'zh-CN')
    expect(english).toContain('# Rovai AI v0.0.3')
    expect(english).toContain('- English notes')
    expect(english).not.toContain('中文说明')
    expect(chinese).toContain('- 中文说明')
    expect(chinese).not.toContain('English notes')
    expect(chinese).not.toContain('<!-- lang:')
    expect(parseReleaseNotesLanguages(bilingual)?.sections.map((section) => section.language))
      .toEqual(['en', 'zh-cn'])
  })

  it.each(['# 历史版本\n\n中文说明', '# Historical release\n\nEnglish notes', '', '   ', '<p>Legacy HTML</p>'])
  ('无标记的历史或单语言正文原样返回：%s', (source) => {
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toBe(source)
    expect(selectReleaseNotesLanguage(source, 'en')).toBe(source)
  })

  it('接受语言大小写、CRLF、独立标记的空白与调换顺序', () => {
    const source = '<!-- LANG: ZH-cn -->\r\n\r\n中文\r\n\r\n<!-- lang:EN -->\r\n\r\nEnglish\r\n'
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toBe('\r\n中文\r\n\r\n')
    expect(selectReleaseNotesLanguage(source, 'en')).toBe('\r\nEnglish\r\n')
  })

  it('没有公共版本标题也可选择语言', () => {
    const source = '<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n中文'
    expect(selectReleaseNotesLanguage(source, 'en').trim()).toBe('English')
    expect(selectReleaseNotesLanguage(source, 'zh-CN').trim()).toBe('中文')
  })

  it('缺少对应版本时按同语种、英文、首个非空语言回退', () => {
    const source = '<!-- lang:fr -->\n\nFrançais\n\n<!-- lang:zh -->\n\n中文\n\n<!-- lang:en -->\n\nEnglish'
    expect(selectReleaseNotesLanguage(source, 'zh-CN').trim()).toBe('中文')
    expect(selectReleaseNotesLanguage(source, 'de').trim()).toBe('English')
    expect(selectReleaseNotesLanguage('<!-- lang:fr -->\n\nFrançais', 'en').trim()).toBe('Français')
    expect(selectReleaseNotesLanguage('<!-- lang:zh-CN -->\n\n中文', 'en').trim()).toBe('中文')
    expect(selectReleaseNotesLanguage('<!-- lang:en-US -->\n\nEnglish', 'en').trim()).toBe('English')
  })

  it('空白、仅注释与仅引用定义的匹配语言段不会阻挡回退', () => {
    for (const empty of ['   \n', '<!-- coming soon -->\n', '[guide]: https://example.com\n']) {
      const source = `<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n${empty}`
      expect(selectReleaseNotesLanguage(source, 'zh-CN')).toContain('English')
    }
    const emptySource = '<!-- lang:en -->\n\n<!-- lang:zh-CN -->\n'
    expect(selectReleaseNotesLanguage(emptySource, 'zh-CN')).toBe(emptySource)
  })

  it.each([
    '> <!-- Coming soon -->',
    '> [docs]: https://example.com',
    '- <!-- Coming soon -->',
    '- > <!-- Coming soon -->',
    '[^details]: Hidden footnote',
    '![Hidden image](https://example.com/image.png)'
  ])('无可见正文的嵌套容器或定义不会阻挡回退：%s', (empty) => {
    const source = `<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n${empty}\n`
    expect(hasReleaseNotesContent(empty)).toBe(false)
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toContain('English')
  })

  it('跨语言图片引用使用全局定义上下文，不把被禁止图片误判为文字', () => {
    const source = '<!-- lang:en -->\n\nEnglish\n\n[img]: https://example.com/image.png\n\n<!-- lang:zh-CN -->\n\n![Hidden image][img]'
    const parsed = parseReleaseNotesLanguages(source)!
    expect(hasReleaseNotesContent(parsed.sections[1].content, parsed.definitions)).toBe(false)
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toContain('English')
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).not.toContain('Hidden image')
  })

  it('可见正文位于引用、列表或脚注引用中时保留匹配语言', () => {
    for (const content of ['> 中文', '- 中文', '中文[^details]\n\n[^details]: 补充说明']) {
      const source = `<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN -->\n\n${content}`
      expect(hasReleaseNotesContent(content)).toBe(true)
      expect(selectReleaseNotesLanguage(source, 'zh-CN')).toContain('中文')
      expect(selectReleaseNotesLanguage(source, 'zh-CN')).not.toContain('English')
    }
  })

  it.each([
    '<!-- lang:en -->\n\nFirst\n\n<!-- lang:EN -->\n\nSecond',
    '<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh_CN -->\n\n中文',
    '<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN',
    '<!-- lang:en -->\n\nEnglish\n\n<!-- lang:zh-CN --> trailing\n\n中文',
    '<!-- lang:en -->\n\nEnglish\n\n<div>\n<!-- lang:zh-CN -->\n中文\n</div>'
  ])('重复、畸形或歧义标记保留全文：%s', (source) => {
    expect(parseReleaseNotesLanguages(source)).toBeNull()
    expect(selectReleaseNotesLanguage(source, 'en')).toBe(source)
  })

  it.each([
    '说明文字 <!-- lang:fr -->\nContenu français.',
    '说明文字 <!-- lang:zh_CN -->',
    '# 说明文字 <!-- lang:fr -->',
    '**说明文字 <!-- lang:fr -->**',
    '| 内容 |\n| --- |\n| 说明文字 <!-- lang:fr --> |'
  ])('正文内混行语言注释使整份说明回退：%s', (mixed) => {
    const source = `# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish\n\n${mixed}\n\n<!-- lang:zh-CN -->\n\n中文`
    expect(parseReleaseNotesLanguages(source)).toBeNull()
    expect(selectReleaseNotesLanguage(source, 'en')).toBe(source)
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toBe(source)
  })

  it.each([
    '```md\n<!-- lang:zh-CN -->\n```',
    '~~~~md\n<!-- lang:zh-CN -->\n~~~~',
    '    <!-- lang:zh-CN -->',
    '> <!-- lang:zh-CN -->\n>\n> 引用示例',
    '> 引用示例 <!-- lang:zh-CN -->',
    '- 示例\n\n  <!-- lang:zh-CN -->',
    '- 列表示例 <!-- lang:zh-CN -->',
    '脚注示例[^example]\n\n[^example]: 说明 <!-- lang:zh-CN -->',
    '这里的 `<!-- lang:zh-CN -->` 只是代码',
    '普通注释 <!-- 示例：<!-- lang:zh-CN --> -->',
    '<!--\n示例：\n<!-- lang:zh-CN -->\n-->'
  ])('代码、引用、列表或普通注释中的标记不截断语言段：%s', (example) => {
    const source = `<!-- lang:en -->\n\nEnglish\n\n${example}\n\nEnd of English\n\n<!-- lang:zh-CN -->\n\n中文`
    const selected = selectReleaseNotesLanguage(source, 'en')
    expect(selected).toContain(example)
    expect(selected).toContain('End of English')
    expect(selected).not.toContain('\n\n中文')
  })

  it('选择末段直到文档结束，并保留所在段的升级提醒', () => {
    const source = `${bilingual}\n### 升级提醒\n\n最后一条不可丢失`
    expect(selectReleaseNotesLanguage(source, 'zh-CN')).toContain('最后一条不可丢失')
    expect(selectReleaseNotesLanguage(source, 'en')).not.toContain('最后一条不可丢失')
  })

  it('保留位于其他语言段中的文档级引用式链接定义', () => {
    const source = '<!-- lang:en -->\n\nRead [guide][docs].\n\n<!-- lang:zh-CN -->\n\n阅读[指南][docs]。\n\n[docs]: https://example.com/guide "Guide"\n'
    const english = selectReleaseNotesLanguage(source, 'en')
    expect(english).toContain('Read [guide][docs].')
    expect(english).toContain('[docs]: https://example.com/guide "Guide"')
    expect(english).not.toContain('阅读')
  })
})
