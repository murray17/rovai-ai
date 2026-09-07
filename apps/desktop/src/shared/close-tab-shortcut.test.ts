import type { Input, IpcRenderer, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createCloseTabShortcutHandler, installCloseTabShortcut } from './close-tab-shortcut'

describe('close tab shortcut', () => {
  it.each(['darwin', 'win32'] as const)('routes primary W before native closing on %s', platform => {
    const on = vi.fn()
    const send = vi.fn()
    installCloseTabShortcut({ on, send } as unknown as WebContents, platform, vi.fn())
    const dispatch = on.mock.calls[0][1] as (event: { preventDefault(): void }, input: Input) => void
    const input: Input = {
      type: 'keyDown', key: 'w', code: 'KeyW', isComposing: false, isAutoRepeat: false,
      location: 0, modifiers: [],
      alt: false, shift: false, control: platform === 'win32', meta: platform === 'darwin'
    }
    const preventDefault = vi.fn()
    dispatch({ preventDefault }, input)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
    dispatch({ preventDefault }, { ...input, isAutoRepeat: true })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledOnce()

    for (const ignored of [
      { key: 'q' }, { type: 'keyUp' }, { alt: true }, { shift: true },
      { isComposing: true }, { control: false, meta: false }, { control: true, meta: true },
      { control: platform === 'darwin', meta: platform === 'win32' }
    ]) dispatch({ preventDefault }, { ...input, ...ignored } as Input)
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledOnce()
  })

  it('falls back to window closing only when no preview consumes the request', () => {
    const on = vi.fn()
    const closeWindow = vi.fn()
    const subscribe = createCloseTabShortcutHandler({ on, send: closeWindow } as unknown as IpcRenderer)
    const request = on.mock.calls[0][1] as () => void
    request()
    expect(closeWindow).toHaveBeenCalledTimes(1)
    const unsubscribeOld = subscribe(() => false)
    const closeTab = vi.fn(() => true)
    const unsubscribe = subscribe(closeTab)
    unsubscribeOld()
    request()
    expect(closeTab).toHaveBeenCalledOnce()
    expect(closeWindow).toHaveBeenCalledTimes(1)
    unsubscribe()
    request()
    expect(closeWindow).toHaveBeenCalledTimes(2)
    subscribe(() => false)
    request()
    expect(closeWindow).toHaveBeenCalledTimes(3)
  })
})
