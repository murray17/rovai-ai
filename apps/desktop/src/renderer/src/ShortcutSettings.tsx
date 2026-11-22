import { BusyLabel } from './BusyLabel'
import { useTaskCapability } from './TaskCapabilityProvider'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ShortcutActionId, ShortcutMouseSide, ShortcutPreferences } from '@contracts'
import { SHORTCUTS, shortcutAvailable, SHORTCUT_MOUSE_SIDES, normalizeShortcut, shortcutDefaults, shortcutKeyParts, validateShortcut } from '../../shared/shortcuts'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { useShortcuts } from './ShortcutProvider'
import { uiAttribute, useUiText } from './interface-language'
import './shortcut-settings.css'

type Command = typeof SHORTCUTS[number]
type Candidate = { kind: 'keyboard'; binding: string } | { kind: 'mouse'; side: ShortcutMouseSide }
type SaveOwner = ShortcutActionId | 'send' | 'reset'
const defaults = shortcutDefaults()

export function ShortcutSettings(): React.JSX.Element | null {
  const { enabled: tasksEnabled } = useTaskCapability()
  const available = (id: ShortcutActionId): boolean => shortcutAvailable(id, tasksEnabled)
  const shortcuts = useShortcuts()
  const t = useUiText()
  const [editing, setEditing] = useState<Command | null>(null)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [restoreIntent, setRestoreIntent] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<{ owner: SaveOwner; message: string } | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ owner: SaveOwner; source: Element | null } | null>(null)
  const [toast, setToast] = useState('')
  const recorder = useRef<HTMLDivElement>(null)
  const saving = useRef(false)
  const mounted = useRef(true)
  const record = shortcuts?.record
  useLayoutEffect(() => {
    if (editing?.id !== 'tasks' || tasksEnabled) return
    setEditing(null); setCandidate(null); setCaptureError(null); setRestoreIntent(false); setSaveError(null)
    void record?.(null).catch(() => undefined)
  }, [tasksEnabled, editing?.id, record])
  useLayoutEffect(() => {
    if (!focusRequest || busy) return
    setFocusRequest(null)
    if (document.activeElement !== focusRequest.source && document.activeElement !== document.body) return
    const { owner } = focusRequest
    const target = owner === 'send' ? document.querySelector<HTMLElement>('#shortcut-send-mode')
      : owner === 'reset' ? null
        : document.querySelector<HTMLElement>(`[data-command="${owner}"] .shortcut-inline-recorder, [data-edit="${owner}"]`)
    target?.focus({ preventScroll: true })
  }, [focusRequest, busy])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!editing || !record) return
    recorder.current?.focus()
    void record(side => {
      if (saving.current) return
      setCandidate({ kind: 'mouse', side }); setCaptureError(null); setRestoreIntent(false); setSaveError(null)
      recorder.current?.focus()
    }).catch(() => { if (mounted.current) setCaptureError(uiAttribute('无法开始录制，请重试。')) })
    const blur = (): void => setEditing(null)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('blur', blur); void record(null).catch(() => undefined) }
  }, [editing?.id, record])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])
  if (!shortcuts) return null
  const { platform, snapshot } = shortcuts
  const preferences = snapshot?.preferences
  const focusBinding = (id: ShortcutActionId): void => { requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-edit="${id}"]`)?.focus({ preventScroll: true })) }
  const closeEditor = (): void => { if (saving.current) return; setEditing(null); if (editing) focusBinding(editing.id) }
  const save = async (next: ShortcutPreferences, owner: SaveOwner, done?: () => void): Promise<void> => {
    if (saving.current) return
    const sourceFocus = document.activeElement
    saving.current = true; setBusy(true); setSaveError(null); setToast('')
    try {
      await shortcuts.save(next)
      if (mounted.current) { setToast(t('已保存快捷键设置')); done?.() }
    } catch (error) {
      if (mounted.current) setSaveError({ owner, message: error instanceof Error ? t(error.message) : t('无法保存快捷键设置，请重试。') })
    } finally {
      saving.current = false
      if (mounted.current) {
        setBusy(false)
        setFocusRequest({ owner, source: sourceFocus })
      }
    }
  }
  const sidesFor = (id: ShortcutActionId): ShortcutMouseSide[] => SHORTCUT_MOUSE_SIDES.filter(side => preferences?.mouse[side] === id)
  const mouseLabel = (side: ShortcutMouseSide): string => t(side === 'side1' ? '侧键 1' : '侧键 2')
  const keycaps = (binding: string | null): React.JSX.Element => binding
    ? <span className="shortcut-keycaps">{shortcutKeyParts(binding, platform).map((key, i) => <kbd key={i}>{t(key)}</kbd>)}</span>
    : <span className="shortcut-unbound">{t('未绑定')}</span>
  const openEditor = (row: Command): void => { setEditing(row); setCandidate(null); setCaptureError(null); setRestoreIntent(false); setSaveError(null) }
  const conflict = candidate && editing && preferences ? SHORTCUTS.find(row => available(row.id) && row.id !== editing.id && (candidate.kind === 'keyboard' ? preferences.bindings[row.id] === candidate.binding : preferences.mouse[candidate.side] === row.id)) : null
  const unchanged = candidate && editing && preferences && !restoreIntent && (candidate.kind === 'keyboard' ? preferences.bindings[editing.id] === candidate.binding : preferences.mouse[candidate.side] === editing.id)
  const commitCandidate = (): void => {
    if (!preferences || !editing || !available(editing.id) || !candidate || captureError || unchanged) return
    const next = structuredClone(preferences)
    if (candidate.kind === 'mouse') next.mouse[candidate.side] = editing.id
    else {
      next.bindings[editing.id] = candidate.binding
      for (const row of SHORTCUTS) if (row.id !== editing.id && next.bindings[row.id] === candidate.binding) next.bindings[row.id] = null
      if (restoreIntent) for (const side of sidesFor(editing.id)) next.mouse[side] = null
    }
    void save(next, editing.id, () => setEditing(null))
  }
  const restoreOne = (row: Command): void => {
    if (!preferences || !available(row.id)) return
    if (row.binding && SHORTCUTS.some(other => available(other.id) && other.id !== row.id && preferences.bindings[other.id] === row.binding)) {
      setEditing(row); setCandidate({ kind: 'keyboard', binding: row.binding }); setCaptureError(null); setRestoreIntent(true); return
    }
    const next = structuredClone(preferences)
    if (row.binding) for (const other of SHORTCUTS) if (other.id !== row.id && next.bindings[other.id] === row.binding) next.bindings[other.id] = null
    next.bindings[row.id] = row.binding
    for (const side of sidesFor(row.id)) next.mouse[side] = null
    void save(next, row.id)
  }
  const capture = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || busy) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); return }
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { commitCandidate(); return }
    const binding = normalizeShortcut(event.nativeEvent, platform)
    if (!binding) return
    setCandidate({ kind: 'keyboard', binding }); setCaptureError(validateShortcut(binding, platform)); setRestoreIntent(false); setSaveError(null)
  }
  const renderField = (row: Command): React.JSX.Element => {
    const assigned = sidesFor(row.id)
    const active = editing?.id === row.id
    const binding = preferences!.bindings[row.id]
    const fieldSaveError = saveError?.owner === row.id ? saveError.message : null
    return <div className={`shortcut-field${active ? ' is-editing' : ''}`} key={row.id} data-command={row.id} onKeyDown={active ? event => { if (event.key === 'Escape') { event.preventDefault(); closeEditor() } } : undefined}>
      <div className="shortcut-field-label"><label id={`shortcut-label-${row.id}`} htmlFor={`shortcut-binding-${row.id}`}>{t(row.name)}</label>
        {!active && (binding !== row.binding || assigned.length > 0) && <button type="button" className="shortcut-restore" disabled={busy} onClick={() => restoreOne(row)} aria-label={t('恢复{0}默认绑定', t(row.name))} title={t('恢复默认键盘快捷键，并清除本项的侧键绑定')}>{t('恢复默认')}</button>}
      </div>
      {active ? <>
        <div ref={recorder} id={`shortcut-binding-${row.id}`} className={`shortcut-inline-recorder${captureError ? ' is-invalid' : ''}`} tabIndex={0} role="group" aria-invalid={!!captureError} aria-labelledby={`shortcut-label-${row.id}`} aria-describedby={`shortcut-result-${row.id}`} onKeyDown={capture}>
          {candidate ? candidate.kind === 'keyboard' ? keycaps(candidate.binding) : <span className="shortcut-mouse-key">{mouseLabel(candidate.side)}</span> : <span>{t('请按下快捷键')}</span>}
        </div>
        <div className="shortcut-inline-feedback" id={`shortcut-result-${row.id}`} aria-live="polite">
          {fieldSaveError ? <p className="shortcut-validation-error" role="alert">{fieldSaveError}</p>
            : captureError ? <p className="shortcut-validation-error" role="alert">{t(captureError)}</p>
            : conflict ? <div className="shortcut-conflict" role="alert"><strong>{t('已用于「{0}」', t(conflict.name))}</strong><p>{t(candidate?.kind === 'mouse' ? '仅转移此侧键，原键盘快捷键保留。' : restoreIntent ? '替换组合键，并清除本项的侧键绑定。' : '仅替换这个组合键，侧键绑定保留。')}</p></div>
            : candidate && <p className="shortcut-record-valid">{t(unchanged ? '已绑定到当前操作' : 'Enter 保存 · Esc 取消')}</p>}
        </div>
        <div className="shortcut-inline-actions"><button type="button" className="quiet-button" disabled={busy} onClick={closeEditor}>{t('取消')}</button><button type="button" className="primary-button" disabled={busy || !candidate || !!captureError || !!unchanged} aria-busy={busy} onClick={commitCandidate}>
          <BusyLabel busy={busy}>{t(conflict && !captureError ? '替换并保存' : '保存')}</BusyLabel>
        </button></div>
      </> : <><div className={`shortcut-bindings${assigned.length ? ' has-mouse' : ''}`}>
        <div className="shortcut-field-control"><button className="shortcut-binding" id={`shortcut-binding-${row.id}`} type="button" data-edit={row.id} disabled={busy} title={t('点击录制键盘或鼠标侧键')} aria-label={t('修改{0}绑定，{1}', t(row.name), binding ? shortcutKeyParts(binding, platform).map(key => t(key)).join(' ') : t('键盘未绑定'))} onClick={() => openEditor(row)}>{keycaps(binding)}</button><button type="button" className="shortcut-clear" disabled={busy || !binding} title={t('清除键盘快捷键')} aria-label={t('清除{0}键盘快捷键', t(row.name))} onClick={() => { void save({ ...preferences!, bindings: { ...preferences!.bindings, [row.id]: null } }, row.id) }}><DialogControlIcon name="close" /></button></div>
        {assigned.map(side => <div className="shortcut-field-control shortcut-mouse-control" key={side}><button type="button" className="shortcut-binding" disabled={busy} onClick={() => openEditor(row)} aria-label={t('修改{0}的{1}', t(row.name), mouseLabel(side))}><span className="shortcut-mouse-key">{mouseLabel(side)}</span></button><button type="button" className="shortcut-clear" disabled={busy} aria-label={t('清除{0}的{1}', t(row.name), mouseLabel(side))} onClick={() => { void save({ ...preferences!, mouse: { ...preferences!.mouse, [side]: null } }, row.id) }}><DialogControlIcon name="close" /></button></div>)}
      </div>{fieldSaveError && <div className="shortcut-inline-feedback"><p className="shortcut-validation-error" role="alert">{fieldSaveError}</p></div>}</>}
    </div>
  }
  const group = (key: Command['group'], title: string): React.JSX.Element => <section className={`shortcut-section${key === 'workspace' ? ' shortcut-workspace-section' : ''}`} aria-label={t(title)}><div className="section-heading"><h2>{t(title)}</h2></div><div className="shortcut-fields">{SHORTCUTS.filter(row => row.group === key && available(row.id)).map(renderField)}</div></section>
  return <div className="general-settings shortcut-settings" data-layout="side" aria-busy={busy}>
    <SettingsPageHeader eyebrow="" title={t('快捷键')} description={t('点击右侧按键区，再按键盘快捷键或鼠标侧键。')} />
    {shortcuts.error && <div className="shortcut-save-error" role="alert"><span>{shortcuts.error}</span><button type="button" className="quiet-button" onClick={() => { void shortcuts.reload() }}>{t('重试')}</button></div>}
    {snapshot?.degraded && <div className="shortcut-save-error" role="alert">{t('快捷键配置无法读取，暂时使用默认设置。保存后会替换原配置。')}</div>}
    {!preferences ? <p role="status">{t('正在加载…')}</p> : <>
      {group('workspace', '会话工作区')}
      <section className="shortcut-section" aria-label={t('输入')}><div className="section-heading"><h2>{t('输入')}</h2></div><div className="shortcut-fields"><div className="shortcut-field"><div className="shortcut-field-label"><label htmlFor="shortcut-send-mode">{t('发送消息')}</label></div><select id="shortcut-send-mode" className="setting-select" disabled={busy} value={preferences.sendMode} onChange={event => { setEditing(null); void save({ ...preferences, sendMode: event.target.value as ShortcutPreferences['sendMode'] }, 'send') }}><option value="enter">{t('Enter 发送')}</option><option value="primary-enter">{t('{0} + Enter 发送', platform === 'darwin' ? '⌘' : 'Ctrl')}</option></select>{saveError?.owner === 'send' && <div className="shortcut-inline-feedback"><p className="shortcut-validation-error" role="alert">{saveError.message}</p></div>}</div></div></section>
      {group('navigation', '应用与导航')}{group('files', '查找与文件')}
      <div className="shortcut-page-footer"><button type="button" className="quiet-button" disabled={busy || JSON.stringify(preferences) === JSON.stringify(defaults)} onClick={() => { setEditing(null); setSaveError(null); setResetOpen(true) }}><DialogControlIcon name="refresh" />{t('恢复所有默认设置')}</button></div>
    </>}
    <div className={`shortcut-toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">{toast && <><DialogControlIcon name="check" /><span>{toast}</span></>}</div>
    <Dialog.Root open={resetOpen} onOpenChange={value => { if (!busy) setResetOpen(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent tone="neutral" className="shortcut-reset-dialog"><AppDialogHeader title={t('恢复默认快捷键？')} description={t('所有自定义按键将恢复为默认值，鼠标侧键恢复为不绑定，发送方式恢复为 Enter 发送。')} closeDisabled={busy} /><AppDialogFooter><Dialog.Close asChild><button type="button" className="quiet-button" disabled={busy} data-dialog-autofocus>{t('取消')}</button></Dialog.Close><button type="button" className="primary-button" disabled={busy} onClick={() => { void save(shortcutDefaults(), 'reset', () => setResetOpen(false)) }}>{t('恢复默认')}</button></AppDialogFooter>{saveError?.owner === 'reset' && <p className="shortcut-save-error" role="alert">{saveError.message}</p>}</AppDialogContent></Dialog.Portal></Dialog.Root>
  </div>
}
