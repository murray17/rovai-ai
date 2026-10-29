import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppUpdateRelease, AppUpdateSnapshot } from '@contracts'
import { currentReleaseFromBundledSources } from '../../shared/app-current-release'
import { displayReleaseNotes } from './release-notes-display'
import { SafeMarkdown } from './SafeMarkdown'
import { SettingsPageHeader } from './SettingsPageHeader'
import type { AppUpdateActionError, AppUpdatesController } from './useAppUpdates'
import { UiText, uiAttribute, useInterfaceLanguage } from './interface-language'

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
      onDismissPrompt={updates.dismissPrompt}
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
  onInstall,
  onDismissPrompt,
  product = 'desktop',
  readOnly = false
}: {
  snapshot: AppUpdateSnapshot | null
  canUpdate: boolean
  loading: boolean
  loadError: boolean
  actionError: AppUpdateActionError
  onCheck(): void
  onDownload(): void
  onInstall(): void
  onDismissPrompt?(promptId: string): Promise<boolean>
  product?: 'desktop' | 'server'
  readOnly?: boolean
}): React.JSX.Element {
  useInterfaceLanguage()
  const [showCurrentForVersion, setShowCurrentForVersion] = useState<string | null>(null)
  const availableTabRef = useRef<HTMLButtonElement>(null)
  const currentTabRef = useRef<HTMLButtonElement>(null)
  const presentation = product === 'server' && snapshot?.failureReason === 'restart_unconfirmed'
    ? { tone: 'error', title:uiAttribute("尚未确认 Server 恢复连接"), detail:uiAttribute("可以重试连接；如果持续无法连接，请检查运行 Server 的电脑。") }
    : updatePresentation(snapshot, loading, loadError, actionError, canUpdate)
  const primaryAction = updatePrimaryAction(snapshot, loading, canUpdate)
  const availableRelease = snapshot?.availableRelease ?? null
  const currentRelease = snapshot
    ? snapshot.currentRelease?.version === snapshot.currentVersion.replace(/^v/iu, '')
      ? snapshot.currentRelease
      : currentReleaseFromBundledSources(snapshot.currentVersion, null)
    : null
  const showCurrent = !availableRelease || showCurrentForVersion === availableRelease.version
  const release = showCurrent ? currentRelease : availableRelease
  const busy = isOperationBusy(snapshot?.status)
  const detail = presentation.tone !== 'error' && product === 'server' && snapshot?.status === 'installing'
    ? uiAttribute('Server 正在重启，页面会自动恢复连接。')
    : presentation.detail
  const downloading = snapshot?.status === 'downloading'
  const progress = downloading ? snapshot.downloadPercent ?? 0 : 0
  const showManualCheck = snapshot?.status === 'available' || snapshot?.status === 'download_failed'
  const showFallback = snapshot?.status === 'download_failed'
    || (snapshot?.status === 'check_failed' && snapshot.failureReason === 'updater_unavailable')
  const officialReleasesUrl = product === 'server'
    ? availableRelease
      ? `https://github.com/murray17/rovai-ai/releases/tag/${['0.4.0', '0.4.1'].includes(availableRelease.version) ? 'server-v' : 'v'}${encodeURIComponent(availableRelease.version)}`
      : 'https://github.com/murray17/rovai-ai/releases'
    : 'https://github.com/murray17/rovai-ai/releases/latest'

  useEffect(() => {
    setShowCurrentForVersion(null)
  }, [availableRelease?.version])

  useEffect(() => {
    const prompt = snapshot?.pendingPrompt
    if (!prompt || !onDismissPrompt || showCurrent || availableRelease?.version !== prompt.version) return undefined
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const section = document.querySelector<HTMLElement>('.about-release-section')
        if (section?.dataset.appUpdateReleaseVersion === prompt.version) {
          void onDismissPrompt(prompt.id)
        }
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [snapshot?.pendingPrompt?.id, availableRelease?.version, showCurrent, onDismissPrompt])

  const selectRelease = (target: 'available' | 'current'): void => {
    if (!availableRelease) return
    setShowCurrentForVersion(target === 'current' ? availableRelease.version : null)
    const tabRef = target === 'current' ? currentTabRef : availableTabRef
    tabRef.current?.focus()
  }

  const onReleaseTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    target: 'available' | 'current'
  ): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectRelease(target === 'available' ? 'current' : 'available')
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      selectRelease(event.key === 'Home' ? 'available' : 'current')
    }
  }

  const runPrimary = (): void => {
    if (primaryAction.kind === 'download') onDownload()
    else if (primaryAction.kind === 'install') onInstall()
    else onCheck()
  }

  return (
    <div className="about-updates-settings" data-update-read-only={readOnly}>
      <SettingsPageHeader
        eyebrow="Settings / About & Updates"
        title={uiAttribute("关于与更新")}
        description={readOnly ? uiAttribute("版本信息与更新日志。") : uiAttribute("自动检查新版本，下载与安装由你决定。")}
      />

      <div className="about-updates-body">
        <section className="about-updates-overview" aria-label={uiAttribute("版本与更新")}>
          <div className="about-updates-topline">
            <div className="about-identity">
              <svg className="about-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L13.16 7.3 L17.76 8.84 L13.16 10.38 L12 15.68 L10.84 10.38 L6.24 8.84 L10.84 7.3 Z" fill="currentColor"/><path d="M3 20.96 Q12 15.96 21 20.96" fill="none" stroke="currentColor" strokeWidth="2.08" strokeLinecap="round"/><circle className="brand-rendezvous-point" data-brand-point="rendezvous" cx="12" cy="18.46" r="1.05" fill="currentColor"/></svg>
              <div>
                <strong>Rovai AI{product === 'server' ? ' Server' : ''}</strong>
                <p><UiText zh={"当前版本 "} /><span data-installed-version>{snapshot ? displayVersion(snapshot.currentVersion) : loading ? uiAttribute("读取中…") : uiAttribute("暂不可用")}</span></p>
              </div>
            </div>
            {!readOnly && <div className="about-update-actions">
              {showManualCheck && (
                <button className="quiet-button" type="button" disabled={!canUpdate || busy} onClick={onCheck}>
                  <UiText zh={"重新检查"} />
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={primaryAction.disabled}
                aria-busy={busy || undefined}
                aria-describedby="about-update-status"
                onClick={runPrimary}
              >
                {busy && <span className="about-update-spinner" aria-hidden="true" />}
                {primaryAction.label}
              </button>
            </div>}
          </div>

          {!readOnly && <>
            <div
              id="about-update-status"
              className={`about-update-status is-${presentation.tone}`}
              data-update-status={snapshot?.status ?? 'unavailable'}
              role={presentation.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              aria-atomic="true"
            >
              <UpdateStatusIcon tone={presentation.tone} busy={busy} />
              <div><strong>{presentation.title}</strong>{detail && <p>{detail}</p>}</div>
            </div>
            {downloading && (
              <div className="about-download-progress" aria-label={uiAttribute("更新下载进度")}>
                <div className="about-download-progress-heading">
                  <span>{formatTransfer(snapshot.transferredBytes, snapshot.totalBytes)}</span>
                  <strong>{formatPercent(progress)}</strong>
                </div>
                <progress max="100" value={progress} aria-label={uiAttribute("已下载 {0}", formatPercent(progress))} />
                <span className="about-download-speed">{formatSpeed(snapshot.bytesPerSecond)}</span>
              </div>
            )}
            {showFallback && (
              <div className="about-update-fallback">
                <a href={officialReleasesUrl} target="_blank" rel="noreferrer noopener"><UiText zh={"官方 Releases"} /></a>
                <a href="https://github.com/murray17/rovai-ai/issues" target="_blank" rel="noreferrer noopener"><UiText zh={"获取支持"} /></a>
              </div>
            )}
          </>}
        </section>

        {release && (
          <section
            className="about-release-section"
            aria-labelledby="about-release-notes-heading"
            data-app-update-release-version={release.version}
          >
            <div className="section-heading about-release-heading">
              <h2 id="about-release-notes-heading" tabIndex={-1}><UiText zh={"更新日志"} /></h2>
              {availableRelease ? <div className="about-release-tabs" role="tablist" aria-label={uiAttribute("日志版本")}>
                <button ref={availableTabRef} type="button" role="tab" id="about-release-tab-available"
                  aria-controls="about-release-panel-available" aria-selected={!showCurrent} tabIndex={showCurrent ? -1 : 0}
                  data-app-update-release-tab="available"
                  onClick={() => selectRelease('available')}
                  onKeyDown={(event) => onReleaseTabKeyDown(event, 'available')}>
                  <UiText zh={"新版本"} /> <span>{displayVersion(availableRelease.version)}</span>
                </button>
                <button ref={currentTabRef} type="button" role="tab" id="about-release-tab-current"
                  aria-controls="about-release-panel-current" aria-selected={showCurrent} tabIndex={showCurrent ? 0 : -1}
                  data-app-update-release-tab="current"
                  onClick={() => selectRelease('current')}
                  onKeyDown={(event) => onReleaseTabKeyDown(event, 'current')}>
                  <UiText zh={"当前版本"} /> <span>{displayVersion(currentRelease?.version ?? snapshot?.currentVersion ?? '')}</span>
                </button>
              </div> : <span className="about-release-version">{displayVersion(release.version)}</span>}
            </div>
            {availableRelease && currentRelease ? <>
              <div id="about-release-panel-available" role="tabpanel" aria-labelledby="about-release-tab-available"
                className="about-release-panel" hidden={showCurrent}>
                <ReleaseNotesBody release={availableRelease} installed={false} />
              </div>
              <div id="about-release-panel-current" role="tabpanel" aria-labelledby="about-release-tab-current"
                className="about-release-panel" hidden={!showCurrent}>
                <ReleaseNotesBody release={currentRelease} installed />
              </div>
            </> : <ReleaseNotesBody release={release} installed={showCurrent} />}
          </section>
        )}

        {!readOnly && snapshot && (snapshot.checkedAt || snapshot.lastSuccessfulCheckAt) && (
          <details className="settings-disclosure about-history">
            <summary><span><UiText zh={"检查记录"} /></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></summary>
            <dl className="about-facts" aria-label={uiAttribute("更新检查记录")}>
              <div><dt><UiText zh={"本次检查"} /></dt><dd>{formatCheckAttempt(snapshot)}</dd></div>
              <div><dt><UiText zh={"上次成功"} /></dt><dd>{formatTimestamp(snapshot.lastSuccessfulCheckAt)}</dd></div>
              <div><dt><UiText zh={"更新来源"} /></dt><dd><UiText zh={"Rovai AI 正式 GitHub Releases"} /></dd></div>
            </dl>
          </details>
        )}
      </div>
    </div>
  )
}

function ReleaseNotesBody({ release, installed }: {
  release: AppUpdateRelease
  installed: boolean
}): React.JSX.Element {
  const language = useInterfaceLanguage()
  const notes = useMemo(
    () => displayReleaseNotes(release, language),
    [release.version, release.releaseName, release.releaseNotes, language]
  )
  return <div className="about-release-body" data-notes-version={release.version}>
    <div className="about-release-header">
      <p>{release.releaseDate
        ? <><UiText zh={"发布日期："} /><time dateTime={release.releaseDate}>{formatReleaseDate(release.releaseDate)}</time></>
        : uiAttribute("发布日期暂未提供")}</p>
    </div>
    {notes
      ? <SafeMarkdown className="about-release-notes">{notes}</SafeMarkdown>
      : <p className="about-release-empty">{installed
        ? uiAttribute("此版本暂无内置更新日志。")
        : uiAttribute("此版本没有提供更新日志。版本号与下载操作仍以正式发布信息为准。")}</p>}
  </div>
}

function updatePrimaryAction(
  snapshot: AppUpdateSnapshot | null,
  loading: boolean,
  canUpdate: boolean
): { kind: 'check' | 'download' | 'install'; label: string; disabled: boolean } {
  if (loading) return { kind: 'check', label:uiAttribute("读取中…"), disabled: true }
  if (!snapshot) return { kind: 'check', label:uiAttribute("重试"), disabled: !canUpdate }
  if (snapshot.failureReason === 'restart_unconfirmed') return { kind: 'check', label:uiAttribute("重试连接"), disabled: !canUpdate }
  switch (snapshot.status) {
    case 'checking':
      return { kind: 'check', label:uiAttribute("正在检查…"), disabled: true }
    case 'available':
      return { kind: 'download', label:uiAttribute("下载更新"), disabled: !canUpdate }
    case 'downloading':
      return {
        kind: 'download',
        label: uiAttribute("下载中…"),
        disabled: true
      }
    case 'ready_to_install':
      return { kind: 'install', label:uiAttribute("安装并重启"), disabled: !canUpdate }
    case 'installing':
      return { kind: 'install', label:uiAttribute("正在安装…"), disabled: true }
    case 'install_failed':
      return { kind: 'install', label:uiAttribute("重试安装"), disabled: !canUpdate }
    case 'download_failed':
      return { kind: 'download', label:uiAttribute("重试下载"), disabled: !canUpdate }
    case 'up_to_date':
      return { kind: 'check', label:uiAttribute("重新检查"), disabled: !canUpdate }
    case 'check_failed':
      return { kind: 'check', label:uiAttribute("重新检查"), disabled: !canUpdate }
    case 'idle':
      return { kind: 'check', label:uiAttribute("检查更新"), disabled: !canUpdate }
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
    tone: 'neutral', pageLabel:uiAttribute("读取中"), title:uiAttribute("正在读取当前版本"), detail:uiAttribute("更新检查尚未开始。")
  }
  if (loadError || !snapshot) return {
    tone: 'error',
    pageLabel:uiAttribute("读取失败"),
    title:uiAttribute("无法读取更新状态"),
    detail: canUpdate ?uiAttribute("可以直接重试检查。") :uiAttribute("请重新打开此页面后再试。")
  }
  if (actionError) return {
    tone: 'error',
    pageLabel:uiAttribute("操作未完成"),
    title: actionError === 'download'
      ?uiAttribute("下载请求未完成")
      : actionError === 'install'
        ?uiAttribute("安装请求未完成")
        :uiAttribute("更新操作未完成"),
    detail:uiAttribute("已知版本信息和当前 App 状态没有被清除，请重试。")
  }
  switch (snapshot.status) {
    case 'idle':
      return {
        tone: 'neutral', pageLabel:uiAttribute("尚未检查"), title:uiAttribute("尚未检查更新"),
        detail: ''
      }
    case 'checking':
      return {
        tone: 'info', pageLabel:uiAttribute("检查中"), title: snapshot.availableRelease
          ? uiAttribute("正在检查更新 · 已知 {0}", displayRelease(snapshot))
          : uiAttribute("正在检查更新"),
        detail: ''
      }
    case 'available':
      return {
        tone: 'attention', pageLabel:uiAttribute("更新可用"), title: uiAttribute("新版本 {0} 可用", displayRelease(snapshot)),
        detail: ''
      }
    case 'downloading':
      return {
        tone: 'info', pageLabel:uiAttribute("下载中"), title: uiAttribute("正在下载 {0}", String(displayRelease(snapshot))),
        detail: ''
      }
    case 'ready_to_install':
      return {
        tone: 'success', pageLabel:uiAttribute("可安装"), title: uiAttribute("{0} 已下载", displayRelease(snapshot)),
        detail: ''
      }
    case 'installing':
      return {
        tone: 'info', pageLabel:uiAttribute("正在重启"), title:uiAttribute("正在准备安装更新"),
        detail:uiAttribute("正在结束当前执行，随后安装并重新启动。")
      }
    case 'up_to_date':
      return {
        tone: 'success', pageLabel:uiAttribute("已是最新"), title:uiAttribute("当前已是最新版本"),
        detail: ''
      }
    case 'check_failed':
      return checkFailure(snapshot)
    case 'download_failed':
      return {
        tone: 'error', pageLabel:uiAttribute("下载失败"), title:uiAttribute("更新下载中断"),
        detail:uiAttribute("已知的新版本信息仍然保留；可以直接重试下载。")
      }
    case 'install_failed':
      return {
        tone: 'error', pageLabel:uiAttribute("安装失败"), title:uiAttribute("更新未能开始安装"),
        detail:uiAttribute("当前应用仍可使用，可重试安装。")
      }
  }
}

function checkFailure(snapshot: AppUpdateSnapshot): {
  tone: 'error'
  pageLabel: string
  title: string
  detail: string
} {
  if (snapshot.failureReason === 'release_unpublished') return {
    tone: 'error', pageLabel:uiAttribute("尚未发布"), title:uiAttribute("尚无正式 Server 更新"),
    detail:uiAttribute("Server 发布通道尚未提供安装包，发布后可重新检查。")
  }
  if (snapshot.failureReason === 'install_failed') return {
    tone: 'error', pageLabel:uiAttribute("安装未完成"), title:uiAttribute("上次更新未完成"),
    detail: uiAttribute("当前仍运行 {0}，可以重新检查更新。", String(displayVersion(snapshot.currentVersion)))
  }
  const retained = snapshot.availableRelease
    ? uiAttribute(" 已知的 {0} 信息仍然保留。", String(displayRelease(snapshot)))
    : ''
  if (snapshot.failureReason === 'network') {
    return {
      tone: 'error', pageLabel:uiAttribute("检查失败"), title:uiAttribute("无法连接更新服务"),
      detail: uiAttribute("请检查网络连接后重试。{0}", String(retained)).trim()
    }
  }
  if (snapshot.failureReason === 'invalid_release') {
    return {
      tone: 'error', pageLabel:uiAttribute("信息无效"), title:uiAttribute("发布信息暂不可用"),
      detail: uiAttribute("请稍后重新检查；Rovai AI 不会引导安装未经验证的包。{0}", String(retained)).trim()
    }
  }
  return {
    tone: 'error', pageLabel:uiAttribute("自动更新不可用"), title:uiAttribute("此版本无法使用自动更新"),
    detail: uiAttribute("可以从官方 Releases 手动获取更新。{0}", String(retained)).trim()
  }
}

function UpdateStatusIcon({ tone, busy }: { tone: string; busy: boolean }): React.JSX.Element {
  return <svg className="about-update-status-icon" viewBox="0 0 16 16" aria-hidden="true">
    {tone === 'error' ? <path d="M8 2 14 13H2ZM8 6v3m0 2h.01" />
      : tone === 'success' ? <path d="m3 8 3 3 7-7" />
        : busy ? <path d="M8 2a6 6 0 1 1-5.2 3M2 2v4h4" />
          : tone === 'attention' ? <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" />
            : <><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1" /></>}
  </svg>
}

function displayRelease(snapshot: AppUpdateSnapshot): string {
  return displayVersion(snapshot.availableRelease?.version ?? '')
}

function displayVersion(value: string): string {
  const trimmed = value.trim().replace(/^v/i, '')
  return trimmed ? `v${trimmed}` : uiAttribute('新版本')
}

function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`
}

function formatTransfer(transferred: number | null, total: number | null): string {
  if (transferred === null && total === null) return uiAttribute("正在准备下载…")
  if (total === null) return uiAttribute("已下载 {0}", String(formatBytes(transferred ?? 0)))
  return `${formatBytes(transferred ?? 0)} / ${formatBytes(total)}`
}

function formatSpeed(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ?uiAttribute("速度计算中") : `${formatBytes(bytesPerSecond)}/s`
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
  if (!Number.isFinite(parsed.getTime())) return uiAttribute("日期暂不可用")
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric'
  }).format(parsed)
}

function formatTimestamp(value: string | null): string {
  if (!value) return uiAttribute("尚无")
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return uiAttribute("时间暂不可用")
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(parsed)
}

function formatCheckAttempt(snapshot: AppUpdateSnapshot): string {
  const source = snapshot.lastCheckSource === 'startup'
    ?uiAttribute("启动自动")
    : snapshot.lastCheckSource === 'interval'
      ?uiAttribute("定时自动")
      : snapshot.lastCheckSource === 'manual'
        ?uiAttribute("手动")
        :uiAttribute("来源未知")
  return `${formatTimestamp(snapshot.checkedAt)} · ${source}`
}

function isOperationBusy(status: AppUpdateSnapshot['status'] | undefined): boolean {
  return status === 'checking' || status === 'downloading' || status === 'installing'
}
