import type { WindowCloseBehavior, WindowCloseResponse } from '@contracts'

export const WINDOW_CLOSE_CHANNEL = 'rovai:window-close'
export const WINDOW_CLOSE_CHANGED = 'rovai:window-close-changed'

export function isWindowCloseBehavior(value: unknown): value is WindowCloseBehavior {
  return value === 'ask' || value === 'tray' || value === 'exit'
}

export function parseWindowCloseResponse(value: unknown): WindowCloseResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid window close response')
  const { promptId, action, remember } = value as Record<string, unknown>
  if (!Number.isSafeInteger(promptId) || (promptId as number) < 1
    || (action !== 'tray' && action !== 'exit' && action !== 'cancel')
    || typeof remember !== 'boolean') throw new Error('Invalid window close response')
  return { promptId: promptId as number, action, remember }
}
