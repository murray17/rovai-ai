import { describe, expect, it } from 'vitest'
import { readErrorMessage } from './error-message'

describe('readErrorMessage', () => {
  it.each([
    [new Error('local failure'), 'local failure'],
    [{ code: 'full_core_unavailable', message: 'Core 正在重启', retryable: true }, 'Core 正在重启'],
    [{ message: '' }, ''],
    ['plain failure', 'plain failure'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{ message: 42 }, '[object Object]']
  ])('reads messages without relying on Error identity (%s)', (error, expected) => {
    expect(readErrorMessage(error)).toBe(expected)
  })

  it('preserves caller-specific fallbacks without replacing structured messages', () => {
    expect(readErrorMessage(null, '请求失败')).toBe('请求失败')
    expect(readErrorMessage({}, null)).toBeNull()
    expect(readErrorMessage({ message: '请求已过期' }, '请求失败')).toBe('请求已过期')
  })
})
