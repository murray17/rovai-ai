/*
 * THESIS: One quiet, inspectable release check; no updater dashboard or installation wizard.
 * OWN-WORLD: Rovai's open Porcelain/Graphite settings plane, Steel action, aligned evidence rows.
 * STORY: Read the installed version, check once on demand, review the latest notes, open GitHub.
 * FIRST VIEWPORT: Borderless settings header, version row, then one update row with the sole primary action.
 * FORM: Established settings-surface extension; no concept seed. Key: about-updates-lightweight-release-check.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review and surface brief.
 */
import { useEffect, useState } from 'react'
import type {
  AppUpdateFailureReason,
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
  const [checking, setChecking] = useState(false)
  const [openingRelease, setOpeningRelease] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [openError, setOpenError] = useState(false)

  useEffect(() => {
    let active = true
    if (!resolvedApi) {
      setLoading(false)
      setLoadError(true)
      return () => { active = false }
    }
    void resolvedApi.get()
      .then((next) => {
        if (!active) return
        setSnapshot(next)
        setLoadError(false)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [resolvedApi])

  const checkForUpdates = async (): Promise<void> => {
    if (!resolvedApi || checking) return
    setChecking(true)
    setOpenError(false)
    try {
      setSnapshot(await resolvedApi.check())
      setLoadError(false)
    } catch {
      if (snapshot) {
        setSnapshot({
          ...snapshot,
          status: 'check_failed',
          checkedAt: new Date().toISOString(),
          failureReason: 'network',
          retryAt: null
        })
        setLoadError(false)
      } else {
        setLoadError(true)
      }
    } finally {
      setChecking(false)
    }
  }

  const openReleasePage = async (): Promise<void> => {
    if (!resolvedApi || openingRelease) return
    setOpeningRelease(true)
    setOpenError(false)
    try {
      if (!await resolvedApi.openReleasePage()) setOpenError(true)
    } catch {
      setOpenError(true)
    } finally {
      setOpeningRelease(false)
    }
  }

  return (
    <AboutUpdatesSettingsView
      snapshot={snapshot}
      canCheck={Boolean(resolvedApi)}
      loading={loading}
      checking={checking}
      openingRelease={openingRelease}
      loadError={loadError}
      openError={openError}
      onCheck={() => void checkForUpdates()}
      onOpenRelease={() => void openReleasePage()}
    />
  )
}

export function AboutUpdatesSettingsView({
  snapshot,
  canCheck,
  loading,
  checking,
  openingRelease,
  loadError,
  openError,
  onCheck,
  onOpenRelease
}: {
  snapshot: AppUpdateSnapshot | null
  canCheck: boolean
  loading: boolean
  checking: boolean
  openingRelease: boolean
  loadError: boolean
  openError: boolean
  onCheck(): void
  onOpenRelease(): void
}): React.JSX.Element {
  const status = updateStatus(snapshot, loading, loadError, checking, canCheck)
  const releaseVisible = Boolean(
    snapshot?.releasePageAvailable
    && snapshot.latestVersion
    && (snapshot.status === 'up_to_date' || snapshot.status === 'update_available')
  )

  return (
    <div className="about-updates-settings">
      <SettingsPageHeader
        eyebrow="Settings / About & Updates"
        title="关于与更新"
        description="查看当前版本，按需检查官方 GitHub Releases。"
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
            <div><h2 id="about-update-heading">更新</h2><p>手动检查</p></div>
          </div>
          <div className="about-update-body">
            <div className="about-update-control">
              <div>
                <strong>GitHub Releases</strong>
                <p>仅在你点击时读取一次公开 Release 信息；不会下载或安装内容。</p>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={!canCheck || (loading && !snapshot)}
                aria-disabled={checking || undefined}
                aria-busy={checking || undefined}
                aria-describedby="about-update-status"
                onClick={onCheck}
              >
                {checking && <span className="about-update-spinner" aria-hidden="true" />}
                {checking ? '正在检查…' : snapshot?.checkedAt ? '重新检查' : '检查更新'}
              </button>
            </div>

            <div
              id="about-update-status"
              className={`about-update-status is-${status.tone}`}
              role={status.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span className="about-update-status-mark" aria-hidden="true" />
              <div><strong>{status.title}</strong><p>{status.detail}</p></div>
            </div>

            {releaseVisible && snapshot && (
              <section className="about-release-notes" aria-labelledby="about-release-notes-heading">
                <div className="about-release-notes-heading">
                  <div>
                    <h3 id="about-release-notes-heading">Release Notes 摘要</h3>
                    <p>{snapshot.releaseName?.trim() || displayVersion(snapshot.latestVersion ?? '')}</p>
                  </div>
                  <span>{releaseMetadata(snapshot)}</span>
                </div>
                <p className="about-release-notes-copy">
                  {snapshot.releaseNotesSummary ?? '此版本没有提供可显示的 Release Notes 摘要。请前往 GitHub 查看完整内容。'}
                </p>
                <div className="about-release-notes-action">
                  <button
                    className="quiet-button compact"
                    type="button"
                    disabled={openingRelease}
                    onClick={onOpenRelease}
                  >
                    {openingRelease ? '正在打开…' : '在 GitHub 查看此 Release'}
                  </button>
                  {openError && <span role="alert">无法打开 GitHub Release，请稍后重试。</span>}
                </div>
              </section>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function updateStatus(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  loadError: boolean,
  checking: boolean,
  canCheck: boolean
): { tone: 'neutral' | 'success' | 'attention' | 'error'; title: string; detail: string } {
  if (loading) return { tone: 'neutral', title: '正在读取当前版本', detail: '更新检查尚未开始。' }
  if (checking) {
    return {
      tone: 'neutral',
      title: '正在检查官方 Release',
      detail: '完成后将显示当前版本与最新正式版本的比较结果。'
    }
  }
  if (loadError || !snapshot) {
    return {
      tone: 'error',
      title: '无法读取应用版本',
      detail: canCheck ? '可直接点击“检查更新”重试。' : '请重新打开此页面后再试。'
    }
  }
  switch (snapshot.status) {
    case 'idle':
      return {
        tone: 'neutral',
        title: '尚未检查更新',
        detail: '点击“检查更新”后才会连接 GitHub。'
      }
    case 'up_to_date':
      return {
        tone: 'success',
        title: '当前已是最新正式版本',
        detail: `已与官方 GitHub Releases 中的 ${displayVersion(snapshot.latestVersion ?? snapshot.currentVersion)} 完成比较。`
      }
    case 'update_available':
      return {
        tone: 'attention',
        title: `发现新版本 ${displayVersion(snapshot.latestVersion ?? '')}`,
        detail: '可先阅读下方摘要，再前往 GitHub Release 页面选择安装包。'
      }
    case 'no_release':
      return {
        tone: 'neutral',
        title: '暂未找到正式 Release',
        detail: '官方 GitHub Releases 目前没有可用于比较的正式版本。'
      }
    case 'check_failed':
      return failureStatus(snapshot.failureReason, snapshot.retryAt)
  }
}

function failureStatus(
  reason: AppUpdateFailureReason | null,
  retryAt: string | null
): { tone: 'error'; title: string; detail: string } {
  if (reason === 'rate_limited') {
    return {
      tone: 'error',
      title: 'GitHub 请求暂时受限',
      detail: retryAt
        ? `未使用 Token 的公开请求已达到限制，请在 ${formatTime(retryAt)} 后重试。`
        : '未使用 Token 的公开请求已达到限制，请稍后重试。'
    }
  }
  if (reason === 'invalid_release') {
    return {
      tone: 'error',
      title: 'Release 信息无法验证',
      detail: '返回的版本或下载页信息不符合 Rovai 的公开 Release 规则。'
    }
  }
  if (reason === 'github_unavailable') {
    return { tone: 'error', title: 'GitHub 暂时不可用', detail: '本次检查没有完成，请稍后重试。' }
  }
  return { tone: 'error', title: '无法连接 GitHub', detail: '请检查网络连接后重试。' }
}

function displayVersion(value: string): string {
  const trimmed = value.trim().replace(/^v/i, '')
  return trimmed ? `v${trimmed}` : '版本未知'
}

function releaseMetadata(snapshot: AppUpdateSnapshot): string {
  const version = displayVersion(snapshot.latestVersion ?? '')
  if (!snapshot.publishedAt) return version
  try {
    const date = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(snapshot.publishedAt))
    return `${version} · ${date}`
  } catch {
    return version
  }
}

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return '限制解除'
  }
}
