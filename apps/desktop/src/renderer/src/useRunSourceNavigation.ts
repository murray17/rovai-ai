import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ThreadMessageAroundSnapshot, ThreadMessageView } from '@contracts'
import { useThreadClient } from './camp-client'
import { prefersReducedMotion } from './reduced-motion'

type SourceState = {
  threadId: string
  messages: ThreadMessageView[]
  loading: string | null
  unavailable: ReadonlySet<string>
  error: string | null
}
const emptyState = (threadId: string): SourceState => ({ threadId, messages: [], loading: null,
  unavailable: new Set(), error: null })

/** One bounded, user-requested source window. It never changes the Composer or Run. */
export function useRunSourceNavigation(threadId: string, messages: readonly ThreadMessageView[],
  viewportRef: RefObject<HTMLElement | null>, ensureMounted?: (id: string) => Promise<HTMLElement | null>) {
  const client = useThreadClient()
  const [state, setState] = useState(() => emptyState(threadId))
  const current = useRef({ threadId, messages })
  current.current = { threadId, messages }
  const generation = useRef(0)
  const cancel = useCallback(() => {
    generation.current++
    setState(value => ({ ...value, loading: null }))
  }, [])
  useLayoutEffect(() => {
    setState(emptyState(threadId))
    return () => { generation.current++ }
  }, [threadId])

  const reveal = async (runId: string, messageId: string, displayed: ReadonlyMap<string, ThreadMessageView>): Promise<void> => {
    const viewport = viewportRef.current
    const origin = viewport?.querySelector<HTMLElement>(`[data-presence-run="${CSS.escape(runId)}"]`)
    if (!viewport || !origin) return
    const ticket = ++generation.current
    const valid = (): boolean => current.current.threadId === threadId && generation.current === ticket
    setState(value => ({ ...value, loading: messageId, error: null }))
    const unavailable = (): void => {
      if (valid()) setState(value => ({ ...value, loading: null,
        unavailable: new Set(value.unavailable).add(messageId) }))
    }
    try {
      let source = displayed.get(messageId)
      if (source?.withdrawn) { unavailable(); return }
      if (!source) {
        const result = await client.request<ThreadMessageAroundSnapshot>('thread.messages.around', { threadId, messageId })
        if (!valid()) return
        if (result.schemaVersion !== 1 || result.threadId !== threadId || result.anchorMessageId !== messageId) {
          throw new Error('source.owner_mismatch')
        }
        source = result.messages.find(message => message.id === messageId)
        if (!result.sourceAvailable || !source || source.withdrawn) { unavailable(); return }
        const latest = current.current.messages.find(message => message.id === messageId)
        if (latest?.withdrawn) { unavailable(); return }
        if (latest && latest.version > source.version) throw new Error('source.stale_window')
        setState(value => ({ ...value, messages: result.messages }))
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (!valid()) return
      await ensureMounted?.(messageId)
      if (!valid()) return
      if (current.current.messages.find(message => message.id === messageId)?.withdrawn) { unavailable(); return }
      const target = viewport.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
      if (!target || !viewport.isConnected || viewport.clientHeight === 0) throw new Error('source.not_rendered')
      const bounds = target.getBoundingClientRect()
      const top = viewport.scrollTop + bounds.top - viewport.getBoundingClientRect().top
        - Math.max(18, (viewport.clientHeight - bounds.height) / 2)
      target.focus({ preventScroll: true })
      viewport.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() || target.closest('[data-timeline-key]') ? 'instant' : 'smooth' })
      setState(value => ({ ...value, loading: null }))
    } catch {
      if (valid()) setState(value => ({ ...value, loading: null, error: messageId }))
    }
  }
  const visible = state.threadId === threadId ? state : emptyState(threadId)
  return { ...visible, reveal, cancel }
}
