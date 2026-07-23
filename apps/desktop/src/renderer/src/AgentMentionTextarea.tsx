import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent,
  type RefObject
} from 'react'

export interface AgentMentionCandidate {
  agentProfileId: string
  handle: string
  displayName: string
}

export interface MentionQuery {
  start: number
  end: number
  query: string
}

type MentionOption =
  | { kind: 'all'; candidates: AgentMentionCandidate[] }
  | { kind: 'agent'; candidate: AgentMentionCandidate }

export function resolveMentionedAgentIds(
  text: string,
  candidates: AgentMentionCandidate[]
): string[] {
  const candidateByHandle = new Map(
    candidates.map((candidate) => [candidate.handle.toLowerCase(), candidate.agentProfileId])
  )
  const resolved: string[] = []
  const seen = new Set<string>()
  const pattern = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g
  for (const match of text.matchAll(pattern)) {
    const agentProfileId = candidateByHandle.get(match[2].toLowerCase())
    if (agentProfileId && !seen.has(agentProfileId)) {
      seen.add(agentProfileId)
      resolved.push(agentProfileId)
    }
  }
  return resolved
}

export function mentionQueryAtCaret(text: string, caret: number): MentionQuery | null {
  const prefix = text.slice(0, caret)
  const start = prefix.lastIndexOf('@')
  if (start < 0) return null
  if (start > 0 && /[A-Za-z0-9_-]/.test(prefix[start - 1])) return null
  const query = prefix.slice(start + 1)
  if (/\s|@/.test(query)) return null
  return { start, end: caret, query }
}

export function AgentMentionTextarea({
  id,
  value,
  candidates,
  defaultRecipientName,
  placeholder,
  rows,
  disabled,
  textareaRef,
  onChange
}: {
  id: string
  value: string
  candidates: AgentMentionCandidate[]
  defaultRecipientName: string
  placeholder: string
  rows: number
  disabled: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onChange(value: string): void
}): JSX.Element {
  const fallbackRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = textareaRef ?? fallbackRef
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [activeOption, setActiveOption] = useState(0)
  const mentionedIds = useMemo(
    () => resolveMentionedAgentIds(value, candidates),
    [candidates, value]
  )
  const mentionedIdSet = useMemo(() => new Set(mentionedIds), [mentionedIds])
  const mentionedNames = mentionedIds.map((id) =>
    candidates.find((candidate) => candidate.agentProfileId === id)?.displayName ?? id
  )
  const options = useMemo<MentionOption[]>(() => {
    if (!mentionQuery) return []
    const normalizedQuery = mentionQuery.query.toLowerCase()
    const available = candidates.filter((candidate) =>
      !mentionedIdSet.has(candidate.agentProfileId)
      && (
        candidate.handle.toLowerCase().includes(normalizedQuery)
        || candidate.displayName.toLowerCase().includes(normalizedQuery)
      )
    )
    return mentionQuery.query.length === 0 && available.length > 1
      ? [{ kind: 'all', candidates: available }, ...available.map((candidate) => ({ kind: 'agent' as const, candidate }))]
      : available.map((candidate) => ({ kind: 'agent' as const, candidate }))
  }, [candidates, mentionQuery, mentionedIdSet])
  const menuOpen = mentionQuery !== null && options.length > 0

  useEffect(() => {
    setActiveOption((current) => Math.min(current, Math.max(0, options.length - 1)))
  }, [options.length])

  const refreshMentionQuery = (target: HTMLTextAreaElement): void => {
    const caret = target.selectionStart ?? target.value.length
    setMentionQuery(mentionQueryAtCaret(target.value, caret))
    setActiveOption(0)
  }

  const changeValue = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value)
    refreshMentionQuery(event.target)
  }

  const selectOption = (option: MentionOption): void => {
    if (!mentionQuery) return
    const mentionText = option.kind === 'all'
      ? option.candidates.map((candidate) => `@${candidate.handle}`).join(' ')
      : `@${option.candidate.handle}`
    const suffix = value.slice(mentionQuery.end)
    const separator = suffix.startsWith(' ') ? '' : ' '
    const nextValue = `${value.slice(0, mentionQuery.start)}${mentionText}${separator}${suffix}`
    const nextCaret = mentionQuery.start + mentionText.length + separator.length
    onChange(nextValue)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveOption((current) => (current + direction + options.length) % options.length)
      return
    }
    if (menuOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      const option = options[activeOption]
      if (option) selectOption(option)
      return
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault()
      setMentionQuery(null)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <>
      <label htmlFor={id}>给 {mentionedNames.length > 0 ? mentionedNames.join('、') : defaultRecipientName} 发消息</label>
      <div className="mention-input-shell">
        <textarea
          ref={inputRef}
          id={id}
          value={value}
          onChange={changeValue}
          onKeyDown={handleKeyDown}
          onClick={(event) => refreshMentionQuery(event.currentTarget)}
          onSelect={(event) => refreshMentionQuery(event.currentTarget)}
          onBlur={() => setMentionQuery(null)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${id}-mentions` : undefined}
          aria-activedescendant={menuOpen ? `${id}-mention-${activeOption}` : undefined}
        />
        {menuOpen && (
          <div className="mention-menu" id={`${id}-mentions`} role="listbox" aria-label="选择就绪成员">
            <div className="mention-menu-heading" role="presentation"><strong>@ 提及成员</strong><span>选择后会创建独立 AgentRun</span></div>
            {options.map((option, index) => {
              const key = option.kind === 'all' ? 'all-ready' : option.candidate.agentProfileId
              const title = option.kind === 'all' ? '全部就绪成员' : option.candidate.displayName
              const detail = option.kind === 'all'
                ? option.candidates.map((candidate) => `@${candidate.handle}`).join(' · ')
                : `@${option.candidate.handle}`
              return (
                <button
                  id={`${id}-mention-${index}`}
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  className={index === activeOption ? 'active' : ''}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveOption(index)}
                >
                  <span className="mention-avatar" aria-hidden="true">{option.kind === 'all' ? '@' : title.slice(0, 1)}</span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <i aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </div>
      <span className="mention-target-summary">
        {mentionedNames.length > 0
          ? `将同时唤醒 ${mentionedNames.length} 位成员`
          : '未提及时发送给 Lead · 输入 @ 选择其他就绪成员'}
      </span>
    </>
  )
}
