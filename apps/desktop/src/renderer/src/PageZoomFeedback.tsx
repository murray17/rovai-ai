import { useEffect, useRef, useState } from 'react'

export const PAGE_ZOOM_FEEDBACK_DURATION_MS = 1_600

export function PageZoomIndicator({
  percentage
}: {
  percentage: number
}): React.JSX.Element {
  return (
    <div
      className="page-zoom-indicator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>页面缩放</span>
      <strong>{percentage}%</strong>
    </div>
  )
}

export function PageZoomFeedback(): React.JSX.Element | null {
  const [percentage, setPercentage] = useState<number | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsubscribe = window.rovai.windowControls.onPageZoomChanged((nextPercentage) => {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
      setPercentage(nextPercentage)
      dismissTimer.current = setTimeout(() => {
        dismissTimer.current = null
        setPercentage(null)
      }, PAGE_ZOOM_FEEDBACK_DURATION_MS)
    })
    return () => {
      unsubscribe()
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
    }
  }, [])

  return percentage === null ? null : <PageZoomIndicator percentage={percentage} />
}
