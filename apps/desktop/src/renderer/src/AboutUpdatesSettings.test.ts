import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppUpdateRelease, AppUpdateSnapshot, GeneralPreferencesApi } from '@contracts'
import { changeInterfaceLanguage } from './interface-language'
import { AboutUpdatesSettingsView } from './AboutUpdatesSettings'
import { displayReleaseNotes } from './release-notes-display'
import { SafeMarkdown } from './SafeMarkdown'
import type { AppUpdateActionError } from './useAppUpdates'

const release: AppUpdateRelease = {
  version: '0.0.3',
  releaseName: 'Rovai AI 0.0.3',
  releaseDate: '2026-08-24T08:00:00.000Z',
  releaseNotes: '### 修复\n\n- 更可靠的更新流程'
}

function snapshot(overrides: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    currentVersion: '0.0.2',
    currentRelease: {
      version: '0.0.2',
      releaseName: 'Rovai AI v0.0.2',
      releaseDate: '2026-08-22T08:00:00.000Z',
      releaseNotes: '# Rovai AI v0.0.2\n\n- 已安装版本日志'
    },
    status: 'idle',
    availableRelease: null,
    lastCheckSource: null,
    checkedAt: null,
    lastSuccessfulCheckAt: null,
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    failureReason: null,
    pendingPrompt: null,
    ...overrides
  }
}

function render(value: AppUpdateSnapshot | null, options: {
  loading?: boolean
  loadError?: boolean
  actionError?: AppUpdateActionError
  readOnly?: boolean
  product?: 'desktop' | 'server'
} = {}): string {
  return renderToStaticMarkup(createElement(AboutUpdatesSettingsView, {
    snapshot: value,
    canUpdate: true,
    loading: options.loading ?? false,
    loadError: options.loadError ?? false,
    actionError: options.actionError ?? null,
    readOnly: options.readOnly ?? false,
    product: options.product ?? 'desktop',
    onCheck: () => undefined,
    onDownload: () => undefined,
    onInstall: () => undefined
  }))
}

const languageApi = {
  setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') => ({ interfaceLanguage })
} as GeneralPreferencesApi

afterEach(async () => { await changeInterfaceLanguage(languageApi, 'zh-CN') })

