import type { AppUpdateSnapshot } from '@contracts'
import { SafeMarkdown } from './SafeMarkdown'
import { SettingsPageHeader } from './SettingsPageHeader'
import type { AppUpdateActionError, AppUpdatesController } from './useAppUpdates'

export function AboutUpdatesSettings({
  updates
}: {
  updates: AppUpdatesController
}): React.JSX.Element {
  return (
    <AboutUpdatesSettingsView
      snapshot={updates.snapshot}
      canUpdate
      loading={updates.loading}
      loadError={updates.loadError}
      actionError={updates.actionError}
      onCheck={() => void updates.check()}
      onDownload={() => void updates.download()}
      onInstall={() => void updates.install()}
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
  onDownload,
  onInstall
}: {
  snapshot: AppUpdateSnapshot | null
  canUpdate: boolean
  loading: boolean
  loadError: boolean
  actionError: AppUpdateActionError
  onCheck(): void
  onDownload(): void
  onInstall(): void
}): React.JSX.Element {
  const presentation = updatePresentation(snapshot, loading, loadError, actionError, canUpdate)
  const primaryAction = updatePrimaryAction(snapshot, loading, canUpdate)
  const release = snapshot?.availableRelease ?? null
  const downloading = snapshot?.status === 'downloading'
  const progress = downloading ? snapshot.downloadPercent ?? 0 : 0
  const showManualCheck = snapshot?.status === 'available' || snapshot?.status === 'download_failed'
  const showFallback = snapshot?.status === 'download_failed'
    || (snapshot?.status === 'check_failed' && snapshot.failureReason === 'updater_unavailable')

  const runPrimary = (): void => {
    if (primaryAction.kind === 'download') onDownload()
    else if (primaryAction.kind === 'install') onInstall()
    else onCheck()
  }

  return (
    <div className="about-updates-settings">
      <SettingsPageHeader
        eyebrow="Settings / About & Updates"
        title="关于与更新"
        description="Rovai AI 会在正式打包版本中主动检查更新；下载、安装和重启始终由你确认。"
        aside={snapshot && (
          <span className={`about-update-page-state is-${presentation.tone}`}>
            <i aria-hidden="true" />{presentation.pageLabel}
          </span>
        )}
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
            <div><h2 id="about-update-heading">更新</h2><p>检查、下载与安装</p></div>
          </div>
          <div className="about-update-body">
            <div className="about-update-control">
              <div>
                <strong>{controlTitle(snapshot)}</strong>
                <p>{controlDetail(snapshot)}</p>
              </div>
              <div className="about-update-actions">
                {showManualCheck && (
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={!canUpdate || isOperationBusy(snapshot?.status)}
                    onClick={onCheck}
                  >重新检查</button>
                )}
                <button
                  className="primary-button"
                  type="button"
                  disabled={primaryAction.disabled}
                  aria-busy={isOperationBusy(snapshot?.status) || undefined}
                  aria-describedby="about-update-status"
                  onClick={runPrimary}
                >
                  {(snapshot?.status === 'checking'
                    || snapshot?.status === 'downloading'
                    || snapshot?.status === 'installing') && (
                    <span className="about-update-spinner" aria-hidden="true" />
                  )}
                  {primaryAction.label}
                </button>
              </div>
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
              tabIndex={-1}
            >
              <span className="about-update-status-mark" aria-hidden="true" />
              <div><strong>{presentation.title}</strong><p>{presentation.detail}</p></div>
            </div>

            {snapshot && (snapshot.checkedAt || snapshot.lastSuccessfulCheckAt) && (
              <div className="about-update-check-meta" aria-label="更新检查记录">
                <span>本次检查 <code>{formatCheckAttempt(snapshot)}</code></span>
                <span>上次成功 <code>{formatTimestamp(snapshot.lastSuccessfulCheckAt)}</code></span>
              </div>
            )}

            {showFallback && (
              <div className="about-update-fallback">
                <div>
                  <strong>{snapshot?.status === 'download_failed' ? '应用内下载未完成' : '此版本无法使用自动更新'}</strong>
                  <span>{snapshot?.status === 'download_failed'
                    ? '优先重试下载，也可以改用官方发布页。'
                    : '可以从官方发布页手动获取版本，或提交问题。'}</span>
                </div>
                <div className="about-update-fallback-actions">
                  <a href="https://github.com/murray17/rovai-ai/releases/latest" target="_blank" rel="noreferrer noopener">官方 Releases</a>
                  <a href="https://github.com/murray17/rovai-ai/issues" target="_blank" rel="noreferrer noopener">获取支持</a>
                </div>
              </div>
            )}

            <p className="about-update-source">自动更新来自 Rovai AI 的正式 GitHub Release 通道。</p>
          </div>
        </section>

        {release && (
          <section
            className="section-block about-updates-section about-release-section"
            aria-labelledby="about-release-notes-heading"
            data-app-update-release-version={release.version}
          >
            <div className="section-heading">
              <div>
                <h2 id="about-release-notes-heading" tabIndex={-1}>更新日志</h2>
                <p>最后一次有效发布信息</p>
              </div>
            </div>
            <div className="about-release-body">
              <div className="about-release-header">
                <div>
                  <h3>{release.releaseName ?? `Rovai AI ${displayVersion(release.version)}`}</h3>
                  <p>{release.releaseDate
                    ? <>发布日期：<time dateTime={release.releaseDate}>{formatReleaseDate(release.releaseDate)}</time></>
                    : '发布日期暂未提供'}</p>
                </div>
                <code>{displayVersion(release.version)}</code>
              </div>
              {release.releaseNotes
                ? <SafeMarkdown className="about-release-notes">{release.releaseNotes}</SafeMarkdown>
                : <p className="about-release-empty">此版本没有提供更新日志。版本号与下载操作仍以正式发布信息为准。</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function updatePrimaryAction(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  canUpdate: boolean
): { kind: 'check' | 'download' | 'install'; label: string; disabled: boolean } {
  if (loading) return { kind: 'check', label: '读取中…', disabled: true }
  if (!snapshot) return { kind: 'check', label: '重试', disabled: !canUpdate }
  switch (snapshot.status) {
    case 'checking':
      return { kind: 'check', label: '正在检查…', disabled: true }
    case 'available':
      return { kind: 'download', label: '下载更新', disabled: !canUpdate }
    case 'downloading':
      return {
        kind: 'download',
        label: `正在下载 ${formatPercent(snapshot.downloadPercent ?? 0)}`,
        disabled: true
      }
    case 'ready_to_install':
      return { kind: 'install', label: '安装并重启', disabled: !canUpdate }
    case 'installing':
      return { kind: 'install', label: '正在安装…', disabled: true }
    case 'install_failed':
      return { kind: 'install', label: '重试安装', disabled: !canUpdate }
    case 'download_failed':
      return { kind: 'download', label: '重试下载', disabled: !canUpdate }
    case 'up_to_date':
      return { kind: 'check', label: '重新检查', disabled: !canUpdate }
    case 'check_failed':
      return { kind: 'check', label: '重新检查', disabled: !canUpdate }
    case 'idle':
      return { kind: 'check', label: '检查更新', disabled: !canUpdate }
  }
}

function updatePresentation(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  loadError: boolean,
  actionError: AppUpdateActionError,
  canUpdate: boolean
): {
  tone: 'neutral' | 'info' | 'success' | 'attention' | 'error'
  pageLabel: string
  title: string
  detail: string
} {
  if (loading) return {
    tone: 'neutral', pageLabel: '读取中', title: '正在读取当前版本', detail: '更新检查尚未开始。'
  }
  if (loadError || !snapshot) return {
    tone: 'error',
    pageLabel: '读取失败',
    title: '无法读取更新状态',
    detail: canUpdate ? '可以直接重试检查。' : '请重新打开此页面后再试。'
  }
  if (actionError) return {
    tone: 'error',
    pageLabel: '操作未完成',
    title: actionError === 'download'
      ? '下载请求未完成'
      : actionError === 'install'
        ? '安装请求未完成'
        : '更新操作未完成',
    detail: '已知版本信息和当前 App 状态没有被清除，请重试。'
  }
  switch (snapshot.status) {
    case 'idle':
      return {
        tone: 'neutral', pageLabel: '尚未检查', title: '尚未检查更新',
        detail: '打开此页面不会触发下载。点击“检查更新”获取最新正式版本。'
      }
    case 'checking':
      return {
        tone: 'info', pageLabel: '检查中', title: snapshot.availableRelease ? '正在重新检查' : '正在检查更新',
        detail: snapshot.availableRelease
          ? '现有更新信息会保留到新的检查结果成功返回。'
          : '正在连接正式发布通道；不会自动开始下载。'
      }
    case 'available':
      return {
        tone: 'attention', pageLabel: '更新可用', title: '等待下载确认',
        detail: '自动检查只发现了新版本。只有你确认后才会开始下载。'
      }
    case 'downloading':
      return {
        tone: 'info', pageLabel: '下载中', title: `正在下载 ${displayRelease(snapshot)}`,
        detail: '同一下载请求会自动合并；下载期间可以继续使用 Rovai AI。'
      }
    case 'ready_to_install':
      return {
        tone: 'success', pageLabel: '可安装', title: `${displayRelease(snapshot)} 已准备好`,
        detail: '只有点击“安装并重启”后，才会进入受控退出与安装。'
      }
    case 'installing':
      return {
        tone: 'info', pageLabel: '正在重启', title: '正在准备安装更新',
        detail: 'Updater 已开始退出流程；Rovai 会先等待执行引擎完成受控关闭。'
      }
    case 'up_to_date':
      return {
        tone: 'success', pageLabel: '已是最新', title: '当前已是最新版本',
        detail: `${displayVersion(snapshot.currentVersion)} 已安装。需要时可以重新检查。`
      }
    case 'check_failed':
      return checkFailure(snapshot)
    case 'download_failed':
      return {
        tone: 'error', pageLabel: '下载失败', title: '更新下载中断',
        detail: '已知的新版本信息仍然保留；可以直接重试下载。'
      }
    case 'install_failed':
      return {
        tone: 'error', pageLabel: '安装失败', title: '更新未能开始安装',
        detail: 'Core 与当前 App 仍可继续使用，已下载的更新可以重试安装。'
      }
  }
}

function checkFailure(snapshot: AppUpdateSnapshot): {
  tone: 'error'
  pageLabel: string
  title: string
  detail: string
} {
  const retained = snapshot.availableRelease
    ? ` 已知的 ${displayRelease(snapshot)} 信息仍然保留。`
    : ''
  if (snapshot.failureReason === 'network') {
    return {
      tone: 'error', pageLabel: '检查失败', title: '无法连接更新服务',
      detail: `请检查网络连接后重试。${retained}`.trim()
    }
  }
  if (snapshot.failureReason === 'invalid_release') {
    return {
      tone: 'error', pageLabel: '信息无效', title: '发布信息暂不可用',
      detail: `请稍后重新检查；Rovai AI 不会引导安装未经验证的包。${retained}`.trim()
    }
  }
  return {
    tone: 'error', pageLabel: '自动更新不可用', title: '此版本无法使用自动更新',
    detail: `可以从官方 Releases 手动获取更新。${retained}`.trim()
  }
}

function controlTitle(snapshot: AppUpdateSnapshot | null): string {
  if (!snapshot) return 'Rovai AI 更新'
  if (snapshot.status === 'checking') return snapshot.availableRelease
    ? `正在重新检查 · 已知 ${displayRelease(snapshot)}`
    : '正在检查更新'
  if (snapshot.status === 'up_to_date') return 'Rovai AI 已是最新版本'
  if (snapshot.status === 'check_failed') return '本次检查未完成'
  return snapshot.availableRelease ? `Rovai AI ${displayRelease(snapshot)}` : 'Rovai AI 更新'
}

function controlDetail(snapshot: AppUpdateSnapshot | null): string {
  if (snapshot?.status === 'available') return '已找到新版本。只有点击“下载更新”后才会开始下载。'
  if (snapshot?.status === 'ready_to_install' || snapshot?.status === 'install_failed') {
    return '更新已下载完成，只有你确认后 Rovai AI 才会安装并重新打开。'
  }
  if (snapshot?.status === 'download_failed') return '下载没有完成；重试会继续使用同一个已知版本。'
  if (snapshot?.status === 'up_to_date') return '需要时可以重新检查正式发布通道。'
  if (snapshot?.status === 'checking') return '正在更新检查事实，不会自动开始下载。'
  if (snapshot?.status === 'installing') return '窗口即将关闭；安装前会完成受控退出。'
  return '主动检查只发现版本；下载、安装和重启始终需要你的确认。'
}

function displayRelease(snapshot: AppUpdateSnapshot): string {
  return displayVersion(snapshot.availableRelease?.version ?? '')
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

function formatReleaseDate(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '日期暂不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric'
  }).format(parsed)
}

function formatTimestamp(value: string | null): string {
  if (!value) return '尚无'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '时间暂不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(parsed)
}

function formatCheckAttempt(snapshot: AppUpdateSnapshot): string {
  const source = snapshot.lastCheckSource === 'startup'
    ? '启动自动'
    : snapshot.lastCheckSource === 'interval'
      ? '定时自动'
      : snapshot.lastCheckSource === 'manual'
        ? '手动'
        : '来源未知'
  return `${formatTimestamp(snapshot.checkedAt)} · ${source}`
}

function isOperationBusy(status: AppUpdateSnapshot['status'] | undefined): boolean {
  return status === 'checking' || status === 'downloading' || status === 'installing'
}
