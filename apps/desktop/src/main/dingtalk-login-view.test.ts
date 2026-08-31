import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseWindow, type BrowserWindow, type Session } from 'electron'
import {
  DingTalkLoginView, parseChannelLoginViewBounds, parseDingTalkLoginPageObservation
} from './dingtalk-login-view'

const native = vi.hoisted(() => ({
  hosts: [] as Array<{ options: Record<string, unknown>; destroyed: boolean }>,
  closed: false, options: {} as Record<string, unknown>,
  bounds: vi.fn(), focus: vi.fn(), zoom: vi.fn(), on: vi.fn(), close: vi.fn()
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BaseWindow: class extends EventEmitter {
      readonly entry: { options: Record<string, unknown>; destroyed: boolean }
      readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
      constructor(options: Record<string, unknown>) {
        super()
        this.entry = { options, destroyed: false }
        native.hosts.push(this.entry)
      }
      setMenuBarVisibility(): void {}
      isDestroyed(): boolean { return this.entry.destroyed }
      destroy(): void { this.entry.destroyed = true; this.emit('closed') }
    },
    WebContentsView: class {
      readonly setBounds = native.bounds
      readonly webContents = {
        isDestroyed: () => native.closed,
        close: () => { native.closed = true; native.close() },
        setZoomFactor: native.zoom, focus: native.focus, on: native.on,
        loadURL: vi.fn(async () => undefined)
      }
      constructor(options: Record<string, unknown>) { native.options = options }
    }
  }
})

beforeEach(() => {
  native.hosts = []
  native.closed = false
  vi.clearAllMocks()
})

function fixture() {
  const parent = Object.assign(new BaseWindow({}), {
    webContents: { getZoomFactor: vi.fn(() => 1), focus: vi.fn() },
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1040, height: 800 }))
  }) as unknown as BrowserWindow
  const session = {} as Session
  const view = new DingTalkLoginView(session, parent)
  return { parent, session, view }
}

describe('DingTalk Main-owned login view', () => {
  it('starts hidden with no Node, preload, devtools or shared browser profile', () => {
    const f = fixture()
    expect(native.hosts[1]?.options.show).toBe(false)
    expect(native.options.webPreferences).toEqual({
      session: f.session, nodeIntegration: false, contextIsolation: true,
      sandbox: true, devTools: false, backgroundThrottling: false
    })
    f.view.setBounds({ x: 100, y: 100, width: 400, height: 300 })
    expect(f.parent.contentView.addChildView).not.toHaveBeenCalled()
    f.view.destroy()
  })

  it('attaches only for required interaction and accounts for Renderer zoom', () => {
    const f = fixture()
    vi.mocked(f.parent.webContents.getZoomFactor).mockReturnValue(2)
    f.view.setInteraction(true)
    f.view.setBounds({ x: 50, y: 60, width: 400, height: 250 })
    expect(f.parent.contentView.addChildView).toHaveBeenCalledOnce()
    expect(native.bounds).toHaveBeenLastCalledWith({ x: 100, y: 120, width: 800, height: 500 })
    expect(native.zoom).toHaveBeenLastCalledWith(2)
    expect(native.focus).toHaveBeenCalledOnce()
    f.view.setBounds(null)
    expect(f.parent.contentView.removeChildView).toHaveBeenCalledOnce()
    expect(f.parent.webContents.focus).toHaveBeenCalledOnce()
    expect(native.hosts[1]?.options.show).toBe(false)
    f.view.destroy()
  })

  it('hides an obsolete out-of-window measurement instead of obscuring another surface', () => {
    const f = fixture()
    f.view.setInteraction(true)
    f.view.setBounds({ x: 900, y: 700, width: 400, height: 300 })
    expect(f.parent.contentView.addChildView).not.toHaveBeenCalled()
    expect(native.bounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1040, height: 800 })
    f.view.destroy()
  })

  it('closes the remote page and hidden host on Escape, and ignores subsequent bounds', () => {
    const f = fixture()
    f.view.setInteraction(true)
    f.view.setBounds({ x: 100, y: 100, width: 400, height: 300 })
    const handler = native.on.mock.calls.find(([name]) => name === 'before-input-event')![1]
    const event = { preventDefault: vi.fn() }
    handler(event, { type: 'keyDown', key: 'Escape' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(native.close).toHaveBeenCalledOnce()
    expect(native.hosts[1]?.destroyed).toBe(true)
    expect(f.view.isDestroyed()).toBe(true)
    f.view.setBounds({ x: 100, y: 100, width: 400, height: 300 })
    expect(f.parent.contentView.addChildView).toHaveBeenCalledOnce()
    f.view.destroy()
    expect(native.close).toHaveBeenCalledOnce()
  })

  it('cleans up when the parent closes or the page was already destroyed', () => {
    const f = fixture()
    native.closed = true
    f.parent.emit('closed')
    expect(native.hosts[1]?.destroyed).toBe(true)
    expect(native.close).not.toHaveBeenCalled()
  })
})

describe('login presentation boundary', () => {
  it.each([
    undefined, {}, [], { x: 0, y: 0, width: 0, height: 100 },
    { x: -1, y: 0, width: 100, height: 100 }, { x: NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: Infinity, width: 100, height: 100 }, { x: 0, y: 0, width: 50_000, height: 100 },
    { x: 0, y: 0, width: 100, height: 100, url: 'https://untrusted.example' }
  ])('rejects malformed or non-geometric IPC: %j', (value) => {
    expect(() => parseChannelLoginViewBounds(value)).toThrow('Invalid login viewport')
  })

  it('accepts only finite geometry or explicit detachment', () => {
    const value = { x: 4.5, y: 8, width: 400, height: 300 }
    expect(parseChannelLoginViewBounds(value)).toEqual(value)
    expect(parseChannelLoginViewBounds(null)).toBeNull()
  })

  it('projects only bounded PNG or closed stages, never arbitrary page fields', () => {
    expect(parseDingTalkLoginPageObservation({ kind: 'qr', dataUrl: 'data:image/png;base64,aW1hZ2U=', cookie: 'private' }))
      .toEqual({ kind: 'qr', dataUrl: 'data:image/png;base64,aW1hZ2U=' })
    for (const dataUrl of ['https://login.dingtalk.com/?access_token=private', 'data:image/svg+xml;base64,c2NyaXB0',
      `data:image/png;base64,${'a'.repeat(262_144)}`]) {
      expect(parseDingTalkLoginPageObservation({ kind: 'qr', dataUrl })).toEqual({ kind: 'interaction' })
    }
    expect(parseDingTalkLoginPageObservation({ kind: 'scanned', text: 'private' })).toEqual({ kind: 'scanned' })
    expect(parseDingTalkLoginPageObservation(null)).toEqual({ kind: 'interaction' })
  })
})
