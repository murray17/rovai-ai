import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as Dialog from '@radix-ui/react-dialog'
import { useMobileLayout } from './MobileLayout'
import { AutomationGlyph } from './AutomationControls'
import './automation-schedule-pickers.css'
import { UiText, getInterfaceLanguage, useInterfaceLanguage, uiAttribute } from './interface-language'

// The same calendar/time fields and schedule validation serve both surfaces.
function SchedulePopover({ open, onOpenChange, trigger, children, label, className, onOpenAutoFocus }: {
  open: boolean; onOpenChange(open: boolean): void; trigger: ReactNode; children: ReactNode
  label: string; className: string; onOpenAutoFocus(event: Event): void
}): React.JSX.Element {
  const mobile = useMobileLayout()
  if (mobile) return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="mobile-sheet-overlay" />
      <Dialog.Content className={`automation-schedule-popover mobile-schedule-sheet ${className}`} aria-describedby={undefined}>
        <header className="mobile-sheet-heading"><Dialog.Title>{label}</Dialog.Title><Dialog.Close className="mobile-icon-button" aria-label={uiAttribute("关闭日期时间选择")}>×</Dialog.Close></header>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal><Popover.Content onCloseAutoFocus={(event) => event.preventDefault()} className={`automation-schedule-popover ${className}`} align="end" sideOffset={8} collisionPadding={12} aria-label={label} onOpenAutoFocus={onOpenAutoFocus}>{children}</Popover.Content></Popover.Portal>
  </Popover.Root>
}

const presets = ['08:00', '09:00', '12:00', '17:30']
const pad = (value: number): string => String(value).padStart(2, '0')

export function normalizeAutomationTime(hour: string, minute: string): string {
  const clamp = (value: string, max: number): number => Math.max(0, Math.min(max, Number.parseInt(value, 10) || 0))
  return `${pad(clamp(hour, 23))}:${pad(clamp(minute, 59))}`
}

export function stepAutomationTime(value: string, unit: 'hour' | 'minute', amount: number): string {
  const [hour, minute] = value.split(':').map(Number)
  const total = (hour * 60 + minute + amount * (unit === 'hour' ? 60 : 1) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export function AutomationTimePicker({ value, onChange, disabled }: {
  value: string
  onChange(value: string): void
  disabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState(value.split(':'))
  const partsRef = useRef(parts)
  const hourInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const updateParts = (next: string[]): void => { partsRef.current = next; setParts(next) }
  useEffect(() => { if (!open) updateParts(value.split(':')) }, [value, open])
  const commit = (next = normalizeAutomationTime(partsRef.current[0], partsRef.current[1])): void => {
    updateParts(next.split(':'))
    if (next !== value) onChange(next)
  }
  const step = (unit: 'hour' | 'minute', amount: number): void => {
    commit(stepAutomationTime(normalizeAutomationTime(partsRef.current[0], partsRef.current[1]), unit, amount))
  }
  return <SchedulePopover open={open} onOpenChange={(next) => {
    if (next) updateParts(value.split(':'))
    else commit()
    setOpen(next)
  }} trigger={<button type="button" className="automation-picker automation-schedule-value" aria-label={uiAttribute("时间：{0}", String(value))} disabled={disabled}><AutomationGlyph name="clock" /><span>{value}</span><AutomationGlyph name="chevron" /></button>} className="automation-time-popover" label={uiAttribute("选择运行时间")} onOpenAutoFocus={(event) => { event.preventDefault(); hourInput.current?.focus(); hourInput.current?.select() }}>
      <div className="automation-time-heading"><strong><UiText zh={"选择时间"} /></strong><span><UiText zh={"24 小时制"} /></span></div>
      <div className="automation-time-editor">
        {(['hour', 'minute'] as const).map((unit, index) => <div className="automation-time-column" key={unit}>
          <label htmlFor={`${id}-${unit}`}>{index ? uiAttribute("分钟") : uiAttribute("小时")}</label>
          <div className="automation-time-stepper">
            <button type="button" disabled={disabled} aria-label={index ? uiAttribute("分钟加五") : uiAttribute("小时加一")} onClick={() => step(unit, index ? 5 : 1)}><AutomationGlyph name="chevron" /></button>
            <input ref={index ? undefined : hourInput} id={`${id}-${unit}`} role="spinbutton" aria-valuemin={0} aria-valuemax={index ? 59 : 23} aria-valuenow={Number(parts[index]) || 0} inputMode="numeric" maxLength={2} autoComplete="off" value={parts[index]} disabled={disabled}
              onFocus={(event) => event.target.select()} onChange={(event) => { const next = [...partsRef.current]; next[index] = event.target.value.replace(/\D/g, ''); updateParts(next) }}
              onBlur={() => commit()} onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); commit(); setOpen(false) }
                else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); step(unit, (index ? 5 : 1) * (event.key === 'ArrowUp' ? 1 : -1)); event.currentTarget.select() }
              }} />
            <button type="button" disabled={disabled} aria-label={index ? uiAttribute("分钟减五") : uiAttribute("小时减一")} onClick={() => step(unit, index ? -5 : -1)}><AutomationGlyph name="chevron" /></button>
          </div>
        </div>)}
        <span className="automation-time-colon" aria-hidden="true">:</span>
      </div>
      <p className="automation-time-presets-label"><UiText zh={"快捷时间"} /></p>
      <div className="automation-time-presets">{presets.map((preset) => <button type="button" key={preset} disabled={disabled} aria-pressed={normalizeAutomationTime(parts[0], parts[1]) === preset} onClick={() => { commit(preset); setOpen(false) }}>{preset}</button>)}</div>
      <div className="automation-time-footer"><span><UiText zh={"可直接输入时间"} /></span><button className="primary-button" type="button" disabled={disabled} onClick={() => { commit(); setOpen(false) }}><UiText zh={"完成"} /></button></div>
  </SchedulePopover>
}

function localDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}
export function automationDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const dateLabel = (date: Date): string => new Intl.DateTimeFormat(getInterfaceLanguage() === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)

export function AutomationDatePicker({ value, onChange, disabled }: {
  value: string
  onChange(value: string): void
  disabled: boolean
}): React.JSX.Element {
  const language = useInterfaceLanguage()
  const [open, setOpen] = useState(false)
  const selected = localDate(value)
  const safeDate = Number.isNaN(selected.getTime()) ? new Date() : selected
  const [month, setMonth] = useState(new Date(safeDate.getFullYear(), safeDate.getMonth(), 1, 12))
  const [focusedDate, setFocusedDate] = useState(value)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const focusPending = useRef(false)
  const today = automationDateKey(new Date())
  const start = new Date(month)
  start.setDate(1 - (month.getDay() + 6) % 7)
  const days = Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day })
  useEffect(() => {
    if (focusPending.current) { buttons.current.get(focusedDate)?.focus(); focusPending.current = false }
  }, [focusedDate, month])
  const moveFocus = (date: Date): void => {
    focusPending.current = true
    setFocusedDate(automationDateKey(date))
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12))
  }
  return <SchedulePopover open={open} onOpenChange={(next) => {
    if (next) { setMonth(new Date(safeDate.getFullYear(), safeDate.getMonth(), 1, 12)); setFocusedDate(automationDateKey(safeDate)) }
    setOpen(next)
  }} trigger={<button type="button" className="automation-picker automation-schedule-value" aria-label={uiAttribute("日期：{0}", String(value))} disabled={disabled}><AutomationGlyph name="calendar" /><span>{Number.isNaN(selected.getTime()) ? uiAttribute("选择日期") : dateLabel(selected)}</span><AutomationGlyph name="chevron" /></button>} className="automation-date-popover" label={uiAttribute("选择运行日期")} onOpenAutoFocus={(event) => { event.preventDefault(); buttons.current.get(automationDateKey(safeDate))?.focus() }}>
      <div className="automation-calendar-heading">
        <button type="button" aria-label={uiAttribute("上个月")} onClick={() => { const next = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12); setMonth(next); setFocusedDate(automationDateKey(next)) }}><AutomationGlyph name="back" /></button>
        <strong aria-live="polite">{language === 'en' ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long' }).format(month) : <>{month.getFullYear()}<UiText zh={" 年 "} />{month.getMonth() + 1}<UiText zh={" 月"} /></>}</strong>
        <button type="button" aria-label={uiAttribute("下个月")} onClick={() => { const next = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12); setMonth(next); setFocusedDate(automationDateKey(next)) }}><AutomationGlyph name="back" /></button>
      </div>
      <div className="automation-calendar-weekdays" aria-hidden="true">{(language === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['一', '二', '三', '四', '五', '六', '日']).map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="automation-calendar-grid">{days.map((day) => {
        const key = automationDateKey(day)
        return <button ref={(node) => { if (node) buttons.current.set(key, node); else buttons.current.delete(key) }} type="button" key={key} className={`automation-calendar-day ${day.getMonth() !== month.getMonth() ? 'outside' : ''}`} aria-label={dateLabel(day)} aria-pressed={key === value} aria-current={key === today ? 'date' : undefined} tabIndex={key === focusedDate ? 0 : -1} disabled={disabled} onClick={() => { onChange(key); setOpen(false) }} onKeyDown={(event) => {
          const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(day.getDay() + 6) % 7, End: 6 - (day.getDay() + 6) % 7 }
          const offset = offsets[event.key]
          if (offset !== undefined) { event.preventDefault(); const next = new Date(day); next.setDate(next.getDate() + offset); moveFocus(next) }
          else if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); const next = new Date(day.getFullYear(), day.getMonth() + (event.key === 'PageUp' ? -1 : 1), 1, 12); moveFocus(next) }
        }}>{day.getDate()}</button>
      })}</div>
  </SchedulePopover>
}
