import type { CoreEvent } from '@contracts'
import { liveRuntimeEventFromCore } from '../shared/execution-presentation'

export const CHANNEL_HOST_WATCHDOG_MS = 10 * 60_000
export const CHANNEL_HOST_EVENT_DEBOUNCE_MS = 500
export const CHANNEL_TERMINAL_QUIET_WAKE_MS = 1_000

type TimerHandle = ReturnType<typeof globalThis.setTimeout>
export type ChannelHostCoreEventWake = 'ignore' | 'immediate' | 'debounced' | 'terminal'

export function trackedExecutionCoreEventWake(
  event: CoreEvent,
  hasLiveExecutionCard: (agentRunId: string) => boolean
): ChannelHostCoreEventWake {
  if (event.method === 'agent_run.started') return 'immediate'
  if (event.method === 'agent_run.terminal') return 'terminal'
  if (event.method === 'runtime.compaction.display') return 'ignore'
  const liveEvent = liveRuntimeEventFromCore(event, 'channel-host-wake')
  if (!liveEvent) return 'ignore'
  return hasLiveExecutionCard(liveEvent.agentRunId) ? 'debounced' : 'ignore'
}

export type AdaptiveChannelHostPumpDependencies = {
  run(): Promise<boolean>
  onError(error: unknown): void
  classifyCoreEvent?(event: CoreEvent): ChannelHostCoreEventWake
  now?: () => number
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

/**
 * Coalesces durable Core maintenance behind channel activity. Core remains the
 * level-triggered source of truth; this scheduler only decides when to ask it.
 */
export class AdaptiveChannelHostPump {
  readonly #dependencies: AdaptiveChannelHostPumpDependencies
  readonly #now: () => number
  readonly #setTimeout: typeof globalThis.setTimeout
  readonly #clearTimeout: typeof globalThis.clearTimeout
  readonly #followupTimers = new Set<TimerHandle>()
  #watchdogTimer: TimerHandle | null = null
  #eventTimer: TimerHandle | null = null
  #immediateQueued = false
  #pumping = false
  #pumpAgain = false
  #active = false
  #stopped = true
  #generation = 0

  constructor(dependencies: AdaptiveChannelHostPumpDependencies) {
    this.#dependencies = dependencies
    this.#now = dependencies.now ?? Date.now
    this.#setTimeout = dependencies.setTimeout ?? globalThis.setTimeout
    this.#clearTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout
  }

  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#generation += 1
    // One startup probe recovers persisted work after an App/Core restart. A
    // clean result leaves the provider dormant with no periodic timer.
    this.#requestImmediate()
  }

  stop(): void {
    this.#generation += 1
    this.#stopped = true
    this.#active = false
    this.#pumpAgain = false
    this.#clearWatchdog()
    if (this.#eventTimer) {
      this.#clearTimeout(this.#eventTimer)
      this.#eventTimer = null
    }
    this.#clearFollowups()
  }

  wake(): void {
    if (this.#stopped) return
    this.#active = true
    this.#requestImmediate()
  }

  handleCoreEvent(event: CoreEvent): void {
    if (this.#stopped || !this.#active) return
    const wake = this.#dependencies.classifyCoreEvent?.(event) ?? defaultCoreEventWake(event)
    if (wake === 'terminal') {
      this.#requestImmediate()
      this.wakeAfter(CHANNEL_TERMINAL_QUIET_WAKE_MS)
      return
    }
    if (wake === 'immediate') {
      this.#requestImmediate()
      return
    }
    if (wake !== 'debounced') return
    if (this.#eventTimer) return
    this.#eventTimer = this.#schedule(() => {
      this.#eventTimer = null
      this.#requestImmediate()
    }, CHANNEL_HOST_EVENT_DEBOUNCE_MS)
  }

  wakeAt(availableAt: string): void {
    const timestamp = Date.parse(availableAt)
    if (!Number.isFinite(timestamp)) return
    this.wakeAfter(Math.max(0, timestamp - this.#now()))
  }

  wakeAfter(delayMs: number): void {
    if (this.#stopped) return
    this.#active = true
    const timer = this.#schedule(() => {
      this.#followupTimers.delete(timer)
      this.#requestImmediate()
    }, Math.max(0, delayMs))
    this.#followupTimers.add(timer)
  }

  #requestImmediate(): void {
    if (this.#stopped) return
    if (this.#pumping) {
      this.#pumpAgain = true
      return
    }
    if (this.#immediateQueued) return
    this.#immediateQueued = true
    queueMicrotask(() => {
      this.#immediateQueued = false
      if (!this.#stopped) void this.#drain()
    })
  }

  async #drain(): Promise<void> {
    if (this.#pumping || this.#stopped) return
    const generation = this.#generation
    this.#pumping = true
    try {
      do {
        this.#pumpAgain = false
        try {
          const hasOutstandingWork = await this.#dependencies.run()
          if (this.#stopped || generation !== this.#generation) return
          this.#active = hasOutstandingWork
          if (hasOutstandingWork) this.#armWatchdog()
          else {
            this.#clearWatchdog()
            this.#clearFollowups()
          }
        } catch (error) {
          if (this.#stopped || generation !== this.#generation) return
          this.#active = true
          this.#armWatchdog()
          this.#dependencies.onError(error)
        }
      } while (this.#pumpAgain && !this.#stopped)
    } finally {
      this.#pumping = false
      const rerun = this.#pumpAgain && !this.#stopped
      this.#pumpAgain = false
      if (rerun) this.#requestImmediate()
    }
  }

  #armWatchdog(): void {
    this.#clearWatchdog()
    this.#watchdogTimer = this.#schedule(() => {
      this.#watchdogTimer = null
      if (this.#active) this.#requestImmediate()
    }, CHANNEL_HOST_WATCHDOG_MS)
  }

  #clearWatchdog(): void {
    if (!this.#watchdogTimer) return
    this.#clearTimeout(this.#watchdogTimer)
    this.#watchdogTimer = null
  }

  #clearFollowups(): void {
    for (const timer of this.#followupTimers) this.#clearTimeout(timer)
    this.#followupTimers.clear()
  }

  #schedule(callback: () => void, delayMs: number): TimerHandle {
    const timer = this.#setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  }
}

function defaultCoreEventWake(event: CoreEvent): ChannelHostCoreEventWake {
  if (event.method === 'agent_run.terminal') return 'terminal'
  if (event.method.startsWith('agent_run.')) return 'immediate'
  return event.method.startsWith('runtime.') ? 'debounced' : 'ignore'
}
