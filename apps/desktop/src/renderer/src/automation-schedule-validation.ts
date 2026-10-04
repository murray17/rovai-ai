import { uiAttribute } from './interface-language'
import { CronExpressionParser } from 'cron-parser'
import type { AutomationSchedule } from '@contracts'

const fields = [
  { label: '分钟', min: 0, max: 59 },
  { label: '小时', min: 0, max: 23 },
  { label: '日期', min: 1, max: 31 },
  { label: '月份', min: 1, max: 12 },
  { label: '星期', min: 0, max: 7 },
]

export function validateCron(value: string): string {
  const expression = value.trim()
  if (!expression) return uiAttribute('请输入 Cron 表达式，例如 0 9 * * *。')
  const parts = expression.split(/\s+/)
  if (parts.length !== 5) return uiAttribute('需要 5 个字段：分钟、小时、日期、月份、星期；用空格分隔。')

  // Parsing each field separately lets the UI identify the field to correct.
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    const probe = ['*', '*', '*', '*', '*']
    probe[index] = parts[index]
    try {
      // Strict mode requires six fields; the five-field constraint is enforced above.
      CronExpressionParser.parse(probe.join(' '))
    } catch {
      if (/^\d+$/.test(parts[index])) {
        return uiAttribute('{0}需在 {1}–{2} 之间，当前填写为 {3}。', uiAttribute(field.label), field.min, field.max, parts[index])
      }
      if (/\/0+(?:,|$)/.test(parts[index])) return uiAttribute('{0}的步长必须大于 0，例如 */5。', uiAttribute(field.label))
      return uiAttribute('{0}写法无效。取值范围为 {1}–{2}，可使用 *、逗号列表、范围和正整数步长。', uiAttribute(field.label), field.min, field.max)
    }
  }

  try {
    CronExpressionParser.parse(expression)
    return ''
  } catch {
    return uiAttribute('Cron 表达式无效，请检查日期与月份等字段组合。')
  }
}

export function automationScheduleError(schedule: AutomationSchedule): string {
  if (schedule.kind === 'cron') return validateCron(schedule.expression)
  if ('at' in schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.at)) return uiAttribute('请选择有效时间。')
  if (schedule.kind === 'once') {
    const date = new Date(`${schedule.date}T12:00:00`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date) || Number.isNaN(date.getTime())
      || date.getFullYear() !== Number(schedule.date.slice(0, 4))
      || date.getMonth() + 1 !== Number(schedule.date.slice(5, 7))
      || date.getDate() !== Number(schedule.date.slice(8, 10))) return uiAttribute('请选择有效日期。')
  }
  return ''
}
