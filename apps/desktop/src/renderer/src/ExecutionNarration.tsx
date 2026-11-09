import { UiText, uiAttribute } from './interface-language'
import { useThreadClient } from './camp-client'
import { useContext, useEffect, useState, type ComponentType } from 'react'
import type { AgentRunExecutionEvidenceView, ResolvedTheme } from '@contracts'
import { ExecutionContentContext } from './ExecutionVirtualList'
import { SafeMarkdown } from './SafeMarkdown'

/** Full narration is read only while its measured row is mounted near the viewport. */
export function ExecutionNarration({ threadId, evidence, preview, Body = SafeMarkdown, theme = 'day', contentComplete = false }: {
  threadId: string; evidence?: AgentRunExecutionEvidenceView; preview: string
  Body?: ComponentType<{ children: string; theme: ResolvedTheme; contentComplete: boolean }>
  theme?: ResolvedTheme; contentComplete?: boolean
}) {
  const client = useThreadClient()
  const cache = useContext(ExecutionContentContext)
  const stamp = `${evidence?.id}:${evidence?.contentBlobId}:${evidence?.contentByteCount}`
  const [body, setBody] = useState<{ stamp: string; text: string } | null>(() => {
    const text = cache?.get<string>(`body:${stamp}`)
    return text === undefined ? null : { stamp, text }
  })
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!evidence?.isTruncated || !evidence.contentBlobId) return undefined
    const cached = cache?.get<string>(`body:${stamp}`)
    if (cached !== undefined) { setBody({ stamp, text: cached }); return undefined }
    let disposed = false
    setFailed(false)
    const read = async () => {
      const result = await client.request<{ payload: { text?: string } }>('agentRunEvidence.getContent', { threadId, evidenceId: evidence.id })
      if (typeof result.payload.text !== 'string') throw new Error(uiAttribute('执行正文格式不兼容'))
      return result.payload.text
    }
    void (cache ? cache.load(`body:${stamp}`, read) : read()).then(text => {
      if (!disposed) setBody({ stamp, text })
    }).catch(() => { if (!disposed) setFailed(true) })

    return () => { disposed = true }
  }, [client, threadId, stamp, cache, retry])
  const loaded = body?.stamp === stamp
  const complete = (contentComplete || (evidence?.payload as { status?: string } | undefined)?.status === 'completed')
    && (!evidence?.isTruncated || loaded) && !evidence?.outputTruncated
  return <><Body theme={theme} contentComplete={complete}>{loaded ? body.text : preview}</Body>
    {failed && <button className="camp-history-text-button" type="button" onClick={() => setRetry(value => value + 1)}><UiText zh={"正文读取失败，重试"} /></button>}
  </>
}
