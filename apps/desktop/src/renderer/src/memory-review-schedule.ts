import type { MemoryRecord } from '@contracts'

export const reviewSchedulePresetModes = ['30', '90', '180'] as const

export type ReviewSchedulePresetMode = typeof reviewSchedulePresetModes[number]
export type ReviewScheduleMode = ReviewSchedulePresetMode | 'custom'

export interface ReviewScheduleDraft {
  memory: MemoryRecord
  mode: ReviewScheduleMode
  localDateTime: string
  openedAt: string
}

export interface ReviewScheduleValidation {
  selectedDate: Date | null
  code: 'required' | 'invalid' | 'past' | 'unchanged' | null
  message: string | null
  invalid: boolean
}

export function createReviewScheduleDraft(
  memory: MemoryRecord,
  now = new Date()
): ReviewScheduleDraft {
  const openedAt = minutePrecision(now)
  const existing = memory.reviewAfter ? new Date(memory.reviewAfter) : null
  const existingIsValid = existing !== null && !Number.isNaN(existing.getTime())

  return {
    memory,
    mode: existingIsValid ? 'custom' : '90',
    localDateTime: toLocalDateTimeValue(existingIsValid
      ? existing
      : addLocalCalendarDays(openedAt, 90)),
    openedAt: openedAt.toISOString()
  }
}

export function addLocalCalendarDays(base: Date, days: number): Date {
  const result = minutePrecision(base)
  result.setDate(result.getDate() + days)
  return result
}

export function toLocalDateTimeValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseLocalDateTimeValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null

  const parsed = new Date(0)
  parsed.setFullYear(year, month - 1, day)
  parsed.setHours(hour, minute, 0, 0)
  if (parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
    || parsed.getHours() !== hour
    || parsed.getMinutes() !== minute) {
    return null
  }
  return parsed
}

export function selectedReviewScheduleDate(draft: ReviewScheduleDraft): Date | null {
  if (draft.mode === 'custom') return parseLocalDateTimeValue(draft.localDateTime)
  const openedAt = new Date(draft.openedAt)
  if (Number.isNaN(openedAt.getTime())) return null
  return addLocalCalendarDays(openedAt, Number(draft.mode))
}

export function validateReviewScheduleDraft(
  draft: ReviewScheduleDraft,
  now = new Date()
): ReviewScheduleValidation {
  const selectedDate = selectedReviewScheduleDate(draft)
  if (draft.mode === 'custom' && draft.localDateTime === '') {
    return {
      selectedDate: null,
      code: 'required',
      message: '请选择下次复核时间。',
      invalid: true
    }
  }
  if (!selectedDate) {
    return {
      selectedDate: null,
      code: 'invalid',
      message: '请选择有效且确实存在的本地日期和时间。',
      invalid: true
    }
  }
  if (selectedDate.getTime() <= now.getTime()) {
    return {
      selectedDate,
      code: 'past',
      message: '请选择晚于当前时间的复核时间。',
      invalid: true
    }
  }
  if (reviewScheduleMatchesValue(selectedDate, draft.memory.reviewAfter)) {
    return {
      selectedDate,
      code: 'unchanged',
      message: '当前选择与已有复核时间相同，无需重复保存。',
      invalid: false
    }
  }
  return { selectedDate, code: null, message: null, invalid: false }
}

export function reviewScheduleMatchesValue(
  selectedDate: Date | null,
  reviewAfter: string | null
): boolean {
  if (!selectedDate || !reviewAfter) return selectedDate === null && reviewAfter === null
  const existing = new Date(reviewAfter)
  return !Number.isNaN(existing.getTime())
    && toLocalDateTimeValue(selectedDate) === toLocalDateTimeValue(existing)
}

export function formatReviewPresetDate(date: Date, reference: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }
  if (date.getFullYear() !== reference.getFullYear()) options.year = 'numeric'
  return new Intl.DateTimeFormat('zh-CN', options).format(date)
}

export function localTimeZoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区'
}

export function nextLocalMinute(now = new Date()): Date {
  const result = minutePrecision(now)
  result.setMinutes(result.getMinutes() + 1)
  return result
}

function minutePrecision(date: Date): Date {
  const result = new Date(date.getTime())
  result.setSeconds(0, 0)
  return result
}
