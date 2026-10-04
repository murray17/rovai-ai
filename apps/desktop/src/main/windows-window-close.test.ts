import { describe, expect, it, vi } from 'vitest'
import type { WindowCloseBehavior } from '@contracts'
import { WindowsWindowClose, restoreMainWindow } from './windows-window-close'

function fixture(behavior: WindowCloseBehavior = 'ask') {
  const order: string[] = []
  let visible = true
  const window = {
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false), restore: vi.fn(),
    show: vi.fn(() => { visible = true; order.push('show') }), focus: vi.fn(),
    hide: vi.fn(() => { visible = false; order.push('hide') })
  }
  const trays: { destroy: () => void; isDestroyed: () => boolean; open(): void; quit(): void }[] = []
  const preferences = { get: () => behavior, loadFailed: false, set: vi.fn(async (next: WindowCloseBehavior) => { order.push('save'); behavior = next }) }
  const createTray = vi.fn((open: () => void, quit: () => void) => {
    order.push('create')
    let destroyed = false
    const tray = { open, quit, isDestroyed: () => destroyed, destroy: vi.fn(() => { order.push('destroy'); destroyed = true }) }
    trays.push(tray)
    return tray
  })
  const quit = vi.fn()
  const publish = vi.fn()
  const controller = new WindowsWindowClose({ preferences, window: () => window, createTray, quit, publish })
  const close = () => { const event = { preventDefault: vi.fn() }; controller.handleClose(event); expect(event.preventDefault).toHaveBeenCalledOnce() }
  const respond = (action: 'tray' | 'exit' | 'cancel', remember = false) => controller.respond({ promptId: controller.get().promptId!, action, remember })
  return { controller, window, preferences, createTray, quit, publish, close, respond, trays, order, visible: () => visible }
}

