export function ForkIcon({ className }: { className?: string }): React.JSX.Element {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" />
    <path d="M6 7v10m12-10v1a4 4 0 0 1-4 4h-4a4 4 0 0 0-4 4" />
  </svg>
}
