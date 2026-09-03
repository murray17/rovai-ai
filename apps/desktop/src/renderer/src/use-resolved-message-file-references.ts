import { useEffect, useMemo, useState } from 'react'
import type { ResolveMessageFileReferencesRequest } from '@contracts'
import { projectInlineFileReferenceCandidates } from './safe-markdown-model'

const EMPTY_REFERENCES: ReadonlySet<string> = new Set()

export type MessageFileReferenceSource = Pick<
  ResolveMessageFileReferencesRequest,
  'campId' | 'messageId'
>

export function useResolvedMessageFileReferences(
  source: MessageFileReferenceSource | undefined,
  markdown: string,
  enabled: boolean
): ReadonlySet<string> {
  const candidates = useMemo(
    () => enabled ? projectInlineFileReferenceCandidates(markdown).slice(0, 64) : [],
    [enabled, markdown]
  )
  const candidateKey = candidates.join('\0')
  const queryKey = source && candidates.length > 0 && !source.messageId.startsWith('optimistic:')
    ? `${source.campId}\0${source.messageId}\0${candidateKey}`
    : ''
  const [resolution, setResolution] = useState<{
    queryKey: string
    references: ReadonlySet<string>
  }>({ queryKey: '', references: EMPTY_REFERENCES })

  useEffect(() => {
    if (!queryKey || !source) return undefined
    let current = true
    // FilePreviewProvider binds the active Camp in its own mount effect. Probe
    // on the next frame so a child's effect cannot race that sender/Camp gate.
    const frame = window.requestAnimationFrame(() => {
      void window.rovai.filePreview.resolveMessageReferences({
        campId: source.campId,
        messageId: source.messageId,
        rawReferences: candidates
      }).then((result) => {
        if (current) setResolution({ queryKey, references: new Set(result.resolvedReferences) })
      }).catch(() => {
        if (current) setResolution({ queryKey, references: EMPTY_REFERENCES })
      })
    })
    return () => {
      current = false
      window.cancelAnimationFrame(frame)
    }
  }, [candidateKey, queryKey, source?.campId, source?.messageId])

  return resolution.queryKey === queryKey ? resolution.references : EMPTY_REFERENCES
}
