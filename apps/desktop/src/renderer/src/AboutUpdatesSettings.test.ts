import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppUpdateSnapshot } from '@contracts'
import { AboutUpdatesSettingsView } from './AboutUpdatesSettings'

function snapshot(overrides: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    currentVersion: '0.0.1',
    status: 'idle',
    latestVersion: null,
    releaseName: null,
    releaseNotesSummary: null,
    publishedAt: null,
    releasePageAvailable: false,
    checkedAt: null,
    failureReason: null,
    retryAt: null,
    ...overrides
  }
}

function render(value: AppUpdateSnapshot | null, options: {
  loading?: boolean
  checking?: boolean
  loadError?: boolean
} = {}): string {
  return renderToStaticMarkup(createElement(AboutUpdatesSettingsView, {
    snapshot: value,
    canCheck: true,
    loading: options.loading ?? false,
    checking: options.checking ?? false,
    openingRelease: false,
    loadError: options.loadError ?? false,
    openError: false,
    onCheck: () => undefined,
    onOpenRelease: () => undefined
  }))
}

describe('AboutUpdatesSettingsView', () => {
  it('shows the installed version and a manual-only check action', () => {
    const markup = render(snapshot())
    expect(markup).toContain('<h1>关于与更新</h1>')
    expect(markup).toContain('<code>v0.0.1</code>')
    expect(markup).toContain('>检查更新</button>')
    expect(markup).toContain('点击“检查更新”后才会连接 GitHub')
    expect(markup).toContain('不会下载或安装内容')
    expect(markup).not.toContain('Release Notes 摘要')
  })

  it('presents an available release summary and its GitHub handoff', () => {
    const markup = render(snapshot({
      status: 'update_available',
      latestVersion: '0.2.0',
      releaseName: 'Rovai AI 0.2.0',
      releaseNotesSummary: '新增轻量更新入口。',
      publishedAt: '2026-08-22T09:30:00.000Z',
      releasePageAvailable: true,
      checkedAt: '2026-08-23T08:00:00.000Z'
    }))
    expect(markup).toContain('发现新版本 v0.2.0')
    expect(markup).toContain('Release Notes 摘要')
    expect(markup).toContain('新增轻量更新入口。')
    expect(markup).toContain('在 GitHub 查看此 Release')
    expect(markup).toContain('>重新检查</button>')
  })

  it('keeps no-release and rate-limit failures recoverable', () => {
    expect(render(snapshot({ status: 'no_release', checkedAt: '2026-08-23T08:00:00.000Z' })))
      .toContain('暂未找到正式 Release')
    const limited = render(snapshot({
      status: 'check_failed',
      checkedAt: '2026-08-23T08:00:00.000Z',
      failureReason: 'rate_limited',
      retryAt: '2026-08-23T09:00:00.000Z'
    }))
    expect(limited).toContain('GitHub 请求暂时受限')
    expect(limited).toContain('role="alert"')
    expect(limited).not.toContain('在 GitHub 查看此 Release')
  })

  it('disables duplicate checks while a request is running', () => {
    const markup = render(snapshot(), { checking: true })
    expect(markup).toContain('aria-disabled="true" aria-busy="true"')
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain('正在检查…')
    expect(markup).toContain('正在检查官方 Release')
    expect(markup).not.toContain('尚未检查更新')
  })

  it('allows an in-page retry when the initial version read fails', () => {
    const markup = render(null, { loadError: true })
    expect(markup).toContain('可直接点击“检查更新”重试')
    expect(markup).not.toContain('disabled=""')
  })
})
