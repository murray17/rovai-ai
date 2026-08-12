import { describe, expect, it } from 'vitest'
import { parseClipboardWriteRequest } from './clipboard-write'

describe('clipboard write boundary', () => {
  it('accepts plain text with an optional private HTML representation', () => {
    expect(parseClipboardWriteRequest({ text: '@爱丽丝', html: '<span>@爱丽丝</span>' })).toEqual({
      text: '@爱丽丝',
      html: '<span>@爱丽丝</span>'
    })
    expect(parseClipboardWriteRequest({ text: '普通正文', html: null })).toEqual({
      text: '普通正文'
    })
  })

  it('rejects malformed and unbounded requests', () => {
    expect(() => parseClipboardWriteRequest(null)).toThrow('Unsupported clipboard write request')
    expect(() => parseClipboardWriteRequest({ text: 1 })).toThrow('Unsupported clipboard write request')
    expect(() => parseClipboardWriteRequest({ text: '正文', html: 1 })).toThrow('Unsupported clipboard write request')
    expect(() => parseClipboardWriteRequest({ text: 'x'.repeat(1_000_001) }))
      .toThrow('Unsupported clipboard write request')
  })
})
