import { useLayoutEffect, useRef } from 'react'

// Radix keeps the dialog mounted for its exit animation after its open state changes.
export function useClosingSnapshot<T>(open: boolean, value: T): T {
  const lastOpenValue = useRef(value)
  useLayoutEffect(() => {
    if (open) lastOpenValue.current = value
  }, [open, value])
  return open ? value : lastOpenValue.current
}
