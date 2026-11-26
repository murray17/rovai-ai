import type { ChannelMemberBotView, ChannelKind } from '@contracts'

type RosterIssue = NonNullable<ChannelMemberBotView['rosterIssue']>

/** Share platform reads for the same group. Core owns pending inbound messages. */
export class ChannelRosterQueries {
  readonly #running = new Map<string, Promise<boolean>>()
  readonly #failures = new Map<string, { attempts: number; retryAt: number }>()
  readonly issues = new Map<string, RosterIssue>()
  #generation = 0

  constructor(private readonly now: () => number, private readonly wakeAfter: (ms: number) => void) {}

  run(tenant: string, chat: string, read: () => Promise<boolean>): Promise<boolean> {
    const key = JSON.stringify([tenant, chat])
    const running = this.#running.get(key)
    if (running) return running
    const failed = this.#failures.get(key)
    if (failed && failed.retryAt > this.now()) return Promise.resolve(false)
    const generation = this.#generation
    const result = Promise.resolve().then(read).catch(() => false).then(ok => {
      if (this.#generation !== generation) return false
      if (ok) this.#failures.delete(key)
      else {
        const attempts = (failed?.attempts ?? 0) + 1
        const delay = [5_000, 15_000, 60_000, 300_000][Math.min(attempts, 4) - 1]
        this.#failures.set(key, { attempts, retryAt: this.now() + delay })
        this.wakeAfter(delay)
      }
      return ok
    }).finally(() => {
      if (this.#running.get(key) === result) this.#running.delete(key)
    })
    this.#running.set(key, result)
    return result
  }

  waitForInboundRetry(tenant: string, chat: string): boolean {
    const failure = this.#failures.get(JSON.stringify([tenant, chat]))
    if (failure?.attempts !== 1) return false
    // An earlier idle tick may have cancelled a retry scheduled by a picker click.
    this.wakeAfter(Math.max(0, failure.retryAt - this.now()))
    return true
  }

  setIssue(provider: ChannelKind, agentId: string, issue?: RosterIssue): boolean {
    if (!issue) return this.issues.delete(agentId)
    if (this.issues.get(agentId) === issue) return false
    this.issues.set(agentId, issue)
    console.warn('[rovai] Group roster access failed', { provider, agentId, issue })
    return true
  }

  clear(): void {
    this.issues.clear()
    this.#generation++
    this.#running.clear()
    this.#failures.clear()
  }
}
