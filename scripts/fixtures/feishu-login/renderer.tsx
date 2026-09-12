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
    expired: '二维码已过期，请点击刷新后重新扫码。', awaiting_refresh: '请刷新二维码后继续扫码。',
    failed: '无法连接飞书，请检查网络后重试。' }[stage]
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
    await Promise.all(document.querySelector('[role="dialog"]')!.getAnimations().map(animation => animation.finished))
    const qrSize = document.querySelector('.channel-qr-frame')!.getBoundingClientRect()
    check(!document.body.textContent?.includes('等待至'), 'The dialog must not display the local deadline')
    check(!document.body.textContent?.includes('二维码有效期至'), 'Local timeout must not imply server expiry')
    button('关闭').click()
    check(closed === 1, 'Close stays available before commit even while busy')
    cases.push('local PNG without a local deadline and with precommit cancellation')
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
    await render('saving_local_session', qr, { commitUncertain: true, detail: '暂时无法确认连接是否保存完成，请点击“核对保存结果”继续。' })
    button('核对保存结果').click()
    check(refreshed === 1 && button('取消').disabled, 'Uncertain commit offers reconciliation without cancellation')
    cases.push('commit and uncertain result preserve the protected activation boundary')
    await render('expired', qr, { qrDataUrl: qr })
    const refresh = button('刷新二维码')
    check(refresh.matches('.channel-qr-frame'), 'The QR region itself becomes the refresh action')
    check(!document.querySelector('img[alt="飞书连接二维码"]'), 'Expiry must hide even a stale QR image')
    const refreshSize = refresh.getBoundingClientRect()
    check(refreshSize.width === qrSize.width && refreshSize.height === qrSize.height,
      `Expiry preserves the QR region size: ${qrSize.width}x${qrSize.height} -> ${refreshSize.width}x${refreshSize.height}`)
    check(!refresh.disabled && refresh.tabIndex === 0, 'Refresh stays keyboard accessible while connect is busy')
    refresh.focus()
    check(document.activeElement === refresh, 'The refresh tile accepts keyboard focus')
    refresh.click()
    check(refreshed === 2, 'Expired QR has a working retry action')
    check(channelErrorMessage(new Error('feishu_login_expired')) !== channelErrorMessage(new Error('feishu_login_timeout')), 'Local timeout differs from QR expiry')
    await render('awaiting_refresh', qr, { qrDataUrl: qr })
    check(!document.body.textContent?.match(/超时|过期|失败/u), 'Local timeout offers refresh without an error or a claim of remote expiry')
    check(!document.querySelector('img[alt="飞书连接二维码"]'), 'The previous attempt QR cannot still be scanned')
    button('刷新二维码').click()
    check(refreshed === 3 && !button('取消').disabled, 'Local timeout keeps the dialog with refresh and cancel available')
    check(channelErrorMessage(new Error('feishu_login_cancelled')) === null, 'Cancellation stays quiet')
    cases.push('expired QR region offers accessible refresh; local timeout and cancellation remain distinct')
    return cases
  },
  async capture(theme: string, stage: ChannelQrAttemptView['stage'], qr: string) {
    document.documentElement.dataset.theme = theme
    await render(stage, qr)
    layout()
    if (stage === 'expired' || stage === 'awaiting_refresh') {
      const action = button('刷新二维码').querySelector('strong')!.getBoundingClientRect()
      const body = document.querySelector('.channel-qr-body')!.getBoundingClientRect()
      check(action.top >= body.top && action.bottom <= body.bottom, 'Refresh label stays visible without scrolling at 200 percent zoom')
    }
  }
} })