describe('Windows main-window close owner', () => {
  it('asks once, ignores stale replies and cancels without changing the preference', async () => {
    const f = fixture()
    f.controller.initialize()
    expect(f.createTray).not.toHaveBeenCalled()
    f.close()
    const id = f.controller.get().promptId!
    f.close()
    expect(f.controller.get().promptId).toBe(id)
    await f.respond('cancel', true)
    f.close()
    await f.controller.respond({ promptId: id, action: 'exit', remember: true })
    expect(f.controller.get().promptId).not.toBe(id)
    expect(f.preferences.set).not.toHaveBeenCalled()
    expect(f.quit).not.toHaveBeenCalled()
    expect(f.visible()).toBe(true)
  })

  it('one-time tray hides only after tray creation, keeps the policy and restores the same window', async () => {
    const f = fixture()
    f.close(); await f.respond('tray')
    expect(f.order).toEqual(['create', 'hide'])
    expect(f.visible()).toBe(false)
    expect(f.preferences.set).not.toHaveBeenCalled()
    expect(f.controller.get().behavior).toBe('ask')
    f.trays[0].open()
    expect(f.visible()).toBe(true)
    expect(f.window.focus).toHaveBeenCalledOnce()
    f.close(); expect(f.controller.get().promptId).not.toBeNull()
    expect(f.quit).not.toHaveBeenCalled()
  })

  it.each(['tray', 'exit'] as const)('remembers %s before acting and synchronizes the snapshot', async action => {
    const f = fixture()
    f.close(); await f.respond(action, true)
    expect(f.preferences.get()).toBe(action)
    expect(f.controller.get().behavior).toBe(action)
    if (action === 'tray') expect(f.order).toEqual(['create', 'save', 'hide'])
    else { expect(f.quit).toHaveBeenCalledOnce(); expect(f.createTray).not.toHaveBeenCalled() }
  })

  it('one-time exit uses normal quit without remembering', async () => {
    const f = fixture()
    f.close(); await f.respond('exit')
    expect(f.quit).toHaveBeenCalledOnce()
    expect(f.preferences.get()).toBe('ask')
  })

  it('saved tray initializes one icon and saved exit directly requests quit', () => {
    const f = fixture('tray')
    f.controller.initialize(); f.close()
    expect(f.createTray).toHaveBeenCalledOnce()
    expect(f.visible()).toBe(false)
    f.trays[0].quit(); expect(f.quit).toHaveBeenCalledOnce()
    const e = fixture('exit'); e.close()
    expect(e.quit).toHaveBeenCalledOnce()
    expect(e.controller.get().promptId).toBeNull()
  })

  it.each(['ask', 'exit'] as const)('switches hidden tray to %s only after showing the window', async behavior => {
    const f = fixture('tray')
    f.close(); f.order.length = 0
    await f.controller.setBehavior(behavior)
    expect(f.order).toEqual(['show', 'save', 'destroy'])
    expect(f.controller.get().behavior).toBe(behavior)
    expect(f.quit).not.toHaveBeenCalled()
  })

  it('switching from exit to ask restores prompting', async () => {
    const f = fixture('exit')
    await f.controller.setBehavior('ask'); f.close()
    expect(f.controller.get().promptId).not.toBeNull()
    expect(f.quit).not.toHaveBeenCalled()
  })

  it('tray creation failure keeps the original choice/window and offers retry', async () => {
    const f = fixture()
    f.createTray.mockImplementationOnce(() => { throw Error('no tray') })
    f.close(); await f.respond('tray', true)
    expect(f.visible()).toBe(true)
    expect(f.controller.get()).toMatchObject({ behavior: 'ask', busy: false, error: 'tray_unavailable' })
    expect(f.preferences.set).not.toHaveBeenCalled()
    await f.respond('tray', true)
    expect(f.visible()).toBe(false)
  })

  it('startup tray failure leaves a visible choice and permits explicit exit', async () => {
    const f = fixture('tray')
    f.createTray.mockImplementationOnce(() => { throw Error('tray') })
    f.controller.initialize()
    expect(f.controller.get().promptId).not.toBeNull()
    await f.respond('exit'); expect(f.quit).toHaveBeenCalledOnce()
  })

  it('remember write failure retains the prompt and supports a one-time action', async () => {
    const f = fixture()
    f.preferences.set.mockRejectedValueOnce(Error('disk full'))
    f.close(); const id = f.controller.get().promptId
    await f.respond('tray', true)
    expect(f.visible()).toBe(true)
    expect(f.controller.get()).toMatchObject({ behavior: 'ask', error: 'save_failed', promptId: id, busy: false })
    expect(f.trays[0].isDestroyed()).toBe(true)
    await f.respond('tray')
    expect(f.visible()).toBe(false)
    expect(f.preferences.get()).toBe('ask')
  })

  it('settings save failure rolls back a new icon and retains the old policy', async () => {
    const f = fixture('exit')
    f.preferences.set.mockRejectedValueOnce(Error('disk full'))
    await f.controller.setBehavior('tray')
    expect(f.controller.get()).toMatchObject({ behavior: 'exit', error: 'save_failed', busy: false })
    expect(f.visible()).toBe(true)
    expect(f.trays[0].isDestroyed()).toBe(true)
  })

  it('failed removal preference keeps the existing tray and exposes the window', async () => {
    const f = fixture('tray'); f.close()
    f.preferences.set.mockRejectedValueOnce(Error('disk full'))
    await f.controller.setBehavior('ask')
    expect(f.visible()).toBe(true)
    expect(f.trays[0].isDestroyed()).toBe(false)
    expect(f.controller.get().behavior).toBe('tray')
  })

  it('recreates a destroyed tray before hiding', () => {
    const f = fixture('tray'); f.controller.initialize()
    f.trays[0].destroy(); f.close()
    expect(f.createTray).toHaveBeenCalledTimes(2)
    expect(f.visible()).toBe(false)
  })

  it('explicit/update quit overrides pending choices, and failed preparation reveals recovery', async () => {
    const f = fixture(); f.close()
    const id = f.controller.get().promptId!
    f.controller.beginQuit()
    await f.controller.respond({ promptId: id, action: 'tray', remember: true })
    f.close()
    expect(f.window.hide).not.toHaveBeenCalled()
    expect(f.controller.get().promptId).toBeNull()
    f.controller.quitPreparationFailed()
    expect(f.controller.get()).toMatchObject({ error: 'quit_failed', busy: false })
    expect(f.visible()).toBe(true)
    await f.respond('exit'); expect(f.quit).toHaveBeenCalledOnce()
  })

  it('an in-flight save cannot hide after explicit quit, even if quit preparation fails', async () => {
    const f = fixture(); f.close()
    let finish!: () => void
    f.preferences.set.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = f.respond('tray', true)
    const settled = vi.fn()
    void f.controller.settlePending().then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    await f.respond('exit', true)
    f.close()
    expect(f.preferences.set).toHaveBeenCalledOnce()
    f.controller.beginQuit(); f.controller.quitPreparationFailed()
    expect(f.controller.get().busy).toBe(true)
    finish(); await pending
    expect(settled).toHaveBeenCalledOnce()
    expect(f.window.hide).not.toHaveBeenCalled()
    expect(f.controller.get()).toMatchObject({ error: 'quit_failed', busy: false })
  })

  it('quit disposal removes only its tray; normal restore handles minimized and hidden windows', () => {
    const f = fixture('tray'); f.controller.initialize()
    f.window.isMinimized.mockReturnValue(true)
    restoreMainWindow(f.window)
    expect(f.window.restore).toHaveBeenCalledOnce()
    expect(f.window.show).toHaveBeenCalledOnce()
    f.controller.dispose(); f.controller.dispose()
    expect(f.trays[0].destroy).toHaveBeenCalledOnce()
    f.window.isDestroyed.mockReturnValue(true)
    restoreMainWindow(f.window); restoreMainWindow(null)
    expect(f.window.show).toHaveBeenCalledOnce()
  })
})
