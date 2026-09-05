import { describe, expect, it, vi } from 'vitest'
import { createWindowCloseHandler } from './window-close-guard'

function closeFixture(prepare: () => Promise<void>) {
  let destroyed = false
  const reportFailure = vi.fn()
  const close = vi.fn(() => {
    const event = { preventDefault: vi.fn() }
    handleClose(event)
    if (event.preventDefault.mock.calls.length === 0) destroyed = true
  })
  const handleClose = createWindowCloseHandler(
    { close, isDestroyed: () => destroyed }, prepare, reportFailure
  )
  return { close, reportFailure, isDestroyed: () => destroyed, destroy: () => { destroyed = true } }
}

describe('close-only Renderer fence', () => {
  it('keeps the window alive until preparation completes and coalesces repeated native closes', async () => {
    let prepared!: () => void
    const prepare = vi.fn(() => new Promise<void>((resolve) => { prepared = resolve }))
    const window = closeFixture(prepare)

    window.close()
    window.close()
    expect(window.isDestroyed()).toBe(false)
    expect(prepare).toHaveBeenCalledOnce()

    prepared()
    await vi.waitFor(() => expect(window.isDestroyed()).toBe(true))
    expect(prepare).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledTimes(3)
    expect(window.reportFailure).not.toHaveBeenCalled()
  })

  it('keeps a failed Draft mounted and prepares again on the next close', async () => {
    const failure = new Error('Draft save failed')
    const prepare = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const window = closeFixture(prepare)

    window.close()
    await vi.waitFor(() => expect(window.reportFailure).toHaveBeenCalledWith(failure))
    expect(window.isDestroyed()).toBe(false)

    window.close()
    await vi.waitFor(() => expect(window.isDestroyed()).toBe(true))
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('does not touch a window destroyed during preparation', async () => {
    let prepared!: () => void
    const window = closeFixture(() => new Promise<void>((resolve) => { prepared = resolve }))
    window.close()
    window.destroy()
    prepared()
    await Promise.resolve()
    expect(window.close).toHaveBeenCalledOnce()
    expect(window.reportFailure).not.toHaveBeenCalled()
  })

  it('allows exactly the resumed close even when the native event is delivered later', async () => {
    const close = vi.fn()
    const prepare = vi.fn(async () => undefined)
    const handleClose = createWindowCloseHandler({ close, isDestroyed: () => false }, prepare, vi.fn())
    handleClose({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())

    const resumed = { preventDefault: vi.fn() }
    handleClose(resumed)
    expect(resumed.preventDefault).not.toHaveBeenCalled()
    // If another native listener vetoed that close, the next attempt must prepare anew.
    const retried = { preventDefault: vi.fn() }
    handleClose(retried)
    expect(retried.preventDefault).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledTimes(2)
  })
})
