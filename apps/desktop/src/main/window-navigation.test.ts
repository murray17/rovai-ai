import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { installWindowNavigation } from './window-navigation'

it('does not bind Windows browser commands to app navigation', () => {
  const window = Object.assign(new EventEmitter(), { webContents: { send: vi.fn() } })
  installWindowNavigation(window as unknown as BrowserWindow, 'win32')
  const event = { preventDefault: vi.fn() }
  window.emit('app-command', event, 'browser-backward')
  window.emit('app-command', event, 'browser-forward')
  window.emit('app-command', event, 'volume-up')
  expect(window.listenerCount('app-command')).toBe(0)
  expect(window.webContents.send).not.toHaveBeenCalled()
  expect(event.preventDefault).not.toHaveBeenCalled()
})

it('uses native Mac swipe events without also subscribing to mouse host commands', () => {
  const window = Object.assign(new EventEmitter(), { webContents: { send: vi.fn() } })
  installWindowNavigation(window as unknown as BrowserWindow, 'darwin')
  const event = { preventDefault: vi.fn() }
  window.emit('app-command', event, 'browser-backward')
  window.emit('swipe', event, 'right'); window.emit('swipe', event, 'left'); window.emit('swipe', event, 'up')
  expect(window.listenerCount('app-command')).toBe(0)
  expect(window.webContents.send.mock.calls).toEqual([
    ['rovai:navigation-requested', 'back'], ['rovai:navigation-requested', 'forward']
  ])
  expect(event.preventDefault).toHaveBeenCalledTimes(2)
})
