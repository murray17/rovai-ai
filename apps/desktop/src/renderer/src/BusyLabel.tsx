import type { JSX, ReactNode } from 'react'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'

export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }): JSX.Element {
  return (
    <span className="busy-label" data-busy={busy ? 'true' : undefined}>
      <span className="busy-label-content">{children}</span>
      <span className="busy-label-spinner" aria-hidden="true">
        <ExecutionStatusGlyph status="cancelling" />
      </span>
    </span>
  )
}
