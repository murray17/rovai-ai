export type ExecutionStatusShape =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'skipped'
  | 'queued'
  | 'cancelling'
  | 'recorded'

/** One status-shape grammar shared by tool rows, Run history, and the execution console. */
export function ExecutionStatusGlyph({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'running':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" opacity=".35" /><path d="M8 2.8A5.2 5.2 0 0 1 13.2 8" strokeWidth="1.8" /><circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" /></svg>
    case 'waiting':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" /><path d="M6.4 5.5v5m3.2-5v5" /></svg>
    case 'completed':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.25" /><path d="m5.3 8.1 1.75 1.8 3.75-4" /></svg>
    case 'failed':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.4 13.6 8 8 13.6 2.4 8Z" /><path d="m6.15 6.15 3.7 3.7m0-3.7-3.7 3.7" /></svg>
    case 'stopped':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" /><rect x="6" y="6" width="4" height="4" rx=".4" fill="currentColor" stroke="none" /></svg>
    case 'skipped':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" /><path d="M5.25 8h5.5" /></svg>
    case 'queued':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" /><path d="M8 4.5V8l2.3 1.4" /></svg>
    case 'cancelling':
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" opacity=".35" /><path d="M8 2.8A5.2 5.2 0 0 1 13.2 8" strokeWidth="1.8" /></svg>
    default:
      return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" /><path d="M8 7.5v3.2" /><circle cx="8" cy="5.15" r=".65" fill="currentColor" stroke="none" /></svg>
  }
}
