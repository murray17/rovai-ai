import { describe, expect, it } from 'vitest'
import type { StructuredCampMessageContent } from '@contracts'
import {
  collapsedMessageProjection,
  explicitMessageLineCount
} from './conversation-message-collapse'

describe('conversation message collapse', () => {
  it('counts explicit LF, CRLF, and CR lines without treating an empty body as a line', () => {
    expect(explicitMessageLineCount('')).toBe(0)
    expect(explicitMessageLineCount('一')).toBe(1)
    expect(explicitMessageLineCount('一\n二\r\n三\r四')).toBe(4)
  })

  it('does not collapse a message with exactly 20 lines', () => {
    const body = Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    expect(collapsedMessageProjection(body, [{ kind: 'text', text: body }])).toBeNull()
  })

  it('keeps the first 19 lines and preserves structured tokens before the cutoff', () => {
    const firstTenLines = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 行`).join('\n')
    const remainingLines = Array.from({ length: 12 }, (_, index) => `第 ${index + 11} 行`).join('\r\n')
    const content: StructuredCampMessageContent = [
      { kind: 'text', text: `${firstTenLines}\n` },
      { kind: 'member_mention', agentId: 'agent_1' },
      { kind: 'text', text: ` ${remainingLines}` }
    ]
    const body = `${firstTenLines}\n@洛可 ${remainingLines}`
    const projection = collapsedMessageProjection(body, content)

    expect(projection?.lineCount).toBe(22)
    expect(projection?.body).toBe(`${firstTenLines}\n@洛可 ${
      Array.from({ length: 9 }, (_, index) => `第 ${index + 11} 行`).join('\r\n')
    }`)
    expect(projection?.content).toEqual([
      { kind: 'text', text: `${firstTenLines}\n` },
      { kind: 'member_mention', agentId: 'agent_1' },
      {
        kind: 'text',
        text: ` ${Array.from({ length: 9 }, (_, index) => `第 ${index + 11} 行`).join('\r\n')}`
      }
    ])
  })
})
