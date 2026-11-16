import type { LarkChannel, LarkChannelConnectionCause } from '@larksuiteoapi/node-sdk'

export type BotConnectionStatus = 'unknown' | 'connecting' | 'reconnecting' | 'online' | 'offline'
export type BotConnectionFailure = { code: string; retryable: boolean; delay?: number }

/** Owns attempts before first ready; the SDK owns a connected transport's retries.
 * The channel (HTTP sender and dedup cache) lives through transport replacement. */
export class BotConnection {
  status: BotConnectionStatus = 'unknown'
  failureCode: string | null = null
  needsAttention = false
  terminal = false
  #stopped = false
  #generation = 0
  #attempt: Promise<void> | null = null
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #watchdog: ReturnType<typeof setTimeout> | undefined
  #attentionTimer: ReturnType<typeof setTimeout> | undefined
  #cancelAttempt: (() => void) | undefined
  readonly #sdkWaiters = new Set<{ resolve(): void; reject(error: unknown): void }>()
  #attemptCount = 0
  #failedSince: number | null = null
  readonly #unsubscribe: Array<() => void> = []

  constructor(readonly options: {
    channel: LarkChannel
    afterConnect(): Promise<void>
    changed(): void
    now(): number
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
  }) {
    const channel = options.channel
    this.#unsubscribe.push(channel.on('reconnecting', () => {
      if (this.#stopped || this.terminal) return
      this.status = 'reconnecting'
      this.failureCode = null
      options.changed()
    }), channel.on('reconnectAttemptFailed', info => {
      if (this.#stopped || this.terminal) return
      this.failureCode = safeConnectionCode(info.code)
      this.needsAttention = true
      options.changed()
    }), channel.on('reconnected', () => {
      if (this.#stopped || this.terminal) return
      for (const waiter of this.#sdkWaiters) waiter.resolve()
      this.#sdkWaiters.clear()
      this.start()
    }), channel.on('error', error => {
      const cause = error.cause as Partial<LarkChannelConnectionCause> | undefined
      if (!cause?.connection || this.#stopped || this.terminal) return
      for (const waiter of this.#sdkWaiters) waiter.reject(error)
      this.#sdkWaiters.clear()
      ++this.#generation
      this.options.clearTimeout(this.#watchdog)
      this.#cancelAttempt?.()
      this.#attempt = null
      this.#failed(error)
    }))
  }

  start(): void { void this.connect().catch(() => undefined) }

  connect(): Promise<void> {
    if (this.#attempt) return this.#attempt
    if (this.#stopped || this.terminal) return Promise.reject(new Error(this.failureCode ?? 'connection_stopped'))
    this.options.clearTimeout(this.#retryTimer)
    const generation = ++this.#generation
    if (this.status !== 'online') this.status = this.#failedSince === null ? 'connecting' : 'reconnecting'
    this.options.changed()
    const watchdog = new Promise<never>((_, reject) => {
      this.#cancelAttempt = () => reject(new Error('connection_cancelled'))
      this.#watchdog = this.options.setTimeout(() => {
        if (this.#stopped || generation !== this.#generation) return
        try { this.options.channel.cancelConnect() } catch { /* settle the watchdog even if transport disposal fails */ }
        reject(new Error('connection_watchdog_timeout'))
      }, 60_000)
    })
    this.#attempt = Promise.race([this.options.channel.connect(), watchdog])
      .then(async () => {
        this.options.clearTimeout(this.#watchdog)
        if (this.#stopped || generation !== this.#generation) throw new Error('connection_cancelled')
        await this.#waitForSdk()
        if (this.#stopped || generation !== this.#generation) throw new Error('connection_cancelled')
        await this.options.afterConnect()
        await this.#waitForSdk()
        if (this.#stopped || generation !== this.#generation) throw new Error('connection_cancelled')
        this.#healthy()
      }).catch(error => {
        if (!this.#stopped && generation === this.#generation) this.#failed(error)
        throw error
      }).finally(() => {
        if (generation !== this.#generation) return
        this.options.clearTimeout(this.#watchdog)
        this.#watchdog = undefined
        this.#cancelAttempt = undefined
        this.#attempt = null
      })
    return this.#attempt
  }

  #waitForSdk(): Promise<void> {
    if (this.options.channel.getConnectionStatus?.()?.state !== 'reconnecting') return Promise.resolve()
    this.status = 'reconnecting'
    this.options.changed()
    return new Promise((resolve, reject) => this.#sdkWaiters.add({ resolve, reject }))
  }

  #healthy(): void {
    this.status = 'online'
    this.failureCode = null
    this.needsAttention = false
    this.#attemptCount = 0
    this.#failedSince = null
    this.options.clearTimeout(this.#attentionTimer)
    this.options.changed()
  }

  #failed(error: unknown): void {
    const failure = connectionFailure(error)
    const transportOnline = this.options.channel.getConnectionStatus?.()?.state === 'connected'
    this.failureCode = transportOnline && failure.retryable ? 'connection_confirmation_pending' : failure.code
    if (this.terminal || !failure.retryable) {
      this.terminal = true
      this.status = 'offline'
      this.needsAttention = true
      this.options.clearTimeout(this.#retryTimer)
      this.options.clearTimeout(this.#attentionTimer)
      void this.options.channel.disconnect().catch(() => undefined)
    } else {
      this.status = transportOnline ? 'online' : 'reconnecting'
      const now = this.options.now()
      if (this.#failedSince === null) {
        this.#failedSince = now
        this.#attentionTimer = this.options.setTimeout(() => {
          if (this.#stopped || this.#failedSince === null) return
          this.needsAttention = true
          this.options.changed()
        }, 60_000)
      }
      const delays = failure.code === 'provider_unknown' ? [30_000, 60_000, 120_000, 300_000] : [2000, 5000, 10_000, 30_000]
      const delay = Math.max(failure.delay ?? 0, delays[Math.min(this.#attemptCount++, delays.length - 1)])
      this.options.clearTimeout(this.#retryTimer)
      const interval = Math.min(2_147_483_647, Math.max(delays[delays.length - 1], failure.delay ?? 0),
        delay + Math.floor(delay * .1 * Math.random()))
      this.#retryTimer = this.options.setTimeout(() => this.start(), interval)
    }
    this.options.changed()
  }

  async stop(): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    ++this.#generation
    this.#cancelAttempt?.()
    for (const waiter of this.#sdkWaiters) waiter.reject(new Error('connection_cancelled'))
    this.#sdkWaiters.clear()
    this.status = 'offline'
    this.options.clearTimeout(this.#retryTimer)
    this.options.clearTimeout(this.#watchdog)
    this.options.clearTimeout(this.#attentionTimer)
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe()
    await this.options.channel.disconnect().catch(() => undefined)
  }
}

function safeConnectionCode(code: unknown): string {
  if (code === 514 || code === 403) return 'credential_rejected'
  if (code === 1000040350) return 'connection_limit'
  if (code === 429 || code === 99991400) return 'rate_limited'
  if (code === 99991401) return 'ip_not_allowed'
  if (typeof code === 'number') return code === 1 || code === 1000040343 ? 'service_unavailable' : 'provider_unknown'
  return ['handshake_timeout', 'identity_timeout', 'transport_error', 'client_assertion', 'cancelled'].includes(String(code))
    ? String(code) : 'transport_error'
}

export function connectionFailure(error: unknown): BotConnectionFailure {
  const value = error as { code?: string; message?: string; cause?: Partial<LarkChannelConnectionCause> }
  const local = value?.code ?? value?.message ?? ''
  const terminal = ['identity_conflict', 'binding_immutable', 'credential_missing', 'brand_moved', 'binding_missing', 'credential_mismatch']
  if (terminal.some(code => local.includes(code))) return { code: terminal.find(code => local.includes(code))!, retryable: false }
  if (local.includes('member_bot.not_found')) return { code: 'binding_missing', retryable: false }
  const code = value?.code === 'rate_limited' ? 'rate_limited' : safeConnectionCode(value?.cause?.code)
  if (value?.cause?.retryable === false) return { code, retryable: false }
  const delay = Math.max(code === 'connection_limit' ? 120_000 : code === 'rate_limited' ? 30_000 : 0,
    Math.min(2_147_483_647, Math.max(0, Number(value?.cause?.retryAfterMs) || 0)))
  return { code, retryable: true, delay }
}
