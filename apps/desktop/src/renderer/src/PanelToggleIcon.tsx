export function PanelToggleIcon({
  side,
  visible
}: {
  side: 'left' | 'right'
  visible: boolean
}): React.JSX.Element {
  const edgePath = side === 'left' ? 'M5 4v12' : 'M15 4v12'
  const arrowPath = side === 'left'
    ? visible ? 'm14.5 6-4 4 4 4' : 'm10.5 6 4 4-4 4'
    : visible ? 'm5.5 6 4 4-4 4' : 'm9.5 6-4 4 4 4'

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={edgePath} />
      <path d={arrowPath} />
    </svg>
  )
}
