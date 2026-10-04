import { describe, expect, it } from 'vitest'
import { optionalChannelKind } from './channel-kind-input'

describe('Desktop IPC channel kind admission', () => {
  it.each(['feishu', 'lark', 'dingtalk'] as const)('admits %s', (kind) => {
    expect(optionalChannelKind(kind)).toBe(kind)
  })

  it('keeps an omitted kind as the Feishu default', () => {
    expect(optionalChannelKind(undefined)).toBeUndefined()
  })

  it.each(['telegram', '', 'Lark', '__proto__', 'toString', 'constructor', 'hasOwnProperty', null, 1, true, {}, ['lark']])(
    'rejects %j', (value) => {
      expect(() => optionalChannelKind(value)).toThrow('Invalid channel kind')
    }
  )
})
