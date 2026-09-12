import { createRoot } from 'react-dom/client'
import { QrDialog, channelErrorMessage } from '../../../apps/desktop/src/renderer/src/ChannelSettings'
import type { ChannelQrAttemptView, ChannelSettingsSnapshot } from '@contracts'
import '../../../apps/desktop/src/renderer/src/styles.css'

const root = createRoot(document.getElementById('root')!)
const errors: unknown[] = []
window.addEventListener('error', event => errors.push(event.error))
let closed = 0
let refreshed = 0
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 40))))
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function button(label: string) {
  const value = [...document.querySelectorAll('button')].find(button => button.textContent === label || button.ariaLabel === label)
  check(value, `Missing button: ${label}`)
  return value
}
async function render(stage: ChannelQrAttemptView['stage'], qr: string, extra = {}) {
  const detail = { preparing: '正在准备二维码', awaiting_scan: '请使用飞书扫码', scan_confirmed: '已扫码，请在手机上确认',
    completing_login: '正在建立登录会话', inspecting_identity: '正在读取账号与企业信息', saving_local_session: '正在保存连接',
    expired: '二维码已过期，请重新扫码。', failed: '无法连接飞书，请检查网络后重试。' }[stage]
  const snapshot = { schemaVersion: 4, channels: [], pendingBindingCount: 0, bindingIssueCount: 0, activeProvisioning: null,
    activeQrAttempt: { kind: 'feishu', attemptId: 'fixture', purpose: 'account_login', agentId: null, stage,
      qrDataUrl: stage === 'awaiting_scan' ? qr : null, expiresAt: null,
      waitUntil: stage === 'awaiting_scan' ? '2026-09-12T10:00:00Z' : null, detail, ...extra }
  } as ChannelSettingsSnapshot
  root.render(<QrDialog snapshot={snapshot} kind="feishu" busy onClose={() => { closed++ }} onRefresh={() => { refreshed++ }} />)
  await settle()
  check(errors.length === 0, 'Renderer error')
}
function layout() {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const box = dialog.getBoundingClientRect()
  check(box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1, 'Dialog must fit')
}
Object.assign(window, { feishuLoginTest: {
  async run(qr: string) {
    const cases: string[] = []
    await render('awaiting_scan', qr)
    const image = document.querySelector<HTMLImageElement>('img')!
    await image.decode()
    check(image.naturalWidth === 280, 'Display the locally generated PNG')
    check(document.body.textContent?.includes('本次等待至'), 'Local deadline must be labeled as local')
    check(!document.body.textContent?.includes('二维码有效期至'), 'Local timeout must not imply server expiry')
    button('关闭').click()
    check(closed === 1, 'Close stays available before commit even while busy')
    cases.push('local PNG, honest deadline and precommit cancellation')
    for (const stage of ['scan_confirmed', 'completing_login', 'inspecting_identity'] as const) {
      await render(stage, qr)
      check(!document.querySelector('img[alt="飞书连接二维码"]'), 'Post-scan progress must not display an obsolete QR')
      check(!button('取消').disabled, 'Precommit progress remains cancellable')
      layout()
    }
    cases.push('scan confirmation, session establishment and identity remain distinct')
    await render('saving_local_session', qr)
    button('关闭').click()
    button('取消').click()
    document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    check(closed === 1 && button('取消').disabled && button('关闭').disabled, 'All commit cancellation paths are blocked')
    await render('saving_local_session', qr, { commitUncertain: true, detail: '连接保存结果暂时无法确认；恢复本地服务后可核对保存结果。' })
    button('核对保存结果').click()
    check(refreshed === 1 && button('取消').disabled, 'Uncertain commit offers reconciliation without cancellation')
    cases.push('commit and uncertain result preserve the protected activation boundary')
    await render('expired', qr)
    button('刷新二维码').click()
    check(refreshed === 2, 'Expired QR has a retry action')
    check(channelErrorMessage(new Error('feishu_login_expired')) !== channelErrorMessage(new Error('feishu_login_timeout')), 'Local timeout differs from QR expiry')
    check(channelErrorMessage(new Error('feishu_login_cancelled')) === null, 'Cancellation stays quiet')
    cases.push('expiry, local timeout and cancellation have distinct outcomes')
    return cases
  },
  async capture(theme: string, stage: ChannelQrAttemptView['stage'], qr: string) {
    document.documentElement.dataset.theme = theme
    await render(stage, qr)
    layout()
  }
} })
