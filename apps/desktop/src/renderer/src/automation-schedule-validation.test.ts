import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { automationScheduleError, validateCron } from './automation-schedule-validation'
import { automationDateKey, normalizeAutomationTime, stepAutomationTime } from './AutomationSchedulePickers'
import { AutomationEditor } from './AutomationEditor'
import { defaultDraft } from './automation-workspace-model'

describe('scheduled task input validation', () => {
  it('identifies the reported invalid minute and rejects other field boundaries', () => {
    expect(validateCron('600 9 * * *')).toBe('分钟需在 0–59 之间，当前填写为 600。')
    for (const expression of ['60 9 * * *', '0 24 * * *', '0 9 0 * *', '0 9 32 * *', '0 9 * 13 *', '0 9 * * 8']) {
      expect(automationScheduleError({ kind: 'cron', expression }), expression).not.toBe('')
    }
  })
  it('rejects missing fields, extra seconds, empty lists and zero steps', () => {
    for (const expression of ['', '* * * *', '0 0 9 * * *', '*/0 9 * * *', '0 9 * * 1,,2', '0 9 * * 5-1', '0,600 9 * * *']) {
      expect(validateCron(expression), expression).not.toBe('')
    }
  })
  it('accepts valid bounds, lists, ranges, names, steps and both day fields', () => {
    for (const expression of ['0 9 * * *', '59 23 31 12 7', '*/5 9-18 * * 1-5', '0,30 9 * JAN,MAR MON-FRI', '0 9 1 * MON']) {
      expect(validateCron(expression), expression).toBe('')
    }
  })
  it('validates dates without silently rolling them into another month', () => {
    expect(automationScheduleError({ kind: 'once', date: '2028-02-29', at: '23:59' })).toBe('')
    expect(automationScheduleError({ kind: 'once', date: '2026-02-29', at: '09:00' })).not.toBe('')
    expect(automationScheduleError({ kind: 'daily', at: '24:00' })).not.toBe('')
  })
  it('renders an actionable inline error and a disabled Save for invalid Cron', () => {
    const html = renderToStaticMarkup(createElement(AutomationEditor, {
      draft: { ...defaultDraft(''), prompt: '检查待办', schedule: { kind: 'cron', expression: '600 9 * * *' } },
      onChange: () => undefined, agents: [], projects: [], automation: null,
      busy: false, onOpenCamp: () => undefined, onCreate: () => undefined
    }))
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('分钟需在 0–59 之间，当前填写为 600。')
    expect(html).toMatch(/type="submit" disabled="">保存/)
  })
})

describe('time and date picker boundaries', () => {
  it('keeps leading zeros and carries minute steps across midnight', () => {
    expect(normalizeAutomationTime('9', '7')).toBe('09:07')
    expect(stepAutomationTime('23:55', 'minute', 5)).toBe('00:00')
    expect(stepAutomationTime('00:00', 'minute', -5)).toBe('23:55')
    expect(stepAutomationTime('00:42', 'hour', -1)).toBe('23:42')
  })
  it('uses the selected local calendar day rather than UTC serialization', () => {
    expect(automationDateKey(new Date(2026, 8, 8, 0, 1))).toBe('2026-09-08')
  })
})
