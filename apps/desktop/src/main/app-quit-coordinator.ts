export type AppQuitReason = 'normal' | 'update_install'

export interface PreventableQuitEvent {
  preventDefault(): void
}

interface AppQuitCoordinatorOptions {
  updateInstallPending(): boolean
  beforeDrain(reason: AppQuitReason): void
  prepareRenderer(): Promise<void>
  drain(): Promise<void>
  finish(reason: AppQuitReason): void
  reportPreparationFailure(error: unknown): void
  reportFailure(error: unknown): void
}

/**
 * Freezes the first native quit reason, prepares the live Renderer, runs the
 * bounded Core drain once, then lets Main perform the terminal exit. The
 * updater must be triggered before this coordinator sees the quit request so a
 * synchronous installer failure leaves the still-running App and Core
 * available for retry.
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
    this.handleQuitRequest(event)
  }

  handleQuitRequest(event: PreventableQuitEvent): void {
    if (this.#completed) return
    event.preventDefault()
    if (this.#started) return

    this.#started = true
    this.#reason = this.#options.updateInstallPending() ? 'update_install' : 'normal'
    try {
      this.#options.beforeDrain(this.#reason)
    } catch (error) {
      this.#started = false
      this.#reason = null
      this.#options.reportPreparationFailure(error)
      return
    }
    void this.#prepareAndDrain(this.#reason)
  }

  async #prepareAndDrain(reason: AppQuitReason): Promise<void> {
    try {
      await this.#options.prepareRenderer()
    } catch (error) {
      this.#started = false
      this.#reason = null
      this.#options.reportPreparationFailure(error)
      return
    }

    try {
      await this.#options.drain()
    } catch (error) {
      this.#options.reportFailure(error)
    } finally {
      this.#completed = true
      this.#options.finish(this.#reason ?? reason)
    }
  }
}
