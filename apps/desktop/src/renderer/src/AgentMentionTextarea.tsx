import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent,
  type RefObject
} from 'react'
import { MemberAvatar } from './MemberAvatar'

export interface AgentMentionCandidate {
  agentProfileId: string
  handle: string
  displayName: string
  avatarRef: string | null
}

export interface MentionQuery {
  start: number
  end: number
  query: string
}

type MentionOption =
  | { kind: 'all'; candidates: AgentMentionCandidate[] }
  | { kind: 'agent'; candidate: AgentMentionCandidate }

export function shouldSubmitTextareaOnEnter(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  mentionMenuOpen: boolean
}): boolean {
  return input.key === 'Enter'
    && !input.shiftKey
    && !input.isComposing
    && !input.mentionMenuOpen
}

export function resolveMentionedAgentIds(
  text: string,
  candidates: AgentMentionCandidate[]
): string[] {
  const matches: Array<{ index: number; order: number; agentProfileId: string }> = []
  candidates.forEach((candidate, order) => {
    const indexes = [
      ...mentionIndexes(text, candidate.displayName),
      ...mentionIndexes(text, candidate.handle)
    ]
    if (indexes.length > 0) {
      matches.push({
        index: Math.min(...indexes),
        order,
        agentProfileId: candidate.agentProfileId
      })
    }
  })
  matches.sort((left, right) => left.index - right.index || left.order - right.order)
  const seen = new Set<string>()
  return matches.flatMap(({ agentProfileId }) => {
    if (seen.has(agentProfileId)) return []
    seen.add(agentProfileId)
    return [agentProfileId]
  })
}

function mentionIndexes(text: string, label: string): number[] {
  const normalizedLabel = label.trim()
  if (!normalizedLabel) return []
  const needle = `@${normalizedLabel}`
  const indexes: number[] = []
  let searchFrom = 0
  while (searchFrom < text.length) {
    const index = text.indexOf(needle, searchFrom)
    if (index < 0) break
    const before = index > 0 ? Array.from(text.slice(0, index)).at(-1) : undefined
    const after = Array.from(text.slice(index + needle.length))[0]
    if (!isMentionWordCharacter(before) && !isMentionWordCharacter(after)) {
      indexes.push(index)
    }
    searchFrom = index + needle.length
  }
  return indexes
}

function isMentionWordCharacter(character: string | undefined): boolean {
  return Boolean(character && /[\p{L}\p{N}_-]/u.test(character))
}

