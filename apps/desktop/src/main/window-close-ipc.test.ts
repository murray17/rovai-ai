import { expect, it, vi } from 'vitest'
import { createWindowCloseRequestHandler } from './window-close-ipc'

it('rejects non-Windows, another window and embedded frames before accessing the owner', () => {
  const webContents = { mainFrame: {} }
  const window = { webContents, isDestroyed: () => false }
  const owner = { get: vi.fn(), setBehavior: vi.fn(), respond: vi.fn() }
  for (const [platform, event] of [
    ['darwin', { sender: webContents, senderFrame: webContents.mainFrame }],
    ['win32', { sender: {}, senderFrame: webContents.mainFrame }],
    ['win32', { sender: webContents, senderFrame: {} }]
  ] as const) {
    const handler = createWindowCloseRequestHandler(platform, () => owner as never, () => window as never)
    expect(() => handler(event as never, 'set', 'tray')).toThrow()
  }
  expect(owner.setBehavior).not.toHaveBeenCalled()
  const handler = createWindowCloseRequestHandler('win32', () => owner as never, () => window as never)
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  handler(event as never, 'get', undefined); expect(owner.get).toHaveBeenCalledOnce()
  expect(() => handler(event as never, 'set', 'bogus')).toThrow()
  expect(() => handler(event as never, 'respond', { action: 'tray' })).toThrow()
})
