import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChannelSettingsSnapshot } from '../../../packages/contracts/src'
import { ChannelConnectionRow, ChannelSettings, QrDialog, channelErrorMessage } from '../../../apps/desktop/src/renderer/src/ChannelSettings'
import '../../../apps/desktop/src/renderer/src/styles.css'

declare global {
  interface Window {
    loginFixture: { stage(stage: string): Promise<void>; facts(): Promise<{ refreshes: number; attached: boolean; bounds: { x: number; y: number; width: number; height: number } | null }> }
  }
}

const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
document.body.style.overflow = 'auto'
document.getElementById('root')!.style.padding = '24px'
const root = createRoot(document.getElementById('root')!)
root.render(<ChannelSettings agents={[]} />)

// Keep the unfinished login components under test without adding a production entry or bypass flag.
function RetainedDingTalkLogin() {
  const [snapshot, setSnapshot] = useState<ChannelSettingsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.rovai.channels.get().then(setSnapshot)
    return window.rovai.channels.onChanged(setSnapshot)
  }, [])
  const connect = async () => {
    setBusy(true)
    setError(null)
    try { setSnapshot(await window.rovai.channels.connect('dingtalk')) }
    catch (error) { setError(channelErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const channel = snapshot?.channels[0]
  return <>
    {error && <p role="alert">{error}</p>}
    {channel && <ChannelConnectionRow channel={channel} busy={busy ? 'connect:dingtalk' : null}
      onConnect={() => void connect()} />}
    <QrDialog snapshot={snapshot} kind="dingtalk" busy={busy}
      onClose={id => { void window.rovai.channels.cancelQrAttempt(id).then(setSnapshot) }}
      onRefresh={id => { void window.rovai.channels.refreshLoginQr(id) }} />
  </>
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function settle() {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await wait(40)
  check(!errors.length, errors.join('\n'))
}
function button(label: string): HTMLButtonElement {
  const target = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.ariaLabel === label)
  check(target, 'Missing button: ' + label)
  return target
}
async function stage(value: string) { await window.loginFixture.stage(value); await settle() }
async function connect() {
  button('重新连接').click()
  for (let attempt = 0; attempt < 200 && !document.querySelector('[role="dialog"]'); attempt++) await wait(25)
  await settle()
  check(document.querySelector('[role="dialog"]'), 'Connect must open the Rovai dialog: ' + document.body.textContent)
}
function closed() {
  check(!document.querySelector('[role="dialog"]'), 'Cancel must close the dialog')
  check(document.body.textContent?.includes('原账号'), 'Cancel must preserve the original account')
  check(!document.body.textContent?.includes('dingtalk_operation_cancelled'), 'Cancel must not show an IPC failure')
  check(!button('重新连接').disabled, 'Cancel must release connect busy state')
}
function layout() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const close = dialog.querySelector<HTMLElement>('.app-dialog-close')!
  const rect = dialog.getBoundingClientRect()
  const closeRect = close.getBoundingClientRect()
  check(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1,
    'Dialog must fit the viewport')
  check(closeRect.top >= 0 && closeRect.bottom <= innerHeight, 'Close must remain visible')
  check(document.elementFromPoint(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2)?.closest('button') === close,
    'The close button must not be obscured in the Renderer')
}

Object.assign(window, { dingtalkLoginTest: {
  async run() {
    const cases: string[] = []
    await settle()
    check(document.body.textContent?.includes('当前版本没有可用的渠道'), 'The public page must not fall back to hidden DingTalk')
    check(!document.body.textContent?.includes('钉钉'), 'The public page must omit the entire DingTalk entry')
    check(!document.querySelector('[role="dialog"]'), 'An old DingTalk login attempt must not reopen its hidden entry')
    check(!(await window.loginFixture.facts()).attached, 'The hidden entry must not attach an official login view')
    cases.push('public ChannelSettings hides DingTalk and its stale login attempt without deleting state')
    await window.rovai.channels.cancelQrAttempt('legacy-attempt')
    root.render(<RetainedDingTalkLogin />)
    await settle()
    await connect()
    check(!button('关闭').disabled, 'DingTalk login close is available while connect is pending')
    check(!document.querySelector('iframe,webview'), 'Remote content must not live inside the privileged Renderer')
    cases.push('DingTalk opens the incumbent Rovai dialog with an enabled close action')
    await stage('awaiting_scan')
    const image = document.querySelector<HTMLImageElement>('img[alt="钉钉连接二维码"]')
    check(image?.complete && image.naturalWidth === 180, 'The Main QR PNG must be displayed')
    check(!document.body.textContent?.includes('浏览器'), 'QR login must not direct users to another browser')
    layout()
    cases.push('QR uses the same dialog and presentation boundary as Feishu')
    await stage('scan_confirmed')
    check(!document.querySelector('img[alt="钉钉连接二维码"]'), 'A scanned QR must be removed')
    await stage('expired')
    button('刷新二维码').click()
    await settle()
    check((await window.loginFixture.facts()).refreshes === 1, 'Refresh must use the typed Main endpoint once')
    cases.push('scan confirmation clears the code and expiry exposes refresh')
    await stage('awaiting_interaction')
    await wait(220)
    const native = await window.loginFixture.facts()
    check(native.attached, 'Enterprise selection must be inside Rovai')
    check(document.querySelector('.has-platform-view')!.getBoundingClientRect().width >= 750, 'Official interaction needs the wider dialog')
    layout()
    button('关闭').click()
    await settle()
    closed()
    check(!(await window.loginFixture.facts()).attached, 'Close must detach the official view')
    cases.push('close detaches the native page and preserves the previous account')
    await connect()
    await stage('scan_confirmed')
    document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    closed()
    cases.push('Escape cancels without an in-page alert')
    await connect()
    await stage('saving_local_session')
    check(button('关闭').disabled && button('取消').disabled, 'The atomic commit has no interrupt action')
    await stage('awaiting_scan')
    button('取消').click()
    await settle()
    closed()
    cases.push('only the atomic local commit briefly disables cancellation')
    await connect()
    await stage('fixture_network_error')
    check(document.body.textContent?.includes('暂时无法连接钉钉开放平台'), 'A real network failure remains visible')
    check(document.body.textContent?.includes('原账号'), 'Network errors do not clear the existing account')
    cases.push('real network failures remain actionable and keep the account')
    return cases
  },
  async capture(theme: string, nextStage: string) {
    document.documentElement.dataset.theme = theme
    if (!document.querySelector('[role="dialog"]')) await connect()
    await stage(nextStage)
    await wait(220)
    layout()
    return { width: innerWidth, height: innerHeight }
  },
  async checkNativeClip(zoom: number) {
    await settle()
    layout()
    const native = await window.loginFixture.facts()
    check(native.attached && native.bounds, 'The native view must remain attached after zoom')
    const body = document.querySelector('.channel-qr-body')!.getBoundingClientRect()
    const header = document.querySelector('.app-dialog-header')!.getBoundingClientRect()
    const footer = document.querySelector('.app-dialog-footer')!.getBoundingClientRect()
    check(native.bounds.y >= header.bottom * zoom - 1, 'Native page may not cover the header')
    check(native.bounds.y + native.bounds.height <= Math.min(body.bottom, footer.top) * zoom + 1,
      'Native page may not cover the footer')
    return true
  }
} })
