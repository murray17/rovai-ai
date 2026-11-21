import { useLayoutEffect, useRef, useState, type JSX } from 'react'

export function NavigationTitle({ children, selected = false }: { children: string; selected?: boolean }): JSX.Element {
  const text = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const element = text.current
    if (!element) return
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [children, selected])
  return <span ref={text} className="truncate navigation-title" title={children} data-overflow={overflow || undefined}>{children}</span>
}
