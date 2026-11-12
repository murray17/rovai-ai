import { useEffect, useRef, useState } from 'react'
import type { ThreadForkState } from './thread-fork'

/** Smooth only the indicator; command completion and navigation never wait. */
export function useForkLoading(phase: ThreadForkState['phase']): boolean {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef<number | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (phase === 'unknown' || phase === 'rejected') {
      shownAt.current = null
      setVisible(false)
    } else if (phase === 'pending') {
      if (shownAt.current === null) timer = setTimeout(() => {
        shownAt.current = performance.now()
        setVisible(true)
      }, 200)
    } else if (shownAt.current !== null) {
      timer = setTimeout(() => {
        shownAt.current = null
        setVisible(false)
      }, Math.max(0, 600 - (performance.now() - shownAt.current)))
    }
    return () => clearTimeout(timer)
  }, [phase])
  return visible
}
