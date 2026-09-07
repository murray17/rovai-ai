import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent
} from 'react'
import type { AgentProfile } from '@contracts'
import { DialogControlIcon } from './AppDialog'
import { MemberPortrait } from './MemberPortrait'
import { MemberAvatarEditor } from './MemberAvatarEditor'
import {
  identityDraftFor,
  identityDraftIssue,
  unicodeScalarLength,
  normalizeIdentityTag,
  hasControlOrNewline,
  type IdentityDraft,
  type IdentityDraftField
} from './member-identity-draft'
import { readErrorMessage } from './error-message'

export type MemberIdentityEditorHandle = { discard(): void; openAvatar(): void }
export const MemberIdentityEditor = forwardRef<
  MemberIdentityEditorHandle,
  {
    agent: AgentProfile | null
    agents: AgentProfile[]
    busy: boolean
    onDirtyChange(dirty: boolean): void
    onAvatarChange(avatarRef: string | null): void
    onDiscardNew(): void
    onSubmit(
      draft: IdentityDraft,
      avatarRef: string | null,
      onCommitted: (profile: AgentProfile) => void
    ): Promise<AgentProfile>
  }
>(function MemberIdentityEditor(
  {
    agent,
    agents,
    busy: parentBusy,
    onDirtyChange,
    onAvatarChange,
    onDiscardNew,
    onSubmit
  },
  ref
) {
  const [draft, setDraft] = useState(() => identityDraftFor(agent))
  const [avatarRef, setAvatarRef] = useState(agent?.avatarRef ?? null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarPending, setAvatarPending] = useState(false)
  const [avatarRevision, setAvatarRevision] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [traitInput, setTraitInput] = useState('')
  const [error, setError] = useState<{
    field: IdentityDraftField | 'submit'
    message: string
  } | null>(null)
  const [traitError, setTraitError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const saving = useRef(false)
  const busy = parentBusy || isSaving
  const persisted = JSON.stringify({
    ...identityDraftFor(agent),
    avatarRef: agent?.avatarRef ?? null
  })
  const observed = useRef(persisted)
  const [baseline, setBaseline] = useState(persisted)
  const dirty =
    JSON.stringify({ ...draft, avatarRef }) !== baseline ||
    Boolean(traitInput.trim()) ||
    avatarPending
  const fieldPrefix = useId()
  const fieldId = (field: string): string => `${fieldPrefix}-${field}`
  const reset = (): void => {
    setDraft(identityDraftFor(agent))
    setAvatarRef(agent?.avatarRef ?? null)
    setBaseline(persisted)
    observed.current = persisted
    setError(null)
    setTraitError(null)
    setTraitInput('')
    setConflict(false)
    setSaved(false)
    setAvatarOpen(false)
    setAvatarPending(false)
    setAvatarRevision((value) => value + 1)
  }
  useImperativeHandle(ref, () => ({
    discard: reset,
    openAvatar: () => setAvatarOpen(true)
  }))
  useEffect(() => {
    onDirtyChange(dirty || !agent)
  }, [dirty, agent?.agentId, onDirtyChange])
  useEffect(() => {
    onAvatarChange(avatarRef)
  }, [avatarRef, onAvatarChange])
  useEffect(() => {
    if (observed.current === persisted) return
    observed.current = persisted
    if (dirty && !saving.current) {
      setConflict(true)
      return
    }
    if (!saving.current) reset()
  }, [persisted])
  const update = <K extends keyof IdentityDraft>(
    key: K,
    value: IdentityDraft[K]
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error?.field === key) setError(null)
    setSaved(false)
  }
  const addTraits = (input = traitInput): IdentityDraft | null => {
    const next = [...draft.personalityTraits]
    for (const trait of input
      .split(/[,，]/)
      .map(normalizeIdentityTag)
      .filter(Boolean)) {
      if (unicodeScalarLength(trait) > 16 || hasControlOrNewline(trait)) {
        setTraitError('每个标签最多 16 个字符，且不能包含换行或控制字符。')
        return null
      }
      if (next.some((item) => item.toLowerCase() === trait.toLowerCase()))
        continue
      if (next.length >= 6) {
        setTraitError('最多设置 6 个标签。')
        return null
      }
      next.push(trait)
    }
    update('personalityTraits', next)
    setTraitInput('')
    setTraitError(null)
    return { ...draft, personalityTraits: next }
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || conflict || avatarPending) return
    const next = traitInput.trim() ? addTraits() : draft
    if (!next) {
      document.getElementById(fieldId('traits'))?.focus()
      return
    }
    const issue = identityDraftIssue(next, agent?.agentId ?? null, agents)
    setError(issue)
    if (issue) {
      if (
        ['workingPrinciples', 'growthTopic', 'advanced'].includes(issue.field)
      )
        setAdvancedOpen(true)
      requestAnimationFrame(() =>
        document
          .getElementById(
            fieldId(
              issue.field === 'advanced'
                ? 'workingPrinciples'
                : issue.field === 'personalityTraits'
                  ? 'traits'
                  : issue.field
            )
          )
          ?.focus()
      )
      return
    }
    saving.current = true
    setSaving(true)
    try {
      const committed = await onSubmit(next, avatarRef, (profile) => {
        const accepted = identityDraftFor(profile)
        observed.current = JSON.stringify({
          ...accepted,
          avatarRef: profile.avatarRef
        })
        setBaseline(observed.current)
      })
      setDraft(identityDraftFor(committed))
      setAvatarRef(committed.avatarRef)
      setConflict(false)
      setSaved(true)
      setAvatarOpen(false)
    } catch (issue) {
      setError({ field: 'submit', message: readErrorMessage(issue) })
    } finally {
      saving.current = false
      setSaving(false)
    }
  }
  const filled =
    Number(Boolean(draft.workingPrinciples.trim())) +
    Number(Boolean(draft.growthTopic.trim()))
  const field = (
    key: Exclude<keyof IdentityDraft, 'personalityTraits'>,
    label: string,
    max: number,
    multiline = false,
    placeholder = '',
    hint = ''
  ): React.JSX.Element => {
    const invalid = error?.field === key
    const Input = multiline ? 'textarea' : 'input'
    const props = {
      id: fieldId(key),
      value: draft[key],
      placeholder,
      disabled: busy,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        update(key, event.target.value),
      onBlur: () => {
        const issue = identityDraftIssue(draft, agent?.agentId ?? null, agents)
        if (issue?.field === key) setError(issue)
      },
      'aria-invalid': invalid || undefined,
      'aria-describedby': `${fieldId(`hint-${key}`)}${invalid ? ` ${fieldId(`error-${key}`)}` : ''}`,
      required: key === 'displayName'
    }
    return (
      <div className={`member-editor-field ${invalid ? 'has-error' : ''}`}>
        <div className="member-editor-field-label">
          <label htmlFor={fieldId(key)}>{label}</label>
          <small className="member-editor-counter" aria-hidden="true">
            {unicodeScalarLength(draft[key])} / {max}
          </small>
        </div>
        <Input {...props} rows={multiline ? 3 : undefined} />
        <span id={fieldId(`hint-${key}`)} className="sr-only">
          最多 {max} 个字符。{hint}
        </span>
        {hint && <small className="member-editor-focus-help">{hint}</small>}
        {invalid && (
          <small
            className="member-editor-field-error"
            id={fieldId(`error-${key}`)}
            role="alert"
          >
            {error.message}
          </small>
        )}
      </div>
    )
  }

  return (
    <section
      className="member-editor-section member-editor-identity"
      aria-labelledby={fieldId('title')}
    >
      <h2 id={fieldId('title')}>队员信息</h2>
      <form
        className="member-identity-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <div className="member-editor-identity-layout">
          <div className="member-editor-identity-fields">
            <div className="member-editor-two-columns">
              {field('displayName', '名称', 80)}
              {field('teamRole', '团队角色', 120, false, '主要贡献类型')}
            </div>
            {field(
              'professionalResponsibilities',
              '专业职责',
              300,
              true,
              '长期负责什么，通常交付什么结果'
            )}
            <div className="member-editor-field">
              <div className="member-editor-field-label">
                <label htmlFor={fieldId('traits')}>性格底色</label>
                <small className="member-editor-counter">
                  {draft.personalityTraits.length} / 6
                </small>
              </div>
              <div className="member-editor-traits">
                {draft.personalityTraits.map((trait) => (
                  <span className="member-editor-trait" key={trait}>
                    {trait}
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`移除标签 ${trait}`}
                      onClick={() => {
                        update(
                          'personalityTraits',
                          draft.personalityTraits.filter(
                            (item) => item !== trait
                          )
                        )
                        setTraitError(null)
                      }}
                    >
                      <DialogControlIcon name="close" />
                    </button>
                  </span>
                ))}
                <input
                  id={fieldId('traits')}
                  value={traitInput}
                  disabled={busy || draft.personalityTraits.length >= 6}
                  placeholder={
                    draft.personalityTraits.length >= 6
                      ? '已满 6 项'
                      : '添加标签'
                  }
                  aria-describedby={fieldId('trait-hint')}
                  aria-invalid={
                    Boolean(traitError) || error?.field === 'personalityTraits'
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    if (/[,，]/.test(value)) {
                      const parts = value.split(/[,，]/)
                      const remainder = parts.pop() ?? ''
                      if (addTraits(parts.join(','))) setTraitInput(remainder)
                    } else {
                      setTraitInput(value)
                      setTraitError(null)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      addTraits()
                    }
                  }}
                  onBlur={() => {
                    if (traitInput.trim()) addTraits()
                  }}
                />
              </div>
              <span id={fieldId('trait-hint')} className="sr-only">
                回车或逗号添加标签，最多 6 项，每项最多 16 个字符。
              </span>
              <small className="member-editor-focus-help">
                回车添加 · 最多 6 项，每项 16 字
              </small>
              {(traitError || error?.field === 'personalityTraits') && (
                <small className="member-editor-field-error" role="alert">
                  {traitError ?? error?.message}
                </small>
              )}
            </div>
          </div>
          <div className="member-editor-appearance">
            <MemberPortrait
              agentId={agent?.agentId ?? 'new-member'}
              avatarRef={avatarRef}
              displayName={draft.displayName || '新队员'}
              decorative
            />
            <button
              type="button"
              className="member-editor-image-button"
              aria-expanded={avatarOpen}
              disabled={busy}
              onClick={() => setAvatarOpen(!avatarOpen)}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                <path d="M3.5 6.5h2.2l1.1-1.8h6.4l1.1 1.8h2.2v8.8h-13z" />
                <circle cx="10" cy="10.8" r="2.7" />
              </svg>
              更换角色图片
            </button>
          </div>
        </div>
        <MemberAvatarEditor
          key={avatarRevision}
          value={avatarRef}
          open={avatarOpen}
          disabled={busy}
          onChange={(value) => {
            setAvatarRef(value)
            setSaved(false)
          }}
          onClose={() => setAvatarOpen(false)}
          onPendingChange={setAvatarPending}
        />
        <div className="member-editor-extra">
          <button
            type="button"
            className="member-editor-disclosure"
            aria-expanded={advancedOpen}
            aria-controls={fieldId('extra-panel')}
            disabled={busy}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            <span>工作准则与成长课题</span>
            <small>{filled ? `已填写 ${filled} 项` : '未填写'}</small>
            <DialogControlIcon name="chevron" />
          </button>
          <div
            className="member-editor-two-columns member-editor-extra-fields"
            id={fieldId('extra-panel')}
            hidden={!advancedOpen}
          >
            {field(
              'workingPrinciples',
              '工作准则',
              300,
              true,
              '做事方式、质量标准和协作边界',
              '修改后用于之后开始的工作。'
            )}
            {field(
              'growthTopic',
              '成长课题',
              300,
              true,
              '希望逐渐练习或改善的方向',
              '更换课题会保留已经形成的记忆。'
            )}
          </div>
        </div>
        {conflict && (
          <div className="member-editor-submit-error" role="alert">
            <span>队员信息已在其他操作中更新。当前修改仍保留。</span>
            <button
              className="member-editor-text-button"
              type="button"
              onClick={reset}
            >
              放弃此处修改，读取已保存信息
            </button>
          </div>
        )}
        {error?.field === 'submit' && (
          <p className="member-editor-submit-error" role="alert">
            {error.message}
          </p>
        )}
        <footer className="member-editor-save-row">
          <span
            className={`member-editor-save-status ${dirty ? 'is-dirty' : ''}`}
            role="status"
          >
            {busy
              ? '正在保存…'
              : avatarPending
                ? '请先完成或取消图片裁剪'
                : dirty
                  ? '有未保存更改'
                  : saved
                    ? '已保存'
                    : agent
                      ? '当前信息已保存'
                      : '尚未创建'}
          </span>
          <div>
            <button
              type="button"
              className="member-editor-cancel"
              disabled={busy || (!dirty && Boolean(agent))}
              onClick={agent ? reset : onDiscardNew}
            >
              放弃更改
            </button>
            <button
              type="submit"
              className="member-editor-primary"
              disabled={
                busy ||
                conflict ||
                avatarPending ||
                !draft.displayName.trim() ||
                (Boolean(agent) && !dirty)
              }
            >
              {busy ? '正在保存…' : agent ? '保存队员信息' : '创建队员'}
            </button>
          </div>
        </footer>
      </form>
    </section>
  )
})
