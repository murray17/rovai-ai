/** Error instances and contextBridge-safe failure objects share a string message. */
export function readErrorMessage(error: unknown): string
export function readErrorMessage<Fallback extends string | null>(error: unknown, fallback: Fallback): string | Fallback
export function readErrorMessage(error: unknown, fallback?: string | null): string | null {
  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof error.message === 'string') {
    return error.message
  }
  return fallback === undefined ? String(error) : fallback
}
