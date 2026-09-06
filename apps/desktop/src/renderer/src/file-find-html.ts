import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFileFindAdapter, useOptionalFileFind, type FileFindAdapter } from './FilePreviewFind'
import type { FilePreviewContent } from './FilePreviewContext'
import { useFilePreview } from './FilePreviewContext'
import type { FileFindDocument } from './file-find'

type HtmlContent = Extract<FilePreviewContent, { kind: 'html' }>
export function useHtmlFileFind(frame: RefObject<HTMLIFrameElement | null>, content: HtmlContent | null): void {
  const { resolvedTheme } = useFilePreview()
  const invalidate = useRef<(() => void) | null>(null)
  const registry = useOptionalFileFind()
  const control = useRef(registry)
  control.current = registry
  const requests = useRef(new Map<number, { resolve(value: FileFindDocument[]): void; reject(error: Error): void }>())
  const sequence = useRef(0)
  const [ready, setReady] = useState<HtmlContent | null>(null)
  useEffect(() => {
    if (!content) return undefined
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const message = event.data as Record<string, unknown>
      if (message.tabToken !== content.tabToken || message.bridgeToken !== content.bridgeToken) return
      if (message.type === 'rovai-preview-find-invalidated') { invalidate.current?.(); return }
      if (message.type === 'rovai-preview-find-ready') { setReady(content); return }
      if (message.type === 'rovai-preview-find-open') { control.current?.controller?.open(); return }
      if (message.type === 'rovai-preview-find-close') { control.current?.controller?.close(); return }
      if (message.type !== 'rovai-preview-find-document' || !Number.isSafeInteger(message.requestId)) return
      const request = requests.current.get(message.requestId as number)
      if (!request) return
      if (typeof message.text === 'string' && message.text.length <= 8 * 1024 * 1024) request.resolve([{ id: 'html', text: message.text }])
      else request.reject(new Error('页面正文过大或已变化，暂时无法查找。'))
    }
    window.addEventListener('message', receive)
    frame.current?.contentWindow?.postMessage({ type: 'rovai-preview-find-ready', tabToken: content.tabToken }, '*')
    return () => {
      window.removeEventListener('message', receive)
      for (const request of requests.current.values()) request.reject(new DOMException('Aborted', 'AbortError'))
      requests.current.clear()
    }
  }, [content, frame])
  const adapter = useMemo<FileFindAdapter | null>(() => {
    if (!content || ready !== content) return null
    const send = (type: string, data: Record<string, unknown> = {}): void => frame.current?.contentWindow?.postMessage({ type, tabToken: content.tabToken, ...data }, '*')
    return {
      scopeLabel: '页面可见文本',
      subscribe(callback) { invalidate.current = callback; return () => { invalidate.current = null } },
      documents(_options, signal) {
        return new Promise((resolve, reject) => {
          if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
          const requestId = ++sequence.current
          const finish = (error?: Error, value?: FileFindDocument[]): void => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            requests.current.delete(requestId)
            if (error) reject(error)
            else resolve(value ?? [])
          }
          const abort = (): void => finish(new DOMException('Aborted', 'AbortError'))
          const timer = setTimeout(() => finish(new Error('页面未响应查找，请重试。')), 1500)
          signal.addEventListener('abort', abort, { once: true })
          requests.current.set(requestId, { resolve: value => finish(undefined, value), reject: error => finish(error) })
          send('rovai-preview-find-snapshot', { requestId })
        })
      },
      show(matches, current, scroll) {
        const style = frame.current ? getComputedStyle(frame.current) : null
        send('rovai-preview-find-matches', { matches, current, scroll,
          colors: ['--conversation-find-match', '--conversation-find-current', '--ink'].map(name => style?.getPropertyValue(name).trim() ?? '') })
      },
      clear: () => send('rovai-preview-find-clear'),
      focus: () => frame.current?.focus({ preventScroll: true })
    }
  }, [content, frame, ready, resolvedTheme])
  useFileFindAdapter(adapter)
}
