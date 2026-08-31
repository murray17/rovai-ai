import type { SupervisorSnapshot } from '@contracts'

type ChannelAuthoritySnapshot = Pick<SupervisorSnapshot, 'generation' | 'fullCoreState'> & {
  capabilities: Pick<SupervisorSnapshot['capabilities'], 'authoritativeWorkspace' | 'coreRequests'>
}

/** Channel Hosts own live transports only while the same Core generation is authoritative. */
export class ChannelHostLifecycle {
  readonly #host: { start(): Promise<void>; stop(): Promise<void> }
  #requestedGeneration: number | null = null
  #mayBeRunning = false
  #closed = false
  #transition: Promise<void> = Promise.resolve()

  constructor(host: { start(): Promise<void>; stop(): Promise<void> }) {
    this.#host = host
  }

  update(snapshot: ChannelAuthoritySnapshot): Promise<void> {
    if (this.#closed) return this.#transition
    const generation = snapshot.fullCoreState === 'ready'
      && snapshot.capabilities.authoritativeWorkspace && snapshot.capabilities.coreRequests
      ? snapshot.generation : null
    if (generation === this.#requestedGeneration) return this.#transition
    this.#requestedGeneration = generation
    const transition = this.#transition.then(async () => {
      if (this.#closed || this.#requestedGeneration !== generation) return
      await this.#stopHost()
      if (generation === null || this.#closed || this.#requestedGeneration !== generation) return
      this.#mayBeRunning = true
      try {
        await this.#host.start()
      } catch (error) {
        await this.#stopHost()
        throw error
      }
      if (this.#closed || this.#requestedGeneration !== generation) await this.#stopHost()
    })
    // A failed optional Host must not poison later Core generations or desktop shutdown.
    this.#transition = transition.catch(() => undefined)
    return transition
  }

  stop(): Promise<void> {
    this.#closed = true
    this.#requestedGeneration = null
    const transition = this.#transition.then(() => this.#stopHost())
    this.#transition = transition.catch(() => undefined)
    return transition
  }

  async #stopHost(): Promise<void> {
    if (!this.#mayBeRunning) return
    await this.#host.stop()
    this.#mayBeRunning = false
  }
}
