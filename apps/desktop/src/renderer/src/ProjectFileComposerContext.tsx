import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { OpenFilePreviewRequest, ProjectFileReferenceAtom } from '@contracts'
import type { ReferenceScope } from './useReferencePicker'
import { createProjectFileReference } from './useProjectFileCandidates'
interface Target { threadId: string; enabled: boolean; client: ReferenceScope['client']; insert(atom: ProjectFileReferenceAtom): void }
interface Value {
  target: Target | null
  register(target: Target): () => void
  reference(source: Extract<OpenFilePreviewRequest, { kind: 'project_file' }>): Promise<void>
}
const Context = createContext<Value | null>(null)
export function ProjectFileComposerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const current = useRef<Target | null>(null)
  const register = useCallback((next: Target) => {
    current.current = next; setTarget(next)
    return () => { if (current.current === next) { current.current = null; setTarget(null) } }
  }, [])
  const reference = useCallback(async (source: Extract<OpenFilePreviewRequest, { kind: 'project_file' }>) => {
    const captured = current.current
    if (!captured?.enabled || source.threadId !== captured.threadId) return
    const atom = await createProjectFileReference(captured.client, captured.threadId, source)
    if (current.current === captured) captured.insert(atom)
  }, [])
  const value = useMemo(() => ({ target, register, reference }), [target, register, reference])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useProjectFileComposer = () => useContext(Context)
