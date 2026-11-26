import { useRef, useState } from 'react'

type AutomationAction = { kind: 'create' } | { kind: 'run' | 'enabled' | 'delete'; id: string }

export function useAutomationAction(onError: (error: unknown) => void) {
  const pending = useRef(false)
  const [action, setAction] = useState<AutomationAction | null>(null)

  async function runAction(next: AutomationAction, perform: () => Promise<void>): Promise<void> {
    if (pending.current) return
    pending.current = true
    setAction(next)
    try {
      await perform()
    } catch (error) {
      onError(error)
    } finally {
      pending.current = false
      setAction(null)
    }
  }

  return { action, runAction }
}
