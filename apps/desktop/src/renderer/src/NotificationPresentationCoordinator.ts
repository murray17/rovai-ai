export interface NotificationPresentationCoordinator {
  waitFor(requestId: number): Promise<boolean>
  complete(requestId: number): boolean
  cancel(): void
}

type Timer = ReturnType<typeof setTimeout>

export function createNotificationPresentationCoordinator(
  timeoutMs = 1_500
): NotificationPresentationCoordinator {
  let pending: {
    requestId: number
    timer: Timer
    resolve(presented: boolean): void
  } | null = null

  const finish = (requestId: number, presented: boolean): boolean => {
    if (!pending || pending.requestId !== requestId) return false
    const current = pending
    pending = null
    clearTimeout(current.timer)
    current.resolve(presented)
    return true
  }

  const cancel = (): void => {
    if (!pending) return
    finish(pending.requestId, false)
  }

  return {
    waitFor(requestId) {
      cancel()
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => finish(requestId, false), timeoutMs)
        pending = { requestId, timer, resolve }
      })
    },
    complete(requestId) {
      return finish(requestId, true)
    },
    cancel
  }
}
