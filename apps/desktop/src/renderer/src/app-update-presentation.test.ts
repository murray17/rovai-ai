import { describe, expect, it } from 'vitest'
import type { AppUpdateSnapshot } from '@contracts'
import { appUpdateBadgePresentation } from './app-update-presentation'

function snapshot(overrides: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    currentVersion: '0.0.2',
    status: 'available',
    availableRelease: {
      version: '0.0.3',
      releaseName: null,
      releaseDate: null,
      releaseNotes: null
    },
    lastCheckSource: 'startup',
    checkedAt: '2026-08-24T08:00:00.000Z',
    lastSuccessfulCheckAt: '2026-08-24T08:00:01.000Z',
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    failureReason: null,
    pendingPrompt: { id: 'prompt-1', version: '0.0.3' },
    ...overrides
  }
}

describe('appUpdateBadgePresentation', () => {
  it.each([
    ['available', null, 'available', '更新可用'],
    ['checking', null, 'downloading', '检查中'],
    ['check_failed', 'network', 'failed', '检查失败'],
    ['downloading', null, 'downloading', '42%'],
    ['ready_to_install', null, 'ready', '可安装'],
    ['installing', null, 'installing', '重启中'],
    ['download_failed', 'download_failed', 'failed', '重试下载'],
    ['install_failed', 'install_failed', 'failed', '重试安装']
  ] as const)('maps %s to a distinct compact badge', (status, failureReason, kind, label) => {
    const presentation = appUpdateBadgePresentation(snapshot({
      status,
      failureReason,
      downloadPercent: status === 'downloading' ? 42 : null
    }))
    expect(presentation).toMatchObject({ kind, label })
    expect(presentation?.accessibleLabel).toContain('v0.0.3')
  })

  it('hides the badge when no actionable known release exists', () => {
    expect(appUpdateBadgePresentation(snapshot({ status: 'up_to_date', availableRelease: null }))).toBeNull()
    expect(appUpdateBadgePresentation(snapshot({ status: 'idle', availableRelease: null }))).toBeNull()
    expect(appUpdateBadgePresentation(null)).toBeNull()
  })
})
