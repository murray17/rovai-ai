/** One platform request per parent group. Core keeps the durable waiting work. */
export class ChannelRosterQueries {
  readonly #running = new Map<string, Promise<boolean>>()
  readonly #failures = new Map<string, { attempts: number; retryAt: number }>()
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

  clear(): void {
    this.#generation++
    this.#running.clear()
    this.#failures.clear()
  }
}
