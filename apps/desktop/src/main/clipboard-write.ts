const MAX_CLIPBOARD_TEXT_LENGTH = 1_000_000
const MAX_CLIPBOARD_HTML_LENGTH = 4_000_000

export interface ClipboardWriteData {
  text: string
  html?: string
}

export function parseClipboardWriteRequest(input: unknown): ClipboardWriteData {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Unsupported clipboard write request')
  }
  const candidate = input as Record<string, unknown>
  if (
    typeof candidate.text !== 'string'
    || candidate.text.length > MAX_CLIPBOARD_TEXT_LENGTH
    || (candidate.html !== null && candidate.html !== undefined && typeof candidate.html !== 'string')
    || (typeof candidate.html === 'string' && candidate.html.length > MAX_CLIPBOARD_HTML_LENGTH)
  ) {
    throw new Error('Unsupported clipboard write request')
  }
  return {
    text: candidate.text,
    ...(typeof candidate.html === 'string' ? { html: candidate.html } : {})
  }
}
