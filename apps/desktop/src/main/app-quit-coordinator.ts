export type AppQuitReason = 'normal' | 'update_install'

export interface PreventableQuitEvent {
  preventDefault(): void
}

interface AppQuitCoordinatorOptions {
  updateInstallPending(): boolean
  beforeDrain(reason: AppQuitReason): void
  drain(): Promise<void>
  finish(reason: AppQuitReason): void
  reportFailure(error: unknown): void
}

/**
 * Freezes the first native quit reason, runs the bounded Core drain once, then
 * lets Main perform the terminal exit. The updater must be triggered before
 * this coordinator sees before-quit so a synchronous installer failure leaves
 * the still-running App and Core available for retry.
 */
export class AppQuitCoordinator {
  readonly #options: AppQuitCoordinatorOptions
  #started = false
  #completed = false
  #reason: AppQuitReason | null = null

  constructor(options: AppQuitCoordinatorOptions) {
    this.#options = options
  }

  handleBeforeQuit(event: PreventableQuitEvent): void {
    if (this.#completed) return
    event.preventDefault()
    if (this.#started) return

    this.#started = true
    this.#reason = this.#options.updateInstallPending() ? 'update_install' : 'normal'
    this.#options.beforeDrain(this.#reason)
    void this.#options.drain()
      .catch((error) => this.#options.reportFailure(error))
      .finally(() => {
        this.#completed = true
        this.#options.finish(this.#reason ?? 'normal')
      })
  }
}
