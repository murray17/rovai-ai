import { BaseWindow, WebContentsView, type BrowserWindow, type Session } from 'electron'
import type { ChannelLoginViewBounds } from '@contracts'

const HIDDEN_BOUNDS = { x: 0, y: 0, width: 1040, height: 800 }

/** The official page stays Main-owned, including when it is placed inside a Dialog. */
export class DingTalkLoginView {
  readonly #host: BaseWindow
  readonly #view: WebContentsView
  readonly #parent: BrowserWindow | null
  #container: BaseWindow
  #interaction = false
  #destroyed = false
  readonly #onParentClosed = (): void => this.destroy()

  constructor(session: Session, parent: BrowserWindow | null) {
    this.#parent = parent && !parent.isDestroyed() ? parent : null
    this.#host = new BaseWindow({ show: false, width: 1040, height: 800, focusable: false })
    this.#host.setMenuBarVisibility(false)
    this.#view = new WebContentsView({ webPreferences: {
      session, nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: false,
      backgroundThrottling: false
    } })
    this.#container = this.#host
    this.#host.contentView.addChildView(this.#view)
    this.#view.setBounds(HIDDEN_BOUNDS)
    this.#parent?.once('closed', this.#onParentClosed)
    this.#host.once('closed', () => this.destroy())
    this.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.destroy()
      }
    })
  }

  get webContents() { return this.#view.webContents }

  loadURL(url: string): Promise<void> { return this.webContents.loadURL(url) }

  isDestroyed(): boolean {
    return this.#destroyed || this.#host.isDestroyed() || this.webContents.isDestroyed()
  }

  setInteraction(required: boolean): void {
    this.#interaction = required
    if (!required) this.setBounds(null)
  }

  setBounds(bounds: ChannelLoginViewBounds | null): void {
    if (this.isDestroyed()) return
    if (bounds === null || !this.#interaction) {
      const wasEmbedded = this.#container !== this.#host
      this.#moveTo(this.#host)
      this.webContents.setZoomFactor(1)
      this.#view.setBounds(HIDDEN_BOUNDS)
      if (wasEmbedded && this.#parent && !this.#parent.isDestroyed()) this.#parent.webContents.focus()
      return
    }
    const parent = this.#parent
    if (!parent || parent.isDestroyed()) throw new Error('dingtalk_login_view_unavailable')
    const zoom = parent.webContents.getZoomFactor()
    const viewport = parent.getContentBounds()
    const rect = {
      x: Math.round(bounds.x * zoom), y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom), height: Math.round(bounds.height * zoom)
    }
    if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1
      || rect.x + rect.width > viewport.width + 1 || rect.y + rect.height > viewport.height + 1) {
      // A resize can invalidate a measurement in flight. Hide, never cover the
      // Dialog's cancel button or a different surface with an out-of-date view.
      this.setBounds(null)
      return
    }
    const firstAttachment = this.#container !== parent
    this.#moveTo(parent)
    this.webContents.setZoomFactor(zoom)
    this.#view.setBounds(rect)
    if (firstAttachment) this.webContents.focus()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#parent?.removeListener('closed', this.#onParentClosed)
    if (!this.#container.isDestroyed()) this.#container.contentView.removeChildView(this.#view)
    if (!this.webContents.isDestroyed()) this.webContents.close()
    if (!this.#host.isDestroyed()) this.#host.destroy()
    if (this.#parent && !this.#parent.isDestroyed()) this.#parent.webContents.focus()
  }

  #moveTo(parent: BaseWindow): void {
    if (this.#container === parent) return
    if (!this.#container.isDestroyed()) this.#container.contentView.removeChildView(this.#view)
    parent.contentView.addChildView(this.#view)
    this.#container = parent
  }
}

export function parseChannelLoginViewBounds(value: unknown): ChannelLoginViewBounds | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid login viewport')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 4 || !['x', 'y', 'width', 'height'].every((key) =>
    typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0 && record[key] <= 32_768
  ) || Number(record.width) < 1 || Number(record.height) < 1) throw new Error('Invalid login viewport')
  return { x: Number(record.x), y: Number(record.y), width: Number(record.width), height: Number(record.height) }
}
