import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { McpRevealResult } from '@contracts'
import { NewConversationQuickHelp } from './NewConversationQuickHelp'

const MASK = '********'
const PRESERVE = '__ROVAI_PRESERVE_STORED_VALUE__'
type Definition = Record<string, unknown> & {
  env?: Record<string, string>
  headers?: Record<string, string>
}
function entry(text: string): [string, Definition] {
  const entries = Object.entries(JSON.parse(text).mcpServers ?? {})
  if (entries.length !== 1 || !entries[0][1] || typeof entries[0][1] !== 'object')
    throw new Error('invalid MCP JSON')
  return entries[0] as [string, Definition]
}
function sensitive(key: string, value: string): boolean {
  if (!value) return false
  if (/^(?:Bearer |Basic )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value.trim())) return false
  return (
    /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|BEARER|CREDENTIAL|AUTH|COOKIE/i.test(
      key
    ) || /^(Bearer |Basic |github_pat_|ghp_|gho_|sk-|xoxb-)/.test(value)
  )
}
export function maskMcpJson(text: string): string | null {
  try {
    const [name, definition] = entry(text)
    for (const field of ['env', 'headers'] as const) {
      for (const [key, value] of Object.entries(definition[field] ?? {})) {
        if (typeof value === 'string' && (value === PRESERVE || sensitive(key, value)))
          definition[field]![key] = MASK
      }
    }
    return JSON.stringify({ mcpServers: { [name]: definition } }, null, 2)
  } catch {
    return null
  }
}
export function materializeMcpDraft(text: string, preserved?: string | null): string {
  if (!preserved) return text
  const [name, definition] = entry(text),
    [, stored] = entry(preserved)
  for (const field of ['env', 'headers'] as const) {
    for (const [key, value] of Object.entries(definition[field] ?? {})) {
      if ((value === MASK || value === PRESERVE) && Object.hasOwn(stored[field] ?? {}, key))
        definition[field]![key] = stored[field]![key]
    }
  }
  return JSON.stringify({ mcpServers: { [name]: definition } }, null, 2)
}
export function hasMcpSecrets(text: string): boolean {
  try {
    const [, definition] = entry(text)
    return ['env', 'headers'].some((field) =>
      Object.entries((definition[field] ?? {}) as Record<string, string>).some(
        ([key, value]) =>
          typeof value === 'string' &&
          (value === MASK || value === PRESERVE || sensitive(key, value))
      )
    )
  } catch {
    return false
  }
}

