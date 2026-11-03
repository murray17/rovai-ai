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
import { MemberAvatarEditor } from './MemberAvatarEditor'
import {
  identityDraftFor,
  PROFESSIONAL_RESPONSIBILITIES_MAX_SCALARS,
  WORKING_PRINCIPLES_MAX_SCALARS,
  GROWTH_TOPIC_MAX_SCALARS,
  identityDraftIssue,
  unicodeScalarLength,
  normalizeIdentityTag,
  hasControlOrNewline,
  type IdentityDraft,
  type IdentityDraftField
} from './member-identity-draft'
import { readErrorMessage } from './error-message'
import { UiText , uiAttribute } from './interface-language'

export type MemberIdentityEditorHandle = { discard(): void; openAvatar(trigger: HTMLButtonElement): void }
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
  const avatarTrigger = useRef<HTMLButtonElement | null>(null)
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
  const conflictDuringSave = useRef(false)
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
    avatarPending ||
    conflict
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
    conflictDuringSave.current = false
    setSaved(false)
    setAvatarOpen(false)
    setAvatarPending(false)
    setAvatarRevision((value) => value + 1)
  }
  useImperativeHandle(ref, () => ({
    discard: reset,
    openAvatar: trigger => { avatarTrigger.current = trigger; setAvatarOpen(true) }
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
    // Our receipts advance observed before props change. Any different value is
    // external, including one received while the post-save reload is pending.
    if (dirty || saving.current) {
      if (saving.current) conflictDuringSave.current = true
      setConflict(true)
      return
    }
    reset()
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
        setTraitError(uiAttribute('每个标签最多 16 个字符，且不能包含换行或控制字符。'))
        return null
      }
      if (next.some((item) => item.toLowerCase() === trait.toLowerCase()))
        continue
      if (next.length >= 6) {
        setTraitError(uiAttribute('最多设置 6 个标签。'))
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
      setAdvancedOpen(true)
      requestAnimationFrame(() => document.getElementById(fieldId('traits'))?.focus())
      return
    }
    const issue = identityDraftIssue(next, agent?.agentId ?? null, agents)
    setError(issue)
    if (issue) {
      if (
        ['personalityTraits', 'workingPrinciples', 'growthTopic', 'advanced'].includes(issue.field)
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
    conflictDuringSave.current = false
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
      if (!conflictDuringSave.current) {
        setDraft(identityDraftFor(committed))
        setAvatarRef(committed.avatarRef)
        setConflict(false)
        setSaved(true)
        setAvatarOpen(false)
      }
    } catch (issue) {
      setError({ field: 'submit', message: readErrorMessage(issue) })
    } finally {
      saving.current = false
      setSaving(false)
    }
  }
  const filled =
    draft.personalityTraits.length > 0 ||
    Boolean(draft.workingPrinciples.trim()) ||
    Boolean(draft.growthTopic.trim())
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
            {unicodeScalarLength(key === 'professionalResponsibilities' ? draft[key].trim() : draft[key])} / {max.toLocaleString('en-US')}
          </small>
        </div>
        <Input {...props} rows={multiline ? 3 : undefined} />
        <span id={fieldId(`hint-${key}`)} className="sr-only"><UiText zh={"最多 "} />{max}<UiText zh={" 个字符。"} />{hint}
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
      <h2 id={fieldId('title')}>{uiAttribute('身份信息')}</h2>
      <form
        className="member-identity-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <MemberAvatarEditor
          key={avatarRevision}
          value={avatarRef}
          open={avatarOpen}
          returnFocusRef={avatarTrigger}
          disabled={busy}
          onChange={(value) => {
            setAvatarRef(value)
            setSaved(false)
          }}
          onClose={() => setAvatarOpen(false)}
          onPendingChange={setAvatarPending}
        />
        <div className="member-editor-identity-layout">
          <div className="member-editor-identity-fields">
            <div className="member-editor-two-columns identity-name-role">
              {field('displayName', uiAttribute('名称'), 80)}
              {field('teamRole', uiAttribute('团队角色'), 120, false, uiAttribute('主要贡献类型'))}
            </div>
            {field(
              'professionalResponsibilities',
              uiAttribute('专业职责'),
              PROFESSIONAL_RESPONSIBILITIES_MAX_SCALARS,
              true,
              uiAttribute('长期负责什么，通常交付什么结果')
            )}
          </div>

        </div>

        <div className="member-editor-extra">
          <button
            type="button"
            className="member-editor-disclosure"
            aria-expanded={advancedOpen}
            aria-controls={fieldId('extra-panel')}
            disabled={busy}
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            <span>{uiAttribute("更多设定")}</span>
            {filled && <small>{uiAttribute("已设置")}</small>}
            <DialogControlIcon name="chevron" />
          </button>
          <div
            className="member-editor-two-columns member-editor-extra-fields"
            id={fieldId('extra-panel')}
            hidden={!advancedOpen}
          >
            <div className="member-editor-field member-editor-traits-field">
              <div className="member-editor-field-label">
                <label htmlFor={fieldId('traits')}><UiText zh={"性格底色"} /></label>
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
                      aria-label={uiAttribute("移除标签 {0}", String(trait))}
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
                      ? uiAttribute("已满 6 项")
                      : uiAttribute("添加标签")
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
                  onBlur={(event) => {
                    // Saving also commits the unfinished tag. Defer that work to
                    // submit so blur cannot move the button between down and up.
                    const next = event.relatedTarget
                    if (next instanceof HTMLButtonElement && next.type === 'submit' && next.form === event.currentTarget.form) return
                    if (traitInput.trim()) addTraits()
                  }}
                />
              </div>
              <span id={fieldId('trait-hint')} className="sr-only"><UiText zh={"回车或逗号添加标签，最多 6 项，每项最多 16 个字符。"} /></span>
              <small className="member-editor-focus-help"><UiText zh={"回车添加 · 最多 6 项，每项 16 字"} /></small>
              {(traitError || error?.field === 'personalityTraits') && (
                <small className="member-editor-field-error" role="alert">
                  {traitError ?? error?.message}
                </small>
              )}
            </div>
            {field(
              'workingPrinciples',
              uiAttribute('工作准则'),
              WORKING_PRINCIPLES_MAX_SCALARS,
              true,
              uiAttribute('做事方式、质量标准和协作边界'),
              uiAttribute('修改后用于之后开始的工作。')
            )}
            {field(
              'growthTopic',
              uiAttribute('成长课题'),
              GROWTH_TOPIC_MAX_SCALARS,
              true,
              uiAttribute('希望逐渐练习或改善的方向'),
              uiAttribute('更换课题会保留已经形成的记忆。')
            )}
          </div>
        </div>
        {conflict && (
          <div className="member-editor-submit-error" role="alert">
            <span><UiText zh={"队员信息已在其他操作中更新。当前修改仍保留。"} /></span>
            <button
              className="member-editor-text-button"
              type="button"
              disabled={busy}
              onClick={reset}
            ><UiText zh={"放弃此处修改，读取已保存信息"} /></button>
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
              ? uiAttribute("正在保存…")
              : avatarPending
                ? uiAttribute("正在处理头像…")
                : dirty
                  ? uiAttribute("有未保存更改")
                  : saved
                    ? uiAttribute("已保存")
                    : agent
                      ? ''
                      : uiAttribute("尚未创建")}
          </span>
          <div>
            <button
              type="button"
              className="member-editor-cancel"
              disabled={busy || (!dirty && Boolean(agent))}
              onClick={agent ? reset : onDiscardNew}
            ><UiText zh={"放弃更改"} /></button>
            <button
              type="submit"
              className={agent ? 'member-editor-primary member-editor-save' : 'member-editor-primary'}
              aria-label={agent ? uiAttribute("保存队员信息") : uiAttribute("创建队员")}
              disabled={
                busy ||
                conflict ||
                avatarPending ||
                !draft.displayName.trim() ||
                (Boolean(agent) && !dirty)
              }
            >
              {agent && <DialogControlIcon name="save" />}
              {busy ? uiAttribute("正在保存…") : agent ? uiAttribute("保存") : uiAttribute("创建队员")}
            </button>
          </div>
        </footer>
      </form>
    </section>
  )
})
