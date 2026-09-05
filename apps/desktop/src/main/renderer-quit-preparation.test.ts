import { EventEmitter } from 'node:events'
import type { BrowserWindow, MessageChannelMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { APP_PREPARE_QUIT_CHANNEL } from '../shared/app-lifecycle'
import { requestRendererQuitPreparation } from './renderer-quit-preparation'
import { AppQuitCoordinator } from './app-quit-coordinator'
import { createWindowCloseHandler } from './window-close-guard'

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

  it.each(['window-close', 'app-quit'] as const)(
    'shares preparation when %s is followed by the other request',
    async (firstRequest) => {
      const { port1, channel } = testChannel()
      const postMessage = vi.fn()
      const window = testWindow(postMessage)
      const prepare = () => requestRendererQuitPreparation(window, () => channel)
      const drain = vi.fn(async () => undefined)
      const finish = vi.fn()
      const reportFailure = vi.fn()
      const quit = new AppQuitCoordinator({
        updateInstallPending: () => false,
        beforeDrain: vi.fn(),
        prepareRenderer: prepare,
        drain,
        finish,
        reportPreparationFailure: reportFailure,
        reportFailure
      })
      const closed = vi.fn()
      const close = createWindowCloseHandler({ close: closed, isDestroyed: () => false }, prepare, reportFailure)
      const closeEvent = { preventDefault: vi.fn() }
      const quitEvent = { preventDefault: vi.fn() }

      if (firstRequest === 'window-close') {
        close(closeEvent)
        expect(drain).not.toHaveBeenCalled()
        quit.handleQuitRequest(quitEvent)
      } else {
        quit.handleQuitRequest(quitEvent)
        close(closeEvent)
      }
      expect(postMessage).toHaveBeenCalledOnce()
      expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
      expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
      expect(closed).not.toHaveBeenCalled()
      expect(drain).not.toHaveBeenCalled()

      port1.emit('message', { data: { status: 'prepared' } })
      await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce())
      expect(closed).toHaveBeenCalledOnce()
      expect(drain).toHaveBeenCalledOnce()
      expect(reportFailure).not.toHaveBeenCalled()
    }
  )

  it('clears a rejected shared preparation so both callers can retry', async () => {
    const window = testWindow(vi.fn())
    const failed = testChannel()
    const pending = requestRendererQuitPreparation(window, () => failed.channel)
    expect(requestRendererQuitPreparation(window, () => failed.channel)).toBe(pending)
    failed.port1.emit('message', { data: { status: 'failed', message: 'save failed' } })
    await expect(pending).rejects.toThrow('save failed')

    const retry = testChannel()
    const retried = requestRendererQuitPreparation(window, () => retry.channel)
    expect(retried).not.toBe(pending)
    retry.port1.emit('message', { data: { status: 'prepared' } })
    await retried
  })
})
