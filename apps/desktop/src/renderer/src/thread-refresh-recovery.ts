type ReadSource = 'snapshot' | 'events'

const retryDelays = [1_000, 3_000, 10_000] as const

/** Owns the retry timer and notice for the displayed Thread's current failure. */
export function createThreadRefreshRecovery({
  isCurrent,
  onFailure,
  onExhausted,
  onClear
}: {
  isCurrent(threadId: string): boolean
  onFailure?(error: unknown): void
  onExhausted(threadId: string, retry: () => void): void
  onClear(threadId: string): void
}) {
  let episode: {
    threadId: string
    source: ReadSource
    timer?: ReturnType<typeof setTimeout>
    exhausted: boolean
    complete(): void
    completion: Promise<void>
  } | undefined

  function clear(): void {
    if (!episode) return
    const previous = episode
    episode = undefined
    clearTimeout(previous.timer)
    previous.complete()
    onClear(previous.threadId)
  }

  function recover(threadId: string, source: ReadSource, read: () => Promise<void>, error?: unknown): Promise<void> {
    if (!isCurrent(threadId)) return Promise.resolve()
    if (episode?.threadId === threadId) return episode.completion
    clear()
    onFailure?.(error)

    let complete!: () => void
    const completion = new Promise<void>(resolve => { complete = resolve })
    const current: NonNullable<typeof episode> = { threadId, source, complete, completion, exhausted: false }
    episode = current
    const isLive = (): boolean => episode === current && isCurrent(threadId)
    const schedule = (index: number, delay: number): void => {
      current.timer = setTimeout(() => {
        current.timer = undefined
        void attempt(index)
      }, delay)
    }
    const attempt = async (index: number): Promise<void> => {
      if (!isLive()) { complete(); return }
      try {
        await read()
        if (isLive()) clear()
      } catch {
        if (!isLive()) { complete(); return }
        const delay = retryDelays[index]
        if (delay !== undefined) {
          schedule(index + 1, delay)
          return
        }
        current.exhausted = true
        onExhausted(threadId, () => {
          if (!isLive() || !current.exhausted) return
          current.exhausted = false
          void attempt(0)
        })
      }
      complete()
    }
    schedule(1, retryDelays[0])
    return completion
  }

  return {
    recover,
    isWaitingToRetry: (threadId: string): boolean => episode?.threadId === threadId && episode.timer !== undefined,
    succeeded: (threadId: string, source: ReadSource): void => {
      if (episode?.threadId === threadId && episode.source === source) clear()
    },
    clear
  }
}