describe('AboutUpdatesSettingsView', () => {
  it('links Server update fallback to the exact bridge or unified release tag', () => {
    const markup = render(snapshot({
      status: 'download_failed',
      availableRelease: release,
      failureReason: 'network'
    }), { product: 'server' })
    expect(markup).toContain('https://github.com/murray17/rovai-ai/releases/tag/v0.0.3')
    const bridge = render(snapshot({
      status: 'download_failed',
      availableRelease: { ...release, version: '0.4.1' },
      failureReason: 'network'
    }), { product: 'server' })
    expect(bridge).toContain('https://github.com/murray17/rovai-ai/releases/tag/server-v0.4.1')
  })
  it('always shows the installed version and keeps all update mutations user initiated', () => {
    const markup = render(snapshot())
    expect(markup).toContain('class="about-updates-settings" data-update-read-only="false"')
    expect(markup).toContain('class="about-update-control" data-update-status="idle"')
    expect(markup).toContain('<h1>关于与更新</h1>')
    expect(markup).toContain('版本 v0.0.2')
    expect(markup).toContain('>检查更新</button>')
    expect(markup).toContain('下载与安装由你决定')
    expect(markup).toContain('更新日志</h2>')
    expect(markup).toContain('已安装版本日志')
    expect(markup).toContain('发布日期：<time dateTime="2026-08-22T08:00:00.000Z">2026年8月22日</time>')
    expect(markup.match(/Rovai AI v0\.0\.2/g)).toHaveLength(1)
    expect(markup).not.toContain('role="tablist"')
    expect(markup).not.toContain('官方 Releases')
  })

  it('shows an available release without starting the download', () => {
    const markup = render(snapshot({
      status: 'available',
      availableRelease: release,
      lastCheckSource: 'startup',
      checkedAt: '2026-08-24T08:00:00.000Z',
      lastSuccessfulCheckAt: '2026-08-24T08:00:01.000Z',
      pendingPrompt: { id: 'prompt-1', version: '0.0.3' }
    }))
    expect(markup).toContain('>下载更新</button>')
    expect(markup).toContain('>重新检查</button>')
    expect(markup).toContain('等待下载确认')
    expect(markup).toContain('Rovai AI 0.0.3')
    expect(markup).toContain('role="tablist" aria-label="日志版本"')
    expect(markup).toContain('aria-selected="true" tabindex="0" data-app-update-release-tab="available"')
    expect(markup).toContain('id="about-release-panel-current" role="tabpanel"')
    expect(markup).toContain('v0.0.3')
    expect(markup).toContain('2026年8月24日')
    expect(markup).toContain('启动自动')
    expect(markup).not.toContain('官方 Releases')
  })

  it('retains known release facts while a new check is in progress', () => {
    const markup = render(snapshot({
      status: 'checking',
      availableRelease: release,
      lastCheckSource: 'manual',
      checkedAt: '2026-08-25T08:00:00.000Z',
      lastSuccessfulCheckAt: '2026-08-24T08:00:00.000Z'
    }))
    expect(markup).toContain('正在重新检查')
    expect(markup).toContain('现有更新信息会保留')
    expect(markup).toContain('disabled="" aria-busy="true"')
    expect(markup).toContain('手动')
    expect(markup).toContain('Rovai AI 0.0.3')
  })

  it('shows stable download progress and transfer detail', () => {
    const markup = render(snapshot({
      status: 'downloading',
      availableRelease: release,
      downloadPercent: 42.3,
      transferredBytes: 42_340_000,
      totalBytes: 100_000_000,
      bytesPerSecond: 5_000_000
    }))
    expect(markup).toContain('正在下载 42%')
    expect(markup).toContain('class="about-update-control" data-update-status="downloading"')
    expect(markup).toContain('<progress max="100" value="42.3"')
    expect(markup).toContain('40.4 MB / 95.4 MB')
    expect(markup).toContain('4.8 MB/s')
    expect(markup).toContain('下载期间可以继续使用')
  })

  it('marks a read-only host without rendering update actions', () => {
    const markup = render(snapshot({ status: 'up_to_date' }), { readOnly: true })
    expect(markup).toContain('class="about-updates-settings" data-update-read-only="true"')
    expect(markup).not.toContain('class="about-update-control"')
  })

  it('offers installation only after the update is downloaded', () => {
    const ready = render(snapshot({ status: 'ready_to_install', availableRelease: release }))
    expect(ready).toContain('>安装并重启</button>')
    expect(ready).toContain('v0.0.3 已准备好')
    expect(ready).toContain('点击后将安装更新并重新启动')
    expect(ready).not.toContain('<progress')

    const installing = render(snapshot({ status: 'installing', availableRelease: release }))
    expect(installing).toContain('正在安装…')
    expect(installing).toContain('正在结束当前执行')
  })

  it('distinguishes current, check, download, and install failure recovery', () => {
    const current = render(snapshot({ status: 'up_to_date' }))
    expect(current).toContain('当前已是最新版本')
    expect(current).toContain('>重新检查</button>')

    const retainedCheckFailure = render(snapshot({
      status: 'check_failed',
      availableRelease: release,
      failureReason: 'network'
    }))
    expect(retainedCheckFailure).toContain('无法连接更新服务')
    expect(retainedCheckFailure).toContain('已知的 v0.0.3 信息仍然保留')
    expect(retainedCheckFailure).not.toContain('官方 Releases')

    const unavailable = render(snapshot({
      status: 'check_failed',
      failureReason: 'updater_unavailable'
    }))
    expect(unavailable).toContain('官方 Releases')
    expect(unavailable).toContain('获取支持')

    const invalid = render(snapshot({ status: 'check_failed', failureReason: 'invalid_release' }))
    expect(invalid).toContain('不会引导安装未经验证的包')
    expect(invalid).not.toContain('官方 Releases')

    const downloadFailed = render(snapshot({
      status: 'download_failed',
      availableRelease: release,
      failureReason: 'download_failed'
    }))
    expect(downloadFailed).toContain('>重试下载</button>')
    expect(downloadFailed).toContain('官方 Releases')

    const installFailed = render(snapshot({
      status: 'install_failed',
      availableRelease: release,
      failureReason: 'install_failed'
    }))
    expect(installFailed).toContain('>重试安装</button>')
    expect(installFailed).toContain('Core 与当前 App 仍可继续使用')
    expect(installFailed).not.toContain('官方 Releases')
  })

  it('renders empty and untrusted release notes through the safe markdown boundary', () => {
    const empty = render(snapshot({
      status: 'available',
      availableRelease: { ...release, releaseNotes: null }
    }))
    expect(empty).toContain('此版本没有提供更新日志')

    const unsafe = render(snapshot({
      status: 'available',
      availableRelease: {
        ...release,
        releaseNotes: '<script>alert(1)</script>\n\n[危险](javascript:alert(1)) ![像素](https://example.com/pixel.png) [说明](https://example.com/notes)'
      }
    }))
    expect(unsafe).not.toContain('<script')
    expect(unsafe).not.toContain('<img')
    expect(unsafe).not.toContain('href="javascript:')
    expect(unsafe).toContain('class="markdown-inert-link"')
    expect(unsafe).toContain('href="https://example.com/notes"')
  })

  it('removes only a matching leading release title from the displayed copy', () => {
    const titled = render(snapshot({
      status: 'available',
      availableRelease: {
        ...release,
        releaseNotes: '# Rovai AI v0.0.3\n\n本版摘要\n\n# Other title'
      }
    }))
    expect(titled).toContain('本版摘要')
    expect(titled).toContain('Other title')
    expect(titled).not.toContain('data-markdown-heading="Rovai AI v0.0.3"')

    const differentTitle = render(snapshot({
      status: 'available',
      availableRelease: { ...release, releaseNotes: '# Thread 改进\n\n本版摘要' }
    }))
    expect(differentTitle).toContain('data-markdown-heading="Thread 改进"')

    const fencedSource = '```md\n# Rovai AI v0.0.3\n```\n\n本版摘要'
    expect(displayReleaseNotes({ ...release, releaseNotes: fencedSource }, 'zh-CN')).toBe(fencedSource)
  })

  it('中英文界面仅渲染对应正文，当前版本与新版本共用规则且原文不变', async () => {
    const notes = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish release notes\n\n<!-- lang:zh-CN -->\n\n中文更新说明'
    const value = snapshot({
      status: 'available',
      availableRelease: { ...release, releaseNotes: notes },
      currentRelease: { ...release, version: '0.0.2', releaseNotes: notes.replaceAll('0.0.3', '0.0.2') }
    })
    const chinese = render(value)
    expect(chinese.match(/中文更新说明/g)).toHaveLength(2)
    expect(chinese).not.toContain('English release notes')
    expect(chinese).not.toContain('lang:')
    await changeInterfaceLanguage(languageApi, 'en')
    const english = render(value)
    expect(english.match(/English release notes/g)).toHaveLength(2)
    expect(english).not.toContain('中文更新说明')
    expect(english).not.toContain('lang:')
    expect(value.availableRelease?.releaseNotes).toBe(notes)
  })

  it('语言选择先于标题去重，保留不匹配标题和参考链接', () => {
    const source = '<!-- lang:en -->\n\n# Rovai AI v0.0.3\n\nRead [guide][docs].\n\n<!-- lang:zh-CN -->\n\n# 更新重点\n\n中文\n\n[docs]: https://example.com/guide'
    const value = { ...release, releaseNotes: source }
    expect(displayReleaseNotes(value, 'en')).not.toContain('# Rovai AI v0.0.3')
    expect(displayReleaseNotes(value, 'zh-CN')).toContain('# 更新重点')
    const english = displayReleaseNotes(value, 'en')
    expect(english).toContain('[docs]: https://example.com/guide')
  })

  it.each([
    '# Rovai AI v0.0.3',
    'Rovai AI v0.0.3\n===',
    '# v0.0.3\n\n<!-- Coming soon -->',
    '# Rovai AI 0.0.3\n\n> <!-- Coming soon -->'
  ])('匹配语言去除版本标题后无正文时展示英文回退：%s', (title) => {
    const source = `<!-- lang:en -->\n\nEnglish fallback\n\n<!-- lang:zh-CN -->\n\n${title}\n`
    const value = { ...release, releaseNotes: source }
    expect(displayReleaseNotes(value, 'zh-CN')).toContain('English fallback')
    const markup = render(snapshot({ status: 'available', availableRelease: value }))
    expect(markup).toContain('<p>English fallback</p>')
    expect(markup).not.toContain('class="about-release-empty"')
    expect(value.releaseNotes).toBe(source)
  })

  it('跳过多个仅版本标题的语言段，优先同语种且保留跨段引用定义', () => {
    const source = '<!-- lang:zh-CN -->\n\n# Rovai AI v0.0.3\n\n[docs]: https://example.com/guide\n\n<!-- lang:zh -->\n\n# v0.0.3\n\n<!-- lang:zh-TW -->\n\n閱讀[指南][docs]。\n\n<!-- lang:en -->\n\nEnglish fallback'
    const value = { ...release, releaseNotes: source }
    const markup = render(snapshot({ status: 'available', availableRelease: value }))
    expect(markup).toContain('閱讀')
    expect(markup).toContain('href="https://example.com/guide"')
    expect(markup).not.toContain('English fallback')
  })

  it('英文段去除版本标题后无正文时回退到首个可用语言', () => {
    const source = '<!-- lang:en -->\n\n# Rovai AI v0.0.3\n\n<!-- lang:zh-CN -->\n\n中文回退'
    expect(displayReleaseNotes({ ...release, releaseNotes: source }, 'en')).toContain('中文回退')
  })

  it.each(['# Rovai AI v0.0.3\n', ' \n\t', '# Rovai AI v0.0.3\n\n[docs]: https://example.com/guide'])
  ('最终没有可见正文时显示明确空态：%s', (source) => {
    const value = { ...release, releaseNotes: source }
    expect(displayReleaseNotes(value, 'zh-CN')).toBeNull()
    const markup = render(snapshot({ status: 'available', availableRelease: value }))
    expect(markup).toContain('此版本没有提供更新日志')
  })

  it.each([
    '中文\n\n[docs]: https://example.com/guide',
    '中文\n\n> [docs]: https://example.com/guide',
    '中文\n\n- [docs]: https://example.com/guide'
  ])('跨语言定义不被代码中的同文示例遮蔽，且保留嵌套定义：%s', (chinese) => {
    const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nRead [guide][docs].\n\n```md\n[docs]: https://example.com/guide\n```\n\n<!-- lang:zh-CN -->\n\n' + chinese
    const notes = displayReleaseNotes({ ...release, releaseNotes: source }, 'en')!
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, { children: notes, mode: 'document' }))
    expect(markup).toContain('href="https://example.com/guide"')
    expect(markup).not.toContain('Read [guide][docs]')
    expect(markup).not.toContain('中文')
    expect(markup).not.toContain('data-markdown-heading="Rovai AI v0.0.3"')
  })

  it('重复引用定义保持原文的大小写与空白归一化 first-wins 目标', () => {
    const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish\n\n[Guide Docs]: https://example.com/first\n\n<!-- lang:zh-CN -->\n\n阅读[指南][guide docs]。\n\n[GUIDE  DOCS]: https://example.com/second'
    const renderNotes = (notes: string) => renderToStaticMarkup(createElement(SafeMarkdown, { children: notes, mode: 'document' }))
    const original = renderNotes(source)
    const localized = renderNotes(displayReleaseNotes({ ...release, releaseNotes: source }, 'zh-CN')!)
    expect(original).toContain('href="https://example.com/first"')
    expect(localized).toContain('href="https://example.com/first"')
    expect(localized).not.toContain('href="https://example.com/second"')
    expect(localized).not.toContain('English')
    expect(localized).not.toContain('data-markdown-heading="Rovai AI v0.0.3"')
  })

  it('跨语言 GFM 脚注保留所有段落，并继续去除冗余首标题', () => {
    const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nRead[^details].\n\n<!-- lang:zh-CN -->\n\n中文\n\n[^details]: First paragraph\n\n    Second paragraph\n'
    const notes = displayReleaseNotes({ ...release, releaseNotes: source }, 'en')!
    const markup = renderToStaticMarkup(createElement(SafeMarkdown, { children: notes, mode: 'document' }))
    expect(markup).toContain('data-footnotes="true"')
    expect(markup).toContain('<p>First paragraph</p>')
    expect(markup).toContain('<p>Second paragraph')
    expect(markup).not.toContain('中文')
    expect(markup).not.toContain('data-markdown-heading="Rovai AI v0.0.3"')
  })

  it('重复脚注中的全局链接定义不会随被覆盖脚注丢失', () => {
    const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nRead [guide][docs].[^outer]\n\n[^outer]: First footnote\n\n<!-- lang:zh-CN -->\n\n中文\n\n[^outer]: Duplicate footnote\n\n    [docs]: https://example.com/guide\n'
    const renderNotes = (notes: string) => renderToStaticMarkup(createElement(SafeMarkdown, { children: notes, mode: 'document' }))
    const original = renderNotes(source)
    const localized = renderNotes(displayReleaseNotes({ ...release, releaseNotes: source }, 'en')!)
    expect(original).toContain('href="https://example.com/guide"')
    expect(localized).toContain('href="https://example.com/guide"')
    expect(localized).toContain('First footnote')
    expect(localized).not.toContain('Duplicate footnote')
    expect(localized).not.toContain('中文')
    expect(localized).not.toContain('data-markdown-heading="Rovai AI v0.0.3"')
  })

  it('匹配段只有隐藏引用内容时，展示英文回退而不是空白', () => {
    const source = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish fallback\n\n<!-- lang:zh-CN -->\n\n> <!-- Coming soon -->'
    const markup = render(snapshot({ status: 'available', availableRelease: { ...release, releaseNotes: source } }))
    expect(markup).toContain('English fallback')
    expect(markup).not.toContain('Coming soon')
  })

  it('keeps renderer action failures recoverable without discarding the snapshot', () => {
    const markup = render(snapshot({ status: 'available', availableRelease: release }), {
      actionError: 'download'
    })
    expect(markup).toContain('下载请求未完成')
    expect(markup).toContain('已知版本信息和当前 App 状态没有被清除')
    expect(markup).toContain('Rovai AI 0.0.3')
  })

  it('allows an in-page retry when the initial snapshot read fails', () => {
    const markup = render(null, { loadError: true })
    expect(markup).toContain('可以直接重试检查')
    expect(markup).toContain('>重试</button>')
  })
})
