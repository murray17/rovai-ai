export interface HtmlPreviewDescriptor {
  previewId: string
  generation: string
  origin: string
  entryUrl: string
  documentUrl: string
}

export type HtmlPreviewDiagnosticKind = 'script' | 'promise' | 'resource' | 'policy' | 'document' | 'channel'
export interface HtmlPreviewDiagnostic {
  previewId: string
  generation: string
  kind: HtmlPreviewDiagnosticKind
  message: string
  resourceUrl: string | null
  line: number | null
  column: number | null
  stack: string | null
  timestamp: string
}

export const HTML_PREVIEW_DIAGNOSTIC_LIMIT = 100

export function parseHtmlPreviewDiagnostic(value: unknown, preview: Pick<HtmlPreviewDescriptor, 'previewId' | 'generation'>): HtmlPreviewDiagnostic | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.previewId !== preview.previewId || item.generation !== preview.generation
    || !['script', 'promise', 'resource', 'policy', 'document', 'channel'].includes(String(item.kind))
    || typeof item.message !== 'string' || !item.message || item.message.length > 2000
    || !(item.resourceUrl === null || (typeof item.resourceUrl === 'string' && item.resourceUrl.length <= 2048))
    || !(item.stack === null || (typeof item.stack === 'string' && item.stack.length <= 8000))
    || ![item.line, item.column].every(number => number === null || (Number.isSafeInteger(number) && (number as number) > 0))
    || typeof item.timestamp !== 'string' || item.timestamp.length > 40 || !Number.isFinite(Date.parse(item.timestamp))) return null
  return {
    previewId: preview.previewId, generation: preview.generation,
    kind: item.kind as HtmlPreviewDiagnosticKind, message: item.message,
    resourceUrl: item.resourceUrl as string | null, line: item.line as number | null,
    column: item.column as number | null, stack: item.stack as string | null, timestamp: item.timestamp
  }
}

export function htmlPreviewDiagnosticKey(item: HtmlPreviewDiagnostic): string {
  return item.kind === 'resource' && item.resourceUrl
    ? JSON.stringify([item.kind, item.resourceUrl])
    : JSON.stringify([item.kind, item.message, item.resourceUrl, item.line, item.column])
}

export function validPreviewOrigin(preview: HtmlPreviewDescriptor, hostOrigin: string): boolean {
  try {
    if (![preview.previewId, preview.generation].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128)
      || preview.entryUrl.length > 8192 || preview.documentUrl.length > 8192) return false
    const origin = new URL(preview.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.origin === preview.origin
      && origin.origin !== hostOrigin && new URL(preview.entryUrl).origin === origin.origin
      && new URL(preview.documentUrl).origin === origin.origin
  } catch { return false }
}
