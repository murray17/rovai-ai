/*
 * THESIS: One calm update surface: check once, download immediately, install when ready.
 * OWN-WORLD: Rovai's open Porcelain/Graphite settings plane, Steel action, aligned status rows.
 * STORY: Read the installed version, check on demand, keep progress visible, then install and restart.
 * FIRST VIEWPORT: Borderless settings header, installed version, update action, progress and recovery.
 */
import { useEffect, useState } from 'react'
import type {
  AppUpdateSnapshot,
  AppUpdatesApi
} from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

export function AboutUpdatesSettings({
  api
}: {
  api?: AppUpdatesApi
}): React.JSX.Element {
  const resolvedApi = api ?? (typeof window === 'undefined' ? null : window.rovai.appUpdates)
  const [snapshot, setSnapshot] = useState<AppUpdateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState(false)

  useEffect(() => {
    let active = true
    let receivedChange = false
    if (!resolvedApi) {
      setLoading(false)
      setLoadError(true)
      return () => { active = false }
    }
    const unsubscribe = resolvedApi.onChanged((next) => {
      if (!active) return
      receivedChange = true
      setSnapshot(next)
      setLoadError(false)
      setActionError(false)
    })
    void resolvedApi.get()
      .then((next) => {
        if (!active || receivedChange) return
        setSnapshot(next)
        setLoadError(false)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [resolvedApi])

  const checkForUpdates = async (): Promise<void> => {
    if (!resolvedApi || isBusy(snapshot?.status)) return
    setActionError(false)
    try {
      setSnapshot(await resolvedApi.check())
      setLoadError(false)
    } catch {
      setActionError(true)
    }
  }

  const installUpdate = async (): Promise<void> => {
    if (!resolvedApi || !snapshot || !canInstall(snapshot.status)) return
    setActionError(false)
    try {
      if (!await resolvedApi.install()) setActionError(true)
    } catch {
      setActionError(true)
    }
  }

  return (
    <AboutUpdatesSettingsView
      snapshot={snapshot}
      canUpdate={Boolean(resolvedApi)}
      loading={loading}
      loadError={loadError}
      actionError={actionError}
      onCheck={() => void checkForUpdates()}
      onInstall={() => void installUpdate()}
    />
  )
}

export function AboutUpdatesSettingsView({
  snapshot,
  canUpdate,
  loading,
  loadError,
  actionError,
  onCheck,
  onInstall
}: {
  snapshot: AppUpdateSnapshot | null
  canUpdate: boolean
  loading: boolean
  loadError: boolean
  actionError: boolean
  onCheck(): void
  onInstall(): void
}): React.JSX.Element {
  const presentation = updatePresentation(snapshot, loading, loadError, actionError, canUpdate)
  const action = updateAction(snapshot, loading, canUpdate)
  const downloading = snapshot?.status === 'downloading'
  const progress = downloading ? snapshot.downloadPercent ?? 0 : 0

  return (
    <div className="about-updates-settings">
      <SettingsPageHeader
        eyebrow="Settings / About & Updates"
        title="关于与更新"
        description="查看当前版本，检查并安装 Rovai AI 更新。"
      />

      <div className="about-updates-body">
        <section className="section-block about-updates-section" aria-labelledby="about-version-heading">
          <div className="section-heading">
            <div><h2 id="about-version-heading">版本</h2><p>当前安装</p></div>
          </div>
          <div className="about-version-row">
            <div className="about-product-name">
              <strong>Rovai AI</strong>
              <small>桌面应用</small>
            </div>
            <div className="about-version-value">
              <span>当前版本</span>
              <code>{snapshot ? displayVersion(snapshot.currentVersion) : loading ? '读取中…' : '暂不可用'}</code>
            </div>
          </div>
        </section>

        <section className="section-block about-updates-section" aria-labelledby="about-update-heading">
          <div className="section-heading">
            <div><h2 id="about-update-heading">更新</h2><p>一键升级</p></div>
          </div>
          <div className="about-update-body">
            <div className="about-update-control">
              <div>
                <strong>{controlTitle(snapshot)}</strong>
                <p>{controlDetail(snapshot)}</p>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={action.disabled}
                aria-busy={isBusy(snapshot?.status) || undefined}
                aria-describedby="about-update-status"
                onClick={action.kind === 'install' ? onInstall : onCheck}
              >
                {(snapshot?.status === 'checking' || snapshot?.status === 'installing') && (
                  <span className="about-update-spinner" aria-hidden="true" />
                )}
                {action.label}
              </button>
            </div>

            {downloading && (
              <div className="about-download-progress" aria-label="更新下载进度">
                <div className="about-download-progress-heading">
                  <span>下载进度</span>
                  <strong>{formatPercent(progress)}</strong>
                </div>
                <progress max="100" value={progress} aria-label={`已下载 ${formatPercent(progress)}`} />
                <div className="about-download-progress-meta">
                  <span>{formatTransfer(snapshot.transferredBytes, snapshot.totalBytes)}</span>
                  <span>{formatSpeed(snapshot.bytesPerSecond)}</span>
                </div>
              </div>
            )}

            <div
              id="about-update-status"
              className={`about-update-status is-${presentation.tone}`}
              role={presentation.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span className="about-update-status-mark" aria-hidden="true" />
              <div><strong>{presentation.title}</strong><p>{presentation.detail}</p></div>
            </div>
            <p className="about-update-source">正式更新来自 Rovai AI 的 GitHub Release。</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function updateAction(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  canUpdate: boolean
): { kind: 'check' | 'install'; label: string; disabled: boolean } {
  if (loading) return { kind: 'check', label: '读取中…', disabled: true }
  if (!snapshot) return { kind: 'check', label: '重试', disabled: !canUpdate }
  switch (snapshot.status) {
    case 'checking':
      return { kind: 'check', label: '正在检查…', disabled: true }
    case 'downloading':
      return {
        kind: 'check',
        label: `正在下载 ${formatPercent(snapshot.downloadPercent ?? 0)}`,
        disabled: true
      }
    case 'ready_to_install':
      return { kind: 'install', label: '安装并重启', disabled: !canUpdate }
    case 'installing':
      return { kind: 'install', label: '正在安装…', disabled: true }
    case 'install_failed':
      return { kind: 'install', label: '重试安装', disabled: !canUpdate }
    case 'up_to_date':
      return { kind: 'check', label: '重新检查', disabled: !canUpdate }
    case 'check_failed':
    case 'download_failed':
      return { kind: 'check', label: '重试', disabled: !canUpdate }
    case 'idle':
      return { kind: 'check', label: '检查更新', disabled: !canUpdate }
  }
}

function updatePresentation(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  loadError: boolean,
  actionError: boolean,
  canUpdate: boolean
): { tone: 'neutral' | 'success' | 'attention' | 'error'; title: string; detail: string } {
  if (loading) return { tone: 'neutral', title: '正在读取当前版本', detail: '更新检查尚未开始。' }
  if (loadError || !snapshot) {
    return {
      tone: 'error',
      title: '无法读取更新状态',
      detail: canUpdate ? '可以直接重试检查。' : '请重新打开此页面后再试。'
    }
  }
  if (actionError) {
    return { tone: 'error', title: '更新操作未完成', detail: '当前版本没有变化，请重试。' }
  }
  switch (snapshot.status) {
    case 'idle':
      return {
        tone: 'neutral',
        title: '尚未检查更新',
        detail: '点击“检查更新”后会连接正式发布通道。'
      }
    case 'checking':
      return {
        tone: 'neutral',
        title: '正在检查更新',
        detail: '正在确认是否有可用的新版本。'
      }
    case 'downloading':
      return {
        tone: 'neutral',
        title: `正在下载 ${displayVersion(snapshot.latestVersion ?? '')}`,
        detail: '下载期间可以继续使用 Rovai AI。'
      }
    case 'ready_to_install':
      return {
        tone: 'success',
        title: `${displayVersion(snapshot.latestVersion ?? '')} 已准备好`,
        detail: '点击“安装并重启”即可完成更新。'
      }
    case 'installing':
      return {
        tone: 'neutral',
        title: '正在安装更新',
        detail: 'Rovai AI 将关闭并自动重新打开。'
      }
    case 'up_to_date':
      return {
        tone: 'success',
        title: '当前已是最新版本',
        detail: `${displayVersion(snapshot.currentVersion)} 已安装。`
      }
    case 'check_failed':
      return checkFailure(snapshot.failureReason)
    case 'download_failed':
      return {
        tone: 'error',
        title: '更新下载中断',
        detail: '当前版本没有变化，请检查网络后重试。'
      }
    case 'install_failed':
      return {
        tone: 'error',
        title: '更新未能开始安装',
        detail: '已下载的更新仍然保留，可以重试安装。'
      }
  }
}

function checkFailure(reason: AppUpdateSnapshot['failureReason']): {
  tone: 'error'
  title: string
  detail: string
} {
  if (reason === 'network') {
    return { tone: 'error', title: '无法连接更新服务', detail: '请检查网络连接后重试。' }
  }
  if (reason === 'invalid_release') {
    return { tone: 'error', title: '更新信息暂不可用', detail: '正式发布文件尚未准备完整，请稍后重试。' }
  }
  return { tone: 'error', title: '当前无法检查更新', detail: '请稍后重试。' }
}

function controlTitle(snapshot: AppUpdateSnapshot | null): string {
  if (!snapshot?.latestVersion) return 'Rovai AI 更新'
  if (snapshot.status === 'up_to_date') return 'Rovai AI 已是最新版本'
  return `Rovai AI ${displayVersion(snapshot.latestVersion)}`
}

function controlDetail(snapshot: AppUpdateSnapshot | null): string {
  if (snapshot?.status === 'ready_to_install' || snapshot?.status === 'install_failed') {
    return '更新已下载完成，安装后 Rovai AI 会自动重新打开。'
  }
  if (snapshot?.status === 'up_to_date') return '需要时可以重新检查正式发布通道。'
  return '检查到新版本后会立即下载，并持续显示下载进度。'
}

function displayVersion(value: string): string {
  const trimmed = value.trim().replace(/^v/i, '')
  return trimmed ? `v${trimmed}` : '新版本'
}

function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`
}

function formatTransfer(transferred: number | null, total: number | null): string {
  if (transferred === null && total === null) return '正在准备下载…'
  if (total === null) return `已下载 ${formatBytes(transferred ?? 0)}`
  return `${formatBytes(transferred ?? 0)} / ${formatBytes(total)}`
}

function formatSpeed(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ? '速度计算中' : `${formatBytes(bytesPerSecond)}/s`
}

function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function isBusy(status: AppUpdateSnapshot['status'] | undefined): boolean {
  return status === 'checking' || status === 'downloading' || status === 'installing'
}

function canInstall(status: AppUpdateSnapshot['status']): boolean {
  return status === 'ready_to_install' || status === 'install_failed'
}
