import type { BrowserWindow } from 'electron'
import type { WindowCloseBehavior, WindowCloseResponse, WindowCloseSnapshot } from '@contracts'
import type { PreventableQuitEvent } from './app-quit-coordinator'
import { isWindowCloseBehavior } from '../shared/window-close'

type CloseWindow = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'restore' | 'show' | 'focus' | 'hide'>
interface TrayHandle { destroy(): void; isDestroyed(): boolean }
interface Options {
  preferences: { get(): WindowCloseBehavior; set(value: WindowCloseBehavior): Promise<void>; loadFailed: boolean }
  window(): CloseWindow | null
  createTray(open: () => void, quit: () => void): TrayHandle
  quit(): void
  publish(snapshot: WindowCloseSnapshot): void
}

export function restoreMainWindow(window: CloseWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/** Owns only Windows main-window close policy; hiding never enters shutdown. */
export class WindowsWindowClose {
  #snapshot: WindowCloseSnapshot
  #tray: TrayHandle | null = null
  #promptSequence = 0
  #quitting = false
  #generation = 0
  #operating = false
  #pendingWrite: Promise<void> = Promise.resolve()

  constructor(private readonly options: Options) {
    this.#snapshot = {
      revision: 0, behavior: options.preferences.get(), promptId: null, busy: false,
      error: options.preferences.loadFailed ? 'load_failed' : null
    }
  }

  get(): WindowCloseSnapshot { return { ...this.#snapshot } }
  settlePending(): Promise<void> { return this.#pendingWrite }

  initialize(): void {
    if (this.#quitting || this.#snapshot.behavior !== 'tray') return
    try { this.#ensureTray() } catch { this.#fail('tray_unavailable', true) }
  }

  restore(): void { restoreMainWindow(this.options.window()) }

  handleClose(event: PreventableQuitEvent): void {
    event.preventDefault()
    if (this.#quitting || this.#operating || this.#snapshot.busy || this.#snapshot.promptId !== null) return
    if (this.#snapshot.behavior === 'ask') {
      this.#patch({ promptId: ++this.#promptSequence, error: this.#snapshot.error })
    } else {
      void this.#perform(this.#snapshot.behavior, false)
    }
  }

  async respond(response: WindowCloseResponse): Promise<WindowCloseSnapshot> {
    if (this.#quitting || this.#operating || this.#snapshot.busy || response.promptId !== this.#snapshot.promptId) return this.get()
    if (response.action === 'cancel') {
      this.#patch({ promptId: null, error: null })
    } else {
      await this.#perform(response.action, response.remember)
    }
    return this.get()
  }

  async setBehavior(behavior: WindowCloseBehavior): Promise<WindowCloseSnapshot> {
    if (!isWindowCloseBehavior(behavior)) throw new Error('Invalid close behavior')
    if (this.#quitting || this.#operating || this.#snapshot.busy || this.#snapshot.promptId !== null) return this.get()
    const generation = this.#generation
    this.#operating = true
    const hadTray = this.#hasTray()
    this.#patch({ busy: true, error: null })
    let failure: 'tray_unavailable' | 'save_failed' = 'tray_unavailable'
    try {
      if (behavior === 'tray') {
        this.#ensureTray()
      } else {
        // A hidden window must be recoverable before removing its only visible entry.
        this.restore()
      }
      failure = 'save_failed'
      await this.#save(behavior)
      if (generation !== this.#generation && this.#quitting) return this.get()
      if (behavior !== 'tray') this.#removeTray()
    } catch {
      if (!hadTray) this.#removeTray()
      if (generation === this.#generation) this.#fail(failure, false)
    } finally {
      this.#operating = false
      if (!this.#quitting) this.#patch({ busy: false })
    }
    return this.get()
  }

  /** Explicit quit/update invalidates in-flight hide and pending Renderer responses. */
  beginQuit(): void {
    if (this.#quitting) return
    this.#quitting = true
    this.#generation++
    this.#patch({ busy: true, promptId: null, error: null })
  }

  quitPreparationFailed(): void {
    this.#quitting = false
    this.#fail('quit_failed', true)
  }

  dispose(): void { this.beginQuit(); this.#removeTray() }

  async #perform(action: 'tray' | 'exit', remember: boolean): Promise<void> {
    const generation = this.#generation
    this.#operating = true
    const hadTray = this.#hasTray()
    this.#patch({ busy: true, error: null })
    try {
      if (action === 'tray') {
        try { this.#ensureTray() } catch { this.#fail('tray_unavailable', true); return }
      }
      if (remember) {
        try {
          await this.#save(action)
        } catch {
          if (!hadTray) this.#removeTray()
          if (generation === this.#generation) this.#fail('save_failed', true)
          return
        }
      }
      if (generation !== this.#generation) return
      this.#patch({ promptId: null, error: null })
      if (action === 'tray') {
        const window = this.options.window()
        // Verify the native tray is still alive immediately before hiding.
        if (!window || window.isDestroyed() || !this.#hasTray()) throw new Error('Tray/window unavailable')
        window.hide()
      } else {
        this.beginQuit()
        this.options.quit()
      }
    } catch {
      if (generation === this.#generation) this.#fail('tray_unavailable', true)
    } finally {
      this.#operating = false
      if (!this.#quitting) this.#patch({ busy: false })
    }
  }

  #hasTray(): boolean { return this.#tray !== null && !this.#tray.isDestroyed() }
  async #save(behavior: WindowCloseBehavior): Promise<void> {
    const write = this.options.preferences.set(behavior)
    this.#pendingWrite = write.catch(() => undefined)
    await write
    this.#patch({ behavior })
  }
  #ensureTray(): void {
    if (this.#hasTray()) return
    this.#tray = this.options.createTray(() => this.restore(), () => this.options.quit())
    if (!this.#hasTray()) throw new Error('Tray creation failed')
  }
  #removeTray(): void {
    if (this.#hasTray()) this.#tray!.destroy()
    this.#tray = null
  }
  #fail(error: NonNullable<WindowCloseSnapshot['error']>, prompt: boolean): void {
    this.restore()
    this.#patch({ busy: this.#operating, error, ...(prompt ? { promptId: this.#snapshot.promptId ?? ++this.#promptSequence } : {}) })
  }
  #patch(patch: Partial<WindowCloseSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch, revision: this.#snapshot.revision + 1 }
    this.options.publish(this.get())
  }
}
