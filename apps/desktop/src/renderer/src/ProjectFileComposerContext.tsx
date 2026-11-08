import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { OpenFilePreviewRequest, ProjectFileReferenceAtom } from '@contracts'
import type { ReferenceScope } from './useReferencePicker'
import { createProjectFileReference } from './useProjectFileCandidates'
type Source = Extract<OpenFilePreviewRequest, { kind: 'project_file' }>
interface Target { threadId: string; enabled: boolean; client: ReferenceScope['client']; isEditable(): boolean; beginInsertion(): () => void; insert(atom: ProjectFileReferenceAtom): void }
interface Value {
  target: Target | null
  register(target: Target): () => void
  reference(threadId: string, source: Source | (() => Promise<Source | null>)): Promise<void>
}
const Context = createContext<Value | null>(null)
export function ProjectFileComposerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const current = useRef<Target | null>(null)
  const register = useCallback((next: Target) => {
    current.current = next; setTarget(next)
    return () => { if (current.current === next) { current.current = null; setTarget(null) } }
  }, [])
  const reference = useCallback(async (threadId: string, source: Source | (() => Promise<Source | null>)) => {
    const captured = current.current
    if (!captured?.enabled || !captured.isEditable() || threadId !== captured.threadId) return
    const finish = captured.beginInsertion()
    try {
      const resolved = typeof source === 'function' ? await source() : source
      if (!resolved || resolved.threadId !== captured.threadId) throw new Error('source_unavailable')
      if (current.current !== captured) return
      const atom = await createProjectFileReference(captured.client, captured.threadId, resolved)
      if (current.current === captured) captured.insert(atom)
    } finally { finish() }
  }, [])
  const value = useMemo(() => ({ target, register, reference }), [target, register, reference])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useProjectFileComposer = () => useContext(Context)
