import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppUpdateSnapshot } from '@contracts'
import { AboutUpdatesSettingsView } from './AboutUpdatesSettings'

function snapshot(overrides: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    currentVersion: '0.0.2',
    status: 'idle',
    latestVersion: null,
    checkedAt: null,
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    failureReason: null,
    ...overrides
  }
}

function render(value: AppUpdateSnapshot | null, options: {
  loading?: boolean
  loadError?: boolean
  actionError?: boolean
} = {}): string {
  return renderToStaticMarkup(createElement(AboutUpdatesSettingsView, {
    snapshot: value,
    canUpdate: true,
    loading: options.loading ?? false,
    loadError: options.loadError ?? false,
    actionError: options.actionError ?? false,
    onCheck: () => undefined,
    onInstall: () => undefined
  }))
}

describe('AboutUpdatesSettingsView', () => {
  it('shows the installed 0.0.2 version and the one-click update path', () => {
    const markup = render(snapshot())
    expect(markup).toContain('<h1>关于与更新</h1>')
    expect(markup).toContain('<code>v0.0.2</code>')
    expect(markup).toContain('>检查更新</button>')
    expect(markup).toContain('检查到新版本后会立即下载')
    expect(markup).toContain('正式更新来自 Rovai AI 的 GitHub Release')
    expect(markup).not.toContain('Release Notes 摘要')
    expect(markup).not.toContain('在 GitHub 查看')
  })

  it('keeps the check action visibly busy while checking', () => {
    const markup = render(snapshot({
      status: 'checking',
      checkedAt: '2026-08-24T08:00:00.000Z'
    }))
    expect(markup).toContain('disabled="" aria-busy="true"')
    expect(markup).toContain('正在检查…')
    expect(markup).toContain('正在确认是否有可用的新版本')
  })

  it('shows stable download progress and transfer detail', () => {
    const markup = render(snapshot({
      status: 'downloading',
      latestVersion: '0.0.3',
      checkedAt: '2026-08-24T08:00:00.000Z',
      downloadPercent: 42.3,
      transferredBytes: 42_340_000,
      totalBytes: 100_000_000,
      bytesPerSecond: 5_000_000
    }))
    expect(markup).toContain('正在下载 42%')
    expect(markup).toContain('<progress max="100" value="42.3"')
    expect(markup).toContain('40.4 MB / 95.4 MB')
    expect(markup).toContain('4.8 MB/s')
    expect(markup).toContain('下载期间可以继续使用 Rovai AI')
  })

  it('offers installation only after the update is downloaded', () => {
    const markup = render(snapshot({
      status: 'ready_to_install',
      latestVersion: '0.0.3',
      checkedAt: '2026-08-24T08:00:00.000Z',
      downloadPercent: 100,
      transferredBytes: 100_000_000,
      totalBytes: 100_000_000
    }))
    expect(markup).toContain('>安装并重启</button>')
    expect(markup).toContain('v0.0.3 已准备好')
    expect(markup).toContain('安装后 Rovai AI 会自动重新打开')
    expect(markup).not.toContain('<progress')
  })

  it('keeps current and failure outcomes recoverable', () => {
    const current = render(snapshot({
      status: 'up_to_date',
      latestVersion: '0.0.2',
      checkedAt: '2026-08-24T08:00:00.000Z'
    }))
    expect(current).toContain('当前已是最新版本')
    expect(current).toContain('>重新检查</button>')

    const failed = render(snapshot({
      status: 'download_failed',
      latestVersion: '0.0.3',
      checkedAt: '2026-08-24T08:00:00.000Z',
      failureReason: 'download_failed'
    }))
    expect(failed).toContain('更新下载中断')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('>重试</button>')

    const installFailed = render(snapshot({
      status: 'install_failed',
      latestVersion: '0.0.3',
      checkedAt: '2026-08-24T08:00:00.000Z',
      failureReason: 'install_failed'
    }))
    expect(installFailed).toContain('>重试安装</button>')
    expect(installFailed).toContain('已下载的更新仍然保留')
  })

  it('allows an in-page retry when the initial snapshot read fails', () => {
    const markup = render(null, { loadError: true })
    expect(markup).toContain('可以直接重试检查')
    expect(markup).toContain('>重试</button>')
  })
})