export function formatMentionDisplayText(
  text: string,
  candidates: Pick<AgentMentionCandidate, 'handle' | 'displayName'>[]
): string {
  const exactCandidateByHandle = new Map(
    candidates.map((candidate) => [candidate.handle, candidate])
  )
  const legacyCandidateByHandle = new Map<string, Pick<AgentMentionCandidate, 'handle' | 'displayName'> | null>()
  for (const candidate of candidates) {
    const key = candidate.handle.toLowerCase()
    legacyCandidateByHandle.set(key, legacyCandidateByHandle.has(key) ? null : candidate)
  }
  return text.replace(
    /(^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g,
    (match, prefix: string, handle: string) => {
      const candidate = exactCandidateByHandle.get(handle)
        ?? legacyCandidateByHandle.get(handle.toLowerCase())
      if (!candidate) return match
      return `${prefix}@${candidate.displayName}`
    }
  )
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

export function shouldResetMentionActiveOption(
  current: MentionQuery | null,
  next: MentionQuery | null
): boolean {
  return next?.start !== current?.start || next?.query !== current?.query
}

export function AgentMentionTextarea({
  id,
  value,
  candidates,
  defaultRecipientName,
  inputLabel,
  showDefaultTargetSummary = true,
  placeholder,
  rows,
  disabled,
  textareaRef,
  onChange,
  onPaste
}: {
  id: string
  value: string
  candidates: AgentMentionCandidate[]
  defaultRecipientName?: string
  inputLabel?: string
  showDefaultTargetSummary?: boolean
  placeholder: string
  rows: number
  disabled: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onChange(value: string): void
  onPaste?(event: ClipboardEvent<HTMLTextAreaElement>): void
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
      && candidate.displayName.toLowerCase().includes(normalizedQuery)
    )
    return mentionQuery.query.length === 0 && available.length > 1
      ? [{ kind: 'all', candidates: available }, ...available.map((candidate) => ({ kind: 'agent' as const, candidate }))]
      : available.map((candidate) => ({ kind: 'agent' as const, candidate }))
  }, [candidates, mentionQuery, mentionedIdSet])
  const menuOpen = mentionQuery !== null && options.length > 0

  useEffect(() => {
    setActiveOption((current) => Math.min(current, Math.max(0, options.length - 1)))
  }, [options.length])

  useEffect(() => {
    const displayValue = formatMentionDisplayText(value, candidates)
    if (displayValue !== value) onChange(displayValue)
  }, [candidates, onChange, value])

  const refreshMentionQuery = (target: HTMLTextAreaElement): void => {
    const caret = target.selectionStart ?? target.value.length
    const nextQuery = mentionQueryAtCaret(target.value, caret)
    if (shouldResetMentionActiveOption(mentionQuery, nextQuery)) {
      setActiveOption(0)
    }
    setMentionQuery(nextQuery)
  }

  const changeValue = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(formatMentionDisplayText(event.target.value, candidates))
    refreshMentionQuery(event.target)
  }

  const selectOption = (option: MentionOption): void => {
    if (!mentionQuery) return
    const mentionText = option.kind === 'all'
      ? option.candidates.map((candidate) => `@${candidate.displayName}`).join(' ')
      : `@${option.candidate.displayName}`
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
    if (menuOpen && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
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
    if (shouldSubmitTextareaOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      mentionMenuOpen: menuOpen
    })) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <>
      <label htmlFor={id}>
        {inputLabel ?? `给 ${mentionedNames.length > 0 ? mentionedNames.join('、') : defaultRecipientName ?? '队员'} 发消息`}
      </label>
      <div className="mention-input-shell">
        <textarea
          ref={inputRef}
          id={id}
          value={value}
          onChange={changeValue}
          onPaste={onPaste}
          onKeyDown={handleKeyDown}
          onClick={(event) => refreshMentionQuery(event.currentTarget)}
          onSelect={(event) => refreshMentionQuery(event.currentTarget)}
          onBlur={() => setMentionQuery(null)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          aria-keyshortcuts="Enter"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `${id}-mentions` : undefined}
          aria-activedescendant={menuOpen ? `${id}-mention-${activeOption}` : undefined}
        />
        {menuOpen && (
          <div className="mention-menu" id={`${id}-mentions`} role="listbox" aria-label="选择在队的队员">
            <div className="mention-menu-heading" role="presentation"><strong>@ 提及队员</strong><span>选择后会创建独立 AgentRun</span></div>
            {options.map((option, index) => {
              const key = option.kind === 'all' ? 'all-ready' : option.candidate.agentProfileId
              const title = option.kind === 'all' ? '全部在队的队员' : option.candidate.displayName
              const detail = option.kind === 'all'
                ? option.candidates.map((candidate) => `@${candidate.displayName}`).join(' · ')
                : `@${option.candidate.displayName}`
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
                  {option.kind === 'all'
                    ? <span className="mention-avatar" aria-hidden="true">@</span>
                    : (
                        <MemberAvatar
                          agentProfileId={option.candidate.agentProfileId}
                          avatarRef={option.candidate.avatarRef}
                          displayName={option.candidate.displayName}
                          size="mention"
                          decorative
                          className="mention-avatar"
                        />
                      )}
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <i aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </div>
      {(mentionedNames.length > 0 || showDefaultTargetSummary) && (
        <span className="mention-target-summary">
          {mentionedNames.length > 0
            ? `将同时唤醒 ${mentionedNames.length} 位队员`
            : '未提及时发送给 Lead · 输入 @ 选择其他在队的队员'}
        </span>
      )}
    </>
  )
}
