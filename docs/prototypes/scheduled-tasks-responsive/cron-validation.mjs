import { CronExpressionParser } from 'cron-parser/dist/CronExpressionParser.js';

const fields = [
  { label: '分钟', min: 0, max: 59 },
  { label: '小时', min: 0, max: 23 },
  { label: '日期', min: 1, max: 31 },
  { label: '月份', min: 1, max: 12 },
  { label: '星期', min: 0, max: 7 },
];

export function validateCron(value) {
  const expression = value.trim();
  if (!expression) return '请输入 Cron 表达式，例如 0 9 * * *。';
  const parts = expression.split(/\s+/);
  if (parts.length !== 5) return '需要 5 个字段：分钟、小时、日期、月份、星期；用空格分隔。';

  // Parsing each field separately lets the UI identify the field to correct.
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    const probe = ['*', '*', '*', '*', '*'];
    probe[index] = parts[index];
    try {
      // Strict mode requires six fields; the five-field constraint is enforced above.
      CronExpressionParser.parse(probe.join(' '));
    } catch {
      if (/^\d+$/.test(parts[index])) {
        return `${field.label}需在 ${field.min}–${field.max} 之间，当前填写为 ${parts[index]}。`;
      }
      if (/\/0+(?:,|$)/.test(parts[index])) return `${field.label}的步长必须大于 0，例如 */5。`;
      return `${field.label}写法无效。取值范围为 ${field.min}–${field.max}，可使用 *、逗号列表、范围和正整数步长。`;
    }
  }

  try {
    CronExpressionParser.parse(expression);
    return '';
  } catch {
    return 'Cron 表达式无效，请检查日期与月份等字段组合。';
  }
}
