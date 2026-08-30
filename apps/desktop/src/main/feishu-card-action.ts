export type FeishuCardActionResponse = {
  toast?: { type: 'info' | 'success' | 'warning' | 'error'; content: string }
}

const PAGE_CALLBACK_BUDGET_MS = 2500

class FeishuPageTimeout extends Error {
  constructor() { super('feishu_card_action_timeout') }
}

/** Reserve time for the SDK to ACK within Feishu's three-second callback window. */
export async function withFeishuPageDeadline<T>(
  operation: (checkDeadline: () => void) => Promise<T>
): Promise<T> {
  const deadline = Date.now() + PAGE_CALLBACK_BUDGET_MS
  const timeoutError = new FeishuPageTimeout()
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const checkDeadline = (): void => {
    if (expired || Date.now() >= deadline) throw timeoutError
  }
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; reject(timeoutError) }, PAGE_CALLBACK_BUDGET_MS)
  })
  try {
    const result = await Promise.race([operation(checkDeadline), timeout])
    checkDeadline()
    return result
  } finally {
    clearTimeout(timer)
  }
}

/** Only allowlisted reasons and a numeric provider code may leave this boundary. */
export function feishuPageFailure(error: unknown): {
  response: FeishuCardActionResponse
  reason: string
  providerCode?: number
} {
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const unavailable = fields.code === 'full_core_unavailable' || fields.code === 'full_core_shutting_down'
  const timeout = error instanceof FeishuPageTimeout || fields.code === 'core_request_timeout'
  const cause = fields.cause && typeof fields.cause === 'object' ? fields.cause as Record<string, unknown> : {}
  const providerCode = typeof cause.code === 'number' && Number.isSafeInteger(cause.code) ? cause.code : undefined
  return {
    reason: unavailable ? 'core_unavailable' : timeout ? 'callback_timeout' : 'card_update_failed',
    ...(providerCode === undefined ? {} : { providerCode }),
    response: { toast: { type: 'error', content: unavailable
      ? 'Rovai 执行服务暂不可用，请检查本机 Rovai 状态后重试'
      : timeout ? '翻页响应超时，请稍后重试' : '执行记录暂时无法翻页，请稍后重试' } }
  }
}
