import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AppUpdateRelease, AppUpdateSnapshot } from '@contracts'
import { AboutUpdatesSettingsView } from './AboutUpdatesSettings'
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
} = {}): string {
  return renderToStaticMarkup(createElement(AboutUpdatesSettingsView, {
    snapshot: value,
    canUpdate: true,
    loading: options.loading ?? false,
    loadError: options.loadError ?? false,
    actionError: options.actionError ?? null,
    onCheck: () => undefined,
    onDownload: () => undefined,
    onInstall: () => undefined
  }))
}

describe('AboutUpdatesSettingsView', () => {
  it('always shows the installed version and keeps all update mutations user initiated', () => {
    const markup = render(snapshot())
    expect(markup).toContain('<h1>关于与更新</h1>')
    expect(markup).toContain('<code>v0.0.2</code>')
    expect(markup).toContain('>检查更新</button>')
    expect(markup).toContain('下载、安装和重启始终由你确认')
    expect(markup).not.toContain('更新日志</h2>')
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
    expect(markup).toContain('<progress max="100" value="42.3"')
    expect(markup).toContain('40.4 MB / 95.4 MB')
    expect(markup).toContain('4.8 MB/s')
    expect(markup).toContain('同一下载请求会自动合并')
  })

  it('offers installation only after the update is downloaded', () => {
    const ready = render(snapshot({ status: 'ready_to_install', availableRelease: release }))
    expect(ready).toContain('>安装并重启</button>')
    expect(ready).toContain('v0.0.3 已准备好')
    expect(ready).toContain('只有点击“安装并重启”后')
    expect(ready).not.toContain('<progress')

    const installing = render(snapshot({ status: 'installing', availableRelease: release }))
    expect(installing).toContain('正在安装…')
    expect(installing).toContain('受控关闭')
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
