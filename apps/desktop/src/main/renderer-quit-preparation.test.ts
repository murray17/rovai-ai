import { EventEmitter } from 'node:events'
import type { BrowserWindow, MessageChannelMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { APP_PREPARE_QUIT_CHANNEL } from '../shared/app-lifecycle'
import { requestRendererQuitPreparation } from './renderer-quit-preparation'

class TestPort extends EventEmitter {
  readonly start = vi.fn()
  readonly close = vi.fn()
}

function testChannel(): {
  port1: TestPort
  port2: TestPort
  channel: MessageChannelMain
} {
  const port1 = new TestPort()
  const port2 = new TestPort()
  return {
    port1,
    port2,
    channel: { port1, port2 } as unknown as MessageChannelMain
  }
}

function testWindow(postMessage: (...args: unknown[]) => void): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      postMessage
    }
  } as unknown as BrowserWindow
}

describe('requestRendererQuitPreparation', () => {
  it('waits for the live Renderer preparation response', async () => {
    const { port1, port2, channel } = testChannel()
    const postMessage = vi.fn((...args: unknown[]) => {
      expect(args).toEqual([APP_PREPARE_QUIT_CHANNEL, null, [port2]])
      port1.emit('message', { data: { status: 'prepared' } })
    })

    await requestRendererQuitPreparation(testWindow(postMessage), () => channel)

    expect(port1.start).toHaveBeenCalledOnce()
    expect(port1.close).toHaveBeenCalledOnce()
  })

  it('rejects the quit fence when the Renderer reports a Draft failure', async () => {
    const { port1, channel } = testChannel()
    const window = testWindow(() => {
      port1.emit('message', { data: { status: 'failed', message: 'Draft revision conflict' } })
    })

    await expect(requestRendererQuitPreparation(window, () => channel))
      .rejects.toThrow('Draft revision conflict')
  })

  it('does not contact a missing, destroyed, or loading Renderer', async () => {
    const createChannel = vi.fn()
    await requestRendererQuitPreparation(null, createChannel)
    await requestRendererQuitPreparation({
      isDestroyed: () => true
    } as unknown as BrowserWindow, createChannel)
    await requestRendererQuitPreparation({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => true
      }
    } as unknown as BrowserWindow, createChannel)

    expect(createChannel).not.toHaveBeenCalled()
  })
})
