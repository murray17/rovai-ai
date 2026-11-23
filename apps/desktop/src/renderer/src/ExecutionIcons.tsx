/** Shared execution identity; status glyphs keep their own state-specific shapes. */
export function ExecutionStopIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
}

export function RunInputIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 3.5h10v7H7l-3.5 2v-2H3z" /><path d="M5.5 6h5M5.5 8h3" />
  </svg>
}

export function ExecutionIcon({ className }: { className?: string }): React.JSX.Element {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </svg>
}

export function ExecutionOverviewMark({ className }: { className: string }): React.JSX.Element {
  return <span className={className} aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <rect x="14" y="14" width="6" height="6" rx="1.2" />
    </svg>
  </span>
}
