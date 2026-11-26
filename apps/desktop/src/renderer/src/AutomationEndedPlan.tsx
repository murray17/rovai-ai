import { useState } from 'react'
import { AutomationGlyph, AutomationRunOnce } from './AutomationControls'
import { AutomationDatePicker, AutomationTimePicker, automationDateKey } from './AutomationSchedulePickers'
import { futureOnceSchedule, type OnceSchedule } from './automation-workspace-model'
import { BusyLabel } from './BusyLabel'
import { UiText, uiAttribute } from './interface-language'

export function AutomationEndedPlan({ schedule, disabled, running, saving, editing, onEdit, onRun, onConfirm }: {
  schedule: OnceSchedule
  disabled: boolean
  saving: boolean
  running: boolean
  editing: boolean
  onEdit(editing: boolean): void
  onRun(): void
  onConfirm(next: OnceSchedule): void
}): React.JSX.Element {
  return <section className="automation-ended-plan" aria-label={uiAttribute('计划已结束')}>
    <p><AutomationGlyph name="calendar" /><span><strong><UiText zh="计划已结束" /></strong>
      <small>{uiAttribute('{0} {1} 已过，不会再自动运行。', schedule.date, schedule.at)}</small></span></p>
    {editing ? <RescheduleForm at={schedule.at} disabled={disabled} saving={saving} onCancel={() => onEdit(false)} onConfirm={onConfirm} />
      : <div className="automation-plan-actions">
        <AutomationRunOnce disabled={disabled} running={running} onRun={onRun} />
        <button type="button" className="quiet-button compact" disabled={disabled} onClick={() => onEdit(true)}>
          <AutomationGlyph name="calendar" /><UiText zh="重新安排" />
        </button>
      </div>}
  </section>
}

function RescheduleForm({ at, disabled, saving, onCancel, onConfirm }: {
  at: string
  disabled: boolean
  saving: boolean
  onCancel(): void
  onConfirm(next: OnceSchedule): void
}): React.JSX.Element {
  const [next, setNext] = useState<OnceSchedule>(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { kind: 'once', date: automationDateKey(tomorrow), at }
  })
  const valid = futureOnceSchedule(next)
  return <form className="automation-reschedule" aria-label={uiAttribute('重新安排')} onSubmit={event => {
    event.preventDefault()
    if (!disabled && futureOnceSchedule(next)) onConfirm(next)
  }}>
    <span><UiText zh="新的运行时间" /></span>
    <div className="automation-reschedule-fields">
      <AutomationDatePicker value={next.date} disabled={disabled} onChange={date => setNext({ ...next, date })} />
      <AutomationTimePicker value={next.at} disabled={disabled} onChange={at => setNext({ ...next, at })} />
    </div>
    {!valid && <span className="automation-schedule-error" role="status"><UiText zh="请选择晚于现在的时间。" /></span>}
    <div className="automation-plan-actions">
      <button type="button" className="quiet-button compact" disabled={disabled} onClick={onCancel}><UiText zh="取消" /></button>
      <button type="submit" className="primary-button" disabled={disabled || !valid} aria-busy={saving}>
        <BusyLabel busy={saving}><UiText zh="确认并开启" /></BusyLabel>
      </button>
    </div>
  </form>
}
