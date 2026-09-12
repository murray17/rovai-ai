/** Closed Main-owned errors: never carry remote messages or credential-bearing URLs. */
export class DingTalkConsoleError extends Error {
  constructor(code: string, readonly definitelyRejected = false) {
    super(code)
    this.name = 'DingTalkConsoleError'
  }
}

export function requireDingTalkActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof DingTalkConsoleError
    ? signal.reason : new DingTalkConsoleError('dingtalk_operation_cancelled')
}

/** Cookie and native page operations do not all implement AbortSignal. */
export function dingTalkAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort)
      try { requireDingTalkActive(signal) } catch (error) { reject(error) }
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(value => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) abort()
      else resolve(value)
    }, error => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) abort()
      else reject(error)
    })
    if (signal.aborted) abort()
  })
}

export function dingTalkDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  requireDingTalkActive(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      try { requireDingTalkActive(signal) } catch (error) { reject(error) }
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function dingTalkDeadline(parent: AbortSignal, milliseconds: number, code: string): {
  signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DingTalkConsoleError(code)), milliseconds)
  return { signal: AbortSignal.any([parent, controller.signal]), dispose: () => clearTimeout(timer) }
}
