import { useEffect, useState } from 'react'
import type { AppUpdatePrompt as AppUpdatePromptValue, AppUpdateSnapshot } from '@contracts'

export function AppUpdatePrompt({
  snapshot,
  campComposerVisible,
  blocked,
  onDismiss,
  onOpenDetails,
  onDownload
}: {
  snapshot: AppUpdateSnapshot | null
  campComposerVisible: boolean
  blocked: boolean
  onDismiss(promptId: string): Promise<boolean>
  onOpenDetails(prompt: AppUpdatePromptValue): Promise<boolean>
  onDownload(): Promise<boolean>
}): React.JSX.Element {
  const [busy, setBusy] = useState<'dismiss' | 'details' | 'download' | null>(null)
  const [actionFailed, setActionFailed] = useState(false)
  const attentive = useWindowAttentive()
  const modalPresent = useModalPresent()
  const prompt = snapshot?.pendingPrompt ?? null
  const release = snapshot?.availableRelease ?? null
  const visible = Boolean(
    attentive
    && !blocked
    && !modalPresent
    && prompt
    && release
    && prompt.version === release.version
    && snapshot?.status === 'available'
  )

  useEffect(() => {
    setBusy(null)
    setActionFailed(false)
  }, [prompt?.id])

  if (!visible || !prompt || !release || !snapshot) return <></>

  const run = async (
    kind: 'dismiss' | 'details' | 'download',
    action: () => Promise<boolean>
  ): Promise<void> => {
    if (busy) return
    setBusy(kind)
    setActionFailed(false)
    const accepted = await action()
    if (!accepted) {
      setActionFailed(true)
      setBusy(null)
    }
  }

  return (
    <aside
      className={`app-update-prompt ${campComposerVisible ? 'is-above-composer' : ''}`}
      aria-live="polite"
      aria-label="Rovai AI 应用更新提醒"
    >
      <div className="app-update-prompt-copy">
        <strong>Rovai AI v{release.version} 可用</strong>
        <span>当前版本 v{snapshot.currentVersion}</span>
        {actionFailed && <small role="alert">操作未完成，更新提醒仍然保留。</small>}
      </div>
      <button
        className="app-update-prompt-close"
        type="button"
        aria-label="稍后处理本次更新提醒"
        disabled={busy !== null}
        onClick={() => void run('dismiss', () => onDismiss(prompt.id))}
      >
        <CloseIcon />
      </button>
      <div className="app-update-prompt-actions">
        <button
          className="quiet-button compact"
          type="button"
          disabled={busy !== null}
          onClick={() => void run('dismiss', () => onDismiss(prompt.id))}
        >稍后</button>
        <button
          className="quiet-button compact"
          type="button"
          disabled={busy !== null}
          onClick={() => void run('details', () => onOpenDetails(prompt))}
        >{busy === 'details' ? '正在打开…' : '查看更新内容'}</button>
        <button
          className="primary-button compact"
          type="button"
          aria-busy={busy === 'download' || undefined}
          disabled={busy !== null}
          onClick={() => void run('download', onDownload)}
        >{busy === 'download' ? '正在开始…' : '下载更新'}</button>
      </div>
    </aside>
  )
}

function useWindowAttentive(): boolean {
  const read = (): boolean => typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && document.hasFocus()
  const [attentive, setAttentive] = useState(read)
  useEffect(() => {
    const update = (): void => setAttentive(read())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return attentive
}

function useModalPresent(): boolean {
  const read = (): boolean => typeof document !== 'undefined'
    && document.querySelector('.dialog-overlay, [role="dialog"][aria-modal="true"]') !== null
  const [present, setPresent] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setPresent(read()))
    observer.observe(document.body, { childList: true, subtree: true })
    setPresent(read())
    return () => observer.disconnect()
  }, [])
  return present
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}
