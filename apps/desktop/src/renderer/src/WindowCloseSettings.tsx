import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { WindowCloseApi, WindowCloseBehavior, WindowCloseResponse, WindowCloseSnapshot } from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { useInterfaceLanguage } from './interface-language'
import './window-close.css'

function useCloseState(api: WindowCloseApi) {
  const [snapshot, setSnapshot] = useState<WindowCloseSnapshot | null>(null)
  const [transportError, setTransportError] = useState(false)
  const [pending, setPending] = useState(false)
  const accept = useCallback((next: WindowCloseSnapshot) => {
    setSnapshot(current => current && current.revision > next.revision ? current : next)
  }, [])
  const load = useCallback(async () => {
    setTransportError(false)
    try { accept(await api.get()) } catch { setTransportError(true) }
  }, [api, accept])
  useEffect(() => {
    let disposed = false
    const unsubscribe = api.onChanged(next => { if (!disposed) accept(next) })
    void api.get().then(next => { if (!disposed) accept(next) }).catch(() => { if (!disposed) setTransportError(true) })
    return () => { disposed = true; unsubscribe() }
  }, [api, accept])
  const run = async (operation: () => Promise<WindowCloseSnapshot>) => {
    setPending(true)
    setTransportError(false)
    try { accept(await operation()) } catch { setTransportError(true) } finally { setPending(false) }
  }
  return { snapshot, transportError, busy: pending || Boolean(snapshot?.busy), run, load }
}

function useCloseCopy() {
  const english = useInterfaceLanguage() === 'en'
  return (zh: string, en: string): string => english ? en : zh
}

function CloseError({ error, transport, prompt = false }: { error: WindowCloseSnapshot['error']; transport: boolean; prompt?: boolean }): React.JSX.Element | null {
  const text = useCloseCopy()
  const message = transport ? text('操作未完成，请重试。', 'The operation could not complete. Please retry.')
    : error === 'tray_unavailable' ? text('无法创建系统托盘图标，窗口保持打开。请重试或选择退出。', 'The tray icon could not be created. The window remains open. Retry or choose Quit.')
      : error === 'save_failed' ? (prompt
        ? text('未能保存关闭选项。请重试，或取消勾选后仅执行本次操作。', 'Could not save the close preference. Retry, or uncheck Remember for this time only.')
        : text('未能保存关闭选项，原选项仍然生效。请重试。', 'Could not save the close preference. Your previous choice is still active. Please retry.'))
        : error === 'quit_failed' ? text('退出准备未完成，窗口已保留。请重试。', 'Quit preparation failed. Your window is still open. Please retry.')
          : error === 'load_failed' ? text('未能读取关闭选项，暂时每次询问。可重新选择并保存。', 'Could not read the close preference. Asking each time until you save a new choice.') : null
  return message ? <p className="general-inline-status is-error" role="alert">{message}</p> : null
}

export function WindowCloseSettings({ api }: { api: WindowCloseApi }): React.JSX.Element {
  const { snapshot, transportError, busy, run, load } = useCloseState(api)
  const text = useCloseCopy()
  const [retryBehavior, setRetryBehavior] = useState<WindowCloseBehavior | null>(null)
  const change = (behavior: WindowCloseBehavior) => {
    setRetryBehavior(behavior)
    void run(() => api.setBehavior(behavior))
  }
  return <div className="general-section-body window-close-setting">
    <label className="general-world-map-setting" htmlFor="window-close-behavior">
      <span>
        <strong>{text('窗口关闭行为', 'When closing the window')}</strong>
        <small id="window-close-description">{snapshot?.behavior === 'tray'
          ? text('关闭窗口后后台任务继续运行，可从系统托盘重新打开或退出。', 'Background tasks keep running. Reopen or quit from the system tray.')
          : snapshot?.behavior === 'exit'
            ? text('关闭窗口时执行正常退出，完成保存和清理。', 'Save and clean up before quitting the app.')
            : text('每次关闭窗口时，选择最小化到托盘或退出应用。', 'Choose whether to minimize to the tray or quit each time.')}</small>
      </span>
      <select id="window-close-behavior" aria-describedby="window-close-description" value={snapshot?.behavior ?? 'ask'}
        disabled={!snapshot || busy || snapshot.promptId !== null} onChange={event => change(event.target.value as WindowCloseBehavior)}>
        <option value="ask">{text('每次询问', 'Ask every time')}</option>
        <option value="tray">{text('最小化到系统托盘', 'Minimize to system tray')}</option>
        <option value="exit">{text('退出 Rovai', 'Quit Rovai')}</option>
      </select>
    </label>
    {busy && <p className="general-inline-status" role="status">{text('正在保存…', 'Saving…')}</p>}
    <CloseError error={snapshot?.error ?? null} transport={transportError} />
    {(transportError || snapshot?.error) && <button className="quiet-button compact" type="button" disabled={busy}
      onClick={() => retryBehavior ? change(retryBehavior) : void load()}>{text('重试', 'Retry')}</button>}
  </div>
}

export function WindowCloseDialog({ api }: { api: WindowCloseApi }): React.JSX.Element | null {
  const { snapshot, transportError, busy, run } = useCloseState(api)
  if (!snapshot || snapshot.promptId === null) return null
  return <ClosePrompt key={snapshot.promptId} snapshot={snapshot} transportError={transportError} busy={busy}
    respond={response => { void run(() => api.respond(response)) }} />
}

function ClosePrompt({ snapshot, transportError, busy, respond }: {
  snapshot: WindowCloseSnapshot
  transportError: boolean
  busy: boolean
  respond(response: WindowCloseResponse): void
}): React.JSX.Element {
  const text = useCloseCopy()
  const [remember, setRemember] = useState(false)
  const previousFocus = useRef(document.activeElement)
  const choose = (action: WindowCloseResponse['action']) => {
    if (!busy) respond({ promptId: snapshot.promptId!, action, remember })
  }
  return <Dialog.Root open onOpenChange={open => { if (!open) choose('cancel') }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
      <AppDialogContent className="window-close-dialog" tone="neutral" aria-describedby="window-close-dialog-description"
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus({ preventScroll: true })
        }}>
        <AppDialogHeader title={text('关闭窗口', 'Close window')}
          description={text('最小化到系统托盘后，后台任务会继续运行。', 'Background tasks keep running when minimized to the system tray.')}
          descriptionId="window-close-dialog-description" closeLabel={text('取消关闭', 'Cancel closing')} closeDisabled={busy} />
        <AppDialogBody>
          <label className="window-close-remember">
            <input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} />
            {text('记住我的选择', 'Remember my choice')}
          </label>
          <p className="window-close-hint">{text('可在「设置 → 通用 → 窗口」中修改。', 'Change this in Settings → General → Window.')}</p>
          <CloseError error={snapshot.error} transport={transportError} prompt />
        </AppDialogBody>
        <AppDialogFooter leading={<button type="button" className="quiet-button" data-dialog-autofocus disabled={busy}
          onClick={() => choose('cancel')}>{text('取消', 'Cancel')}</button>}>
          <button type="button" className="quiet-button" disabled={busy} onClick={() => choose('exit')}>{text('退出 Rovai', 'Quit Rovai')}</button>
          <button type="button" className="primary-button" disabled={busy} onClick={() => choose('tray')}>{busy ? text('正在处理…', 'Working…') : text('最小化到托盘', 'Minimize to tray')}</button>
        </AppDialogFooter>
        {busy && <p className="sr-only" role="status">{text('正在处理…', 'Working…')}</p>}
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