/** Raw values live only in this explicit editor session, never in the shared config/list view. */
export function McpJsonEditor({
  value,
  isEditing,
  serverId,
  configDigest,
  disabled,
  issuesId,
  onChange,
  onConcealed,
  onError
}: {
  value: string
  isEditing: boolean
  serverId?: string
  configDigest: string
  disabled: boolean
  issuesId?: string
  onChange(text: string, preserved?: string): void
  onConcealed(concealed: boolean): void
  onError(message: string | null): void
}): React.JSX.Element {
  const [text, setText] = useState(() => maskMcpJson(value) ?? value)
  const latestText = useRef(text)
  latestText.current = text
  const [shown, setShown] = useState(false)
  const [pending, setPending] = useState(false)
  const [concealed, setConcealed] = useState(false)
  const source = useRef<string | undefined>(undefined)
  const hiddenDraft = useRef<string | null>(null)
  const request = useRef(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    request.current++
    setPending(false)
  }, [configDigest, serverId])
  const secret = shown || pending || concealed || hasMcpSecrets(text)
  useEffect(
    () => () => {
      request.current++
      source.current = undefined
      hiddenDraft.current = null
    },
    []
  )
  useEffect(() => {
    if (!isEditing) {
      request.current++
      source.current = undefined
      hiddenDraft.current = null
      setText(maskMcpJson(value) ?? value)
      setShown(false)
      setPending(false)
      setConcealed(false)
      onConcealed(false)
    }
  }, [value, isEditing, configDigest])
  useLayoutEffect(() => {
    const fit = () => {
      const node = textarea.current
      if (!node) return
      const scroll = node.scrollTop,
        parent = node.closest('.capability-detail-scroll'),
        parentScroll = parent?.scrollTop ?? 0
      node.style.height = '0px'
      const height = Math.min(
        Math.max(142, node.scrollHeight),
        Math.max(160, Math.min(640, window.innerHeight * 0.58))
      )
      node.style.height = `${height}px`
      node.style.overflowY = node.scrollHeight > height ? 'auto' : 'hidden'
      node.scrollTop = scroll
      if (parent) parent.scrollTop = parentScroll
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [text, concealed])
  const change = (next: string) => {
    setText(next)
    onChange(next, source.current)
    onError(null)
  }
  const visibility = async () => {
    if (pending) {
      request.current++
      setPending(false)
      return
    }
    if (shown) {
      if (isEditing) {
        try {
          const raw = materializeMcpDraft(text, source.current),
            masked = maskMcpJson(raw)
          if (masked === null) throw new Error('invalid')
          source.current = raw
          change(masked)
        } catch {
          hiddenDraft.current = text
          setText('')
          setConcealed(true)
          onConcealed(true)
        }
      } else {
        setText(maskMcpJson(value) ?? value)
        source.current = undefined
      }
      setShown(false)
      onError(null)
      return
    }
    if (concealed) {
      setText(hiddenDraft.current ?? value)
      hiddenDraft.current = null
      setConcealed(false)
      onConcealed(false)
      setShown(true)
      return
    }
    const attempt = ++request.current
    setPending(true)
    onError(null)
    try {
      let original = source.current
      if (serverId) {
        const result = await window.rovai.request<McpRevealResult>('mcp.servers.reveal', {
          serverId,
          expectedConfigDigest: configDigest
        })
        if (attempt !== request.current) return
        if (
          result.status !== 'ok' ||
          result.serverId !== serverId ||
          result.configDigest !== configDigest
        )
          throw new Error('配置已更新，请重新载入后再显示。')
        original ??= result.definitionJson
      }
      const raw = materializeMcpDraft(latestText.current, original)
      entry(raw)
      if (attempt !== request.current) return
      source.current = original
      setText(raw)
      setShown(true)
    } catch (error) {
      if (attempt === request.current)
        onError(
          error instanceof SyntaxError
            ? '请先修正 JSON 格式，再显示凭证。'
            : '暂时无法显示凭证，请重新载入配置后重试。'
        )
    } finally {
      if (attempt === request.current) setPending(false)
    }
  }
  return (
    <div className="capability-json-field">
      <div className="capability-scope-heading">
        <h3>配置 JSON</h3>
        {secret && (
          <span className="capability-credential-state">
            {shown ? '凭证已显示' : '凭证已隐藏'}
            <NewConversationQuickHelp label="凭证显示说明">
              原值随配置保留。点击“显示”查看明文；切换 MCP 或保存后重新隐藏。
            </NewConversationQuickHelp>
          </span>
        )}
      </div>
      <div className="capability-json-shell">
        <div className="capability-json-toolbar">
          <code>mcpServers</code>
          <div className="capability-actions">
            {secret && (
              <button
                type="button"
                className="quiet-button compact"
                aria-label={pending ? '取消显示凭证' : shown ? '隐藏疑似凭证' : '显示疑似凭证'}
                aria-pressed={shown}
                disabled={disabled}
                onClick={() => void visibility()}
              >
                {pending ? '取消显示' : shown ? '隐藏' : '显示'}
              </button>
            )}
            <button
              type="button"
              className="quiet-button compact"
              disabled={disabled || concealed}
              onClick={() => {
                try {
                  change(JSON.stringify(JSON.parse(text), null, 2))
                } catch {
                  onError('JSON 格式有误，暂时无法格式化。')
                }
              }}
            >
              格式化
            </button>
          </div>
        </div>
        <textarea
          ref={textarea}
          aria-label="MCP 配置 JSON"
          aria-describedby={issuesId}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          disabled={disabled}
          readOnly={concealed}
          placeholder={concealed ? 'JSON 尚未完成，内容已隐藏。点击“显示”继续编辑。' : undefined}
          value={text}
          onChange={(event) => change(event.target.value)}
        />
      </div>
    </div>
  )
}
