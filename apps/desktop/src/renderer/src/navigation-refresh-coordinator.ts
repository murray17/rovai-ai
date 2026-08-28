export const NAVIGATION_REFRESH_DEBOUNCE_MS = 80
export const NAVIGATION_REFRESH_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const

export type NavigationRefreshTrigger = 'invalidation' | 'poll' | 'foreground' | 'explicit'

export interface NavigationRefreshCoordinator {
  refresh(trigger?: NavigationRefreshTrigger): Promise<void>
  setVisible(visible: boolean): void
  dispose(): void
}

interface NavigationRefreshCycle {
  promise: Promise<void>
  resolve(): void
  reject(error: unknown): void
}

export interface NavigationRefreshCoordinatorOptions {
  debounceMs?: number
  retryDelaysMs?: readonly number[]
  initiallyVisible?: boolean
}

export function createNavigationRefreshCoordinator(
  readAndCommitNavigation: () => Promise<void>,
  options: NavigationRefreshCoordinatorOptions = {}
): NavigationRefreshCoordinator {
  const debounceMs = options.debounceMs ?? NAVIGATION_REFRESH_DEBOUNCE_MS
  const retryDelaysMs = options.retryDelaysMs ?? NAVIGATION_REFRESH_RETRY_DELAYS_MS
  if (debounceMs < 0) throw new Error('Navigation refresh debounce must not be negative')
  if (retryDelaysMs.length === 0 || retryDelaysMs.some((delay) => delay < 0)) {
    throw new Error('Navigation refresh retries require non-negative delays')
  }

  let requestedGeneration = 0
  let completedGeneration = 0
  let cycle: NavigationRefreshCycle | null = null
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null
  let scheduledKind: 'debounce' | 'retry' | null = null
  let inFlight = false
  let visible = options.initiallyVisible ?? true
  let retryPending = false
  let consecutiveFailures = 0
  let forceThroughGeneration = 0
  let disposed = false

  const ensureCycle = (): NavigationRefreshCycle => {
    if (cycle) return cycle
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    })
    // Internal retries can exist without a public waiter. Observe every cycle here while
    // returning the original Promise so explicit callers still receive its rejection.
    void promise.catch(() => undefined)
    cycle = { promise, resolve, reject }
    return cycle
  }

  const clearScheduled = (): void => {
    if (scheduledTimer !== null) clearTimeout(scheduledTimer)
    scheduledTimer = null
    scheduledKind = null
  }

  const resolveCycle = (): void => {
    const completedCycle = cycle
    cycle = null
    forceThroughGeneration = 0
    retryPending = false
    consecutiveFailures = 0
    completedCycle?.resolve()
  }

  const retryDelay = (): number => retryDelaysMs[
    Math.min(Math.max(0, consecutiveFailures - 1), retryDelaysMs.length - 1)
  ] ?? 0

  const scheduleRetry = (startDrain: () => void): void => {
    if (disposed || !visible || scheduledTimer !== null || inFlight) return
    scheduledKind = 'retry'
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      scheduledKind = null
      startDrain()
    }, retryDelay())
  }

  const rejectCycleAndRetainIntent = (
    error: unknown,
    startDrain: () => void
  ): void => {
    const failedCycle = cycle
    cycle = null
    forceThroughGeneration = 0
    retryPending = true
    consecutiveFailures += 1
    ensureCycle()
    failedCycle?.reject(error)
    scheduleRetry(startDrain)
  }

  let startDrain!: () => void

  const drain = async (): Promise<void> => {
    try {
      while (!disposed && completedGeneration < requestedGeneration) {
        if (!visible && completedGeneration >= forceThroughGeneration) return
        const targetGeneration = requestedGeneration
        await readAndCommitNavigation()
        if (disposed) return
        completedGeneration = targetGeneration
      }
      if (!disposed && completedGeneration >= requestedGeneration) resolveCycle()
    } catch (error) {
      if (!disposed) rejectCycleAndRetainIntent(error, startDrain)
    } finally {
      inFlight = false
      if (disposed || completedGeneration >= requestedGeneration || scheduledTimer !== null) return
      if (retryPending) scheduleRetry(startDrain)
      else if (visible || completedGeneration < forceThroughGeneration) startDrain()
    }
  }

  startDrain = (): void => {
    if (
      disposed
      || inFlight
      || completedGeneration >= requestedGeneration
      || (!visible && completedGeneration >= forceThroughGeneration)
    ) return
    clearScheduled()
    inFlight = true
    void drain()
  }

  const scheduleDebouncedDrain = (bypassRetry = false): void => {
    if (disposed || !visible || inFlight || (!bypassRetry && retryPending)) return
    if (scheduledKind === 'debounce') clearScheduled()
    if (scheduledTimer !== null) return
    scheduledKind = 'debounce'
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null
      scheduledKind = null
      startDrain()
    }, debounceMs)
  }

  return {
    refresh(trigger = 'invalidation'): Promise<void> {
      if (disposed) return Promise.reject(new Error('Navigation refresh coordinator is disposed'))
      requestedGeneration += 1
      const requestedCycle = ensureCycle()
      const immediate = trigger === 'foreground' || trigger === 'explicit'
      if (trigger === 'explicit') forceThroughGeneration = requestedGeneration

      if (inFlight) return requestedCycle.promise
      if (immediate) {
        if (trigger === 'foreground' && !visible) return requestedCycle.promise
        clearScheduled()
        startDrain()
      } else if (visible && !retryPending) {
        scheduleDebouncedDrain()
      }
      return requestedCycle.promise
    },

    setVisible(nextVisible: boolean): void {
      if (disposed || visible === nextVisible) return
      visible = nextVisible
      if (!visible) {
        if (scheduledKind === 'debounce' || scheduledKind === 'retry') clearScheduled()
        return
      }
      if (completedGeneration < requestedGeneration && !inFlight) {
        clearScheduled()
        scheduleDebouncedDrain(true)
      }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      clearScheduled()
      const pendingCycle = cycle
      cycle = null
      pendingCycle?.resolve()
    }
  }
}
