import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryRecord } from '@contracts'
import {
  addLocalCalendarDays,
  createReviewScheduleDraft,
  formatReviewPresetDate,
  parseLocalDateTimeValue,
  reviewScheduleMatchesValue,
  selectedReviewScheduleDate,
  toLocalDateTimeValue,
  validateReviewScheduleDraft,
  type ReviewScheduleDraft
} from './memory-review-schedule'

const originalTimeZone = process.env.TZ

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
})

describe('Memory review schedule time handling', () => {
  it('round-trips datetime-local values in the device timezone without UTC slicing', () => {
    const local = new Date(2026, 7, 20, 13, 45, 37, 900)
    const value = toLocalDateTimeValue(local)

    expect(value).toBe('2026-08-20T13:45')
    expect(parseLocalDateTimeValue(value)?.getTime()).toBe(new Date(2026, 7, 20, 13, 45).getTime())
  })

  it('rejects nonexistent local times in a daylight-saving gap', () => {
    process.env.TZ = 'America/New_York'

    expect(parseLocalDateTimeValue('2026-03-08T02:30')).toBeNull()
    expect(parseLocalDateTimeValue('2026-03-08T03:30')).not.toBeNull()
  })

  it('calculates presets as local calendar days across daylight-saving changes', () => {
    process.env.TZ = 'America/New_York'
    const base = new Date(2026, 2, 7, 12, 15)
    const nextDay = addLocalCalendarDays(base, 1)

    expect(toLocalDateTimeValue(nextDay)).toBe('2026-03-08T12:15')
    expect(nextDay.getTime() - base.getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it('defaults an unset reminder to a stable 90-day minute', () => {
    const now = new Date(2026, 7, 20, 13, 45, 59, 999)
    const draft = createReviewScheduleDraft(memory(null), now)

    expect(draft.mode).toBe('90')
    expect(draft.localDateTime).toBe(toLocalDateTimeValue(addLocalCalendarDays(now, 90)))
    expect(selectedReviewScheduleDate(draft)?.getSeconds()).toBe(0)
  })

  it('treats an existing value in the same displayed minute as unchanged', () => {
    const existing = new Date(2026, 10, 18, 9, 30, 42).toISOString()
    const draft = createReviewScheduleDraft(memory(existing), new Date(2026, 7, 20, 13, 45))
    const validation = validateReviewScheduleDraft(draft, new Date(2026, 7, 20, 13, 46))

    expect(draft.mode).toBe('custom')
    expect(validation.code).toBe('unchanged')
    expect(validation.invalid).toBe(false)
    expect(reviewScheduleMatchesValue(validation.selectedDate, existing)).toBe(true)
  })

  it('explains required, invalid, past, and unchanged disabled states', () => {
    const base: ReviewScheduleDraft = {
      ...createReviewScheduleDraft(memory(null), new Date(2026, 7, 20, 10, 0)),
      mode: 'custom',
      localDateTime: ''
    }

    expect(validateReviewScheduleDraft(base, new Date(2026, 7, 20, 10, 0)).code).toBe('required')
    expect(validateReviewScheduleDraft({ ...base, localDateTime: '2026-02-30T10:00' }).code).toBe('invalid')
    expect(validateReviewScheduleDraft({ ...base, localDateTime: '2026-08-20T09:59' }, new Date(2026, 7, 20, 10, 0)).code).toBe('past')

    const existing = new Date(2026, 7, 21, 10, 0).toISOString()
    const unchanged = {
      ...base,
      memory: memory(existing),
      localDateTime: '2026-08-21T10:00'
    }
    expect(validateReviewScheduleDraft(unchanged, new Date(2026, 7, 20, 10, 0)).message)
      .toContain('无需重复保存')
  })

  it('shows a year when a preset crosses into another year', () => {
    const reference = new Date(2026, 11, 20, 8, 5)
    const target = addLocalCalendarDays(reference, 30)

    expect(formatReviewPresetDate(target, reference)).toContain('2027')
    expect(formatReviewPresetDate(target, reference)).toMatch(/08:05|8:05/)
  })
})

describe('Memory review schedule Renderer seam', () => {
  it('uses AppDialog without restoring the removed prompt or status block', () => {
    const source = readFileSync(new URL('./MemoryLibrary.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('window.prompt')
    expect(source).not.toContain('当前提醒')
    expect(source).not.toContain('设置复核时间')
    expect(source).toContain('设置下次复核')
    expect(source).toContain('AppDialogContent')
  })
})

function memory(reviewAfter: string | null): MemoryRecord {
  return {
    id: 'memory-review-schedule-test',
    lifecycle: 'active',
    reviewAfter
  } as MemoryRecord
}
