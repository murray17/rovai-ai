import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { createWindowCloseApi } from './window-close-api'
import { parseWindowCloseResponse, WINDOW_CLOSE_CHANGED } from '../shared/window-close'

it('exposes no close preference, prompt subscription or IPC on macOS/Linux', () => {
  const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn() })
  expect(createWindowCloseApi(ipc as never, 'darwin')).toBeUndefined()
  expect(createWindowCloseApi(ipc as never, 'linux')).toBeUndefined()
  expect(ipc.invoke).not.toHaveBeenCalled()
  expect(ipc.eventNames()).toEqual([])
})

it('uses fixed Windows channels and removes listeners on unmount', async () => {
  const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn() })
  const api = createWindowCloseApi(ipc as never, 'win32')!
  await api.setBehavior('ask')
  expect(ipc.invoke).toHaveBeenCalledWith('rovai:window-close', 'set', 'ask')
  const listener = vi.fn(); const unsubscribe = api.onChanged(listener)
  ipc.emit(WINDOW_CLOSE_CHANGED, {}, { revision: 1 }); expect(listener).toHaveBeenCalledOnce()
  unsubscribe(); ipc.emit(WINDOW_CLOSE_CHANGED, {}, { revision: 2 }); expect(listener).toHaveBeenCalledOnce()
})

it.each([null, [], {}, { promptId: 0, action: 'exit', remember: false }, { promptId: 1, action: 'quit', remember: false }, { promptId: 1, action: 'tray', remember: 'true' }])('rejects malformed prompt replies %j', value => {
  expect(() => parseWindowCloseResponse(value)).toThrow()
})
