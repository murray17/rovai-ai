import type { LarkChannel } from '@larksuiteoapi/node-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BotConnection, connectionFailure } from './bot-connection'

function fixture() {
  const handlers = new Map<string, (value?: any) => void>()
  const channel = {
    on: vi.fn((event, handler) => { handlers.set(event, handler); return () => handlers.delete(event) }),
    connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), cancelConnect: vi.fn(),
    getConnectionStatus: vi.fn(() => ({ state: 'idle' })),
    send: vi.fn(async () => ({ messageId: 'om_http' }))
  }
  const saved = vi.fn(async () => undefined)
  const connection = new BotConnection({
    channel: channel as unknown as LarkChannel, afterConnect: saved,
    changed: vi.fn(), now: () => Date.now(), setTimeout, clearTimeout
  })
  return { channel, connection, handlers, saved }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Bot connection responsibility', () => {
  it('joins concurrent first attempts and preserves the HTTP channel through a retry', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { channel, connection, saved } = fixture()
    channel.connect.mockRejectedValueOnce(new Error('network unavailable'))
    const one = connection.connect()
    const two = connection.connect()
    expect(two).toBe(one)
    await expect(one).rejects.toThrow('network')
    expect(connection.status).toBe('reconnecting')
    await expect(channel.send()).resolves.toEqual({ messageId: 'om_http' })
    expect(channel.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(connection.status).toBe('online')
    expect(saved).toHaveBeenCalledOnce()
    expect(channel.connect).toHaveBeenCalledTimes(2)
    await connection.stop()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(channel.connect).toHaveBeenCalledTimes(2)
  })

  it('waits for an actual SDK failure before prompting and ignores handler errors', async () => {
    vi.useFakeTimers()
    const { connection, handlers, channel } = fixture()
    await connection.connect()
    handlers.get('error')!({ code: 'permission_denied', cause: new Error('message handler error') })
    expect(connection.status).toBe('online')
    handlers.get('reconnecting')!()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(connection.needsAttention).toBe(false)
    expect(channel.connect).toHaveBeenCalledOnce()
    handlers.get('reconnectAttemptFailed')!({ attempt: 1, nextConnectTime: Date.now() + 120_000, code: 1, retryable: true })
    expect(connection.needsAttention).toBe(true)
    handlers.get('reconnected')!()
    await connection.connect()
    expect(connection.needsAttention).toBe(false)
    expect(connection.status).toBe('online')
    await connection.stop()
  })

  it('keeps an SDK-owned recovery pending until real ready without a Host watchdog', async () => {
    vi.useFakeTimers()
    const { connection, handlers, channel, saved } = fixture()
    await connection.connect()
    channel.getConnectionStatus.mockReturnValue({ state: 'reconnecting' })
    handlers.get('reconnecting')!()
    let ready = false
    const waiting = connection.connect().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(ready).toBe(false)
    expect(channel.cancelConnect).not.toHaveBeenCalled()
    expect(saved).toHaveBeenCalledOnce()
    channel.getConnectionStatus.mockReturnValue({ state: 'connected' })
    handlers.get('reconnected')!()
    await waiting
    expect(ready).toBe(true)
    expect(connection.status).toBe('online')
    await connection.stop()
  })

  it('retains an observed live transport while retrying its local confirmation', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { connection, channel, saved } = fixture()
    channel.getConnectionStatus.mockReturnValue({ state: 'connected' })
    saved.mockRejectedValueOnce(new Error('Core unavailable'))
    await expect(connection.connect()).rejects.toThrow('Core unavailable')
    expect(connection.status).toBe('online')
    expect(connection.failureCode).toBe('connection_confirmation_pending')
    expect(channel.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(connection.failureCode).toBeNull()
    await connection.stop()
  })

  it('ends the watchdog at transport readiness even when Core confirmation takes over a minute', async () => {
    vi.useFakeTimers()
    const { connection, channel, saved } = fixture()
    let transportReady!: () => void
    let confirmationSaved!: () => void
    channel.connect.mockImplementationOnce(() => new Promise(resolve => { transportReady = () => resolve(undefined) }))
    saved.mockImplementationOnce(() => new Promise(resolve => { confirmationSaved = () => resolve(undefined) }))
    const attempt = connection.connect()
    await vi.advanceTimersByTimeAsync(50_000)
    channel.getConnectionStatus.mockReturnValue({ state: 'connected' })
    transportReady()
    await vi.advanceTimersByTimeAsync(70_000)
    expect(saved).toHaveBeenCalledOnce()
    expect(channel.cancelConnect).not.toHaveBeenCalled()
    expect(channel.disconnect).not.toHaveBeenCalled()
    confirmationSaved()
    await attempt
    expect(connection.status).toBe('online')
    await connection.stop()
  })

  it('cancels only a stuck attempt at the watchdog and retries with its HTTP channel intact', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { connection, channel } = fixture()
    channel.connect.mockImplementationOnce(() => new Promise(() => {}))
    const pending = expect(connection.connect()).rejects.toThrow('connection_watchdog_timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    await pending
    expect(connection.terminal).toBe(false)
    expect(channel.cancelConnect).toHaveBeenCalledOnce()
    expect(channel.disconnect).not.toHaveBeenCalled()
    await expect(channel.send()).resolves.toEqual({ messageId: 'om_http' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(connection.status).toBe('online')
    await connection.stop()
  })

  it('uses explicit connection classification and pacing rather than the broad permission error label', () => {
    expect(connectionFailure({ code: 'permission_denied', cause: { connection: true, code: 99991400, retryable: true, retryAfterMs: 180_000 } }))
      .toEqual({ code: 'rate_limited', retryable: true, delay: 180_000 })
    expect(connectionFailure({ code: 'permission_denied' })).toMatchObject({ retryable: true })
    expect(connectionFailure({ code: 'permission_denied', cause: { connection: true, code: 99991401, retryable: false } }))
      .toEqual({ code: 'ip_not_allowed', retryable: false })
    expect(connectionFailure({ code: 'feishu_member_bot.not_found' })).toEqual({ code: 'binding_missing', retryable: false })
  })

  it('makes an immutable identity conflict terminal and stops retrying', async () => {
    vi.useFakeTimers()
    const { connection, channel, saved } = fixture()
    saved.mockRejectedValueOnce(Object.assign(new Error('identity mismatch'), { code: 'feishu_member_bot.identity_conflict' }))
    await expect(connection.connect()).rejects.toThrow('identity mismatch')
    expect(connection.terminal).toBe(true)
    expect(connection.status).toBe('offline')
    expect(connection.needsAttention).toBe(true)
    expect(channel.disconnect).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(channel.connect).toHaveBeenCalledOnce()
    await connection.stop()
  })

  it('cancels waiting callers on stop and fences late ready results', async () => {
    vi.useFakeTimers()
    const { channel, connection, saved } = fixture()
    let ready!: () => void
    channel.connect.mockImplementationOnce(() => new Promise(resolve => { ready = () => resolve(undefined) }))
    const attempt = connection.connect()
    const cancelled = expect(attempt).rejects.toThrow('connection_cancelled')
    await connection.stop()
    await cancelled
    ready()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(saved).not.toHaveBeenCalled()
    expect(channel.connect).toHaveBeenCalledOnce()
  })
})
