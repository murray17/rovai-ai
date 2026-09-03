import { describe, expect, it } from 'vitest'
import { parseResolveMessageFileReferencesRequest } from './file-preview-ipc-input'

describe('parseResolveMessageFileReferencesRequest', () => {
  it('accepts a bounded message-scoped batch', () => {
    expect(parseResolveMessageFileReferencesRequest({
      campId: 'rvcamp_01m1jsyjfteehvs6pch0mjcdff',
      messageId: 'message-1',
      rawReferences: ['config.toml', 'demo.mp4']
    })).toEqual({
      campId: 'rvcamp_01m1jsyjfteehvs6pch0mjcdff',
      messageId: 'message-1',
      rawReferences: ['config.toml', 'demo.mp4']
    })
  })

  it('rejects empty, oversized, and malformed batches', () => {
    expect(() => parseResolveMessageFileReferencesRequest({
      campId: 'rvcamp_01m1jsyjfteehvs6pch0mjcdff', messageId: 'message-1', rawReferences: []
    })).toThrow()
    expect(() => parseResolveMessageFileReferencesRequest({
      campId: 'rvcamp_01m1jsyjfteehvs6pch0mjcdff', messageId: 'message-1',
      rawReferences: Array.from({ length: 65 }, (_, index) => `file-${index}.txt`)
    })).toThrow()
    expect(() => parseResolveMessageFileReferencesRequest({
      campId: 'rvcamp_01m1jsyjfteehvs6pch0mjcdff', messageId: 'message-1', rawReferences: ['bad\0.txt']
    })).toThrow()
  })
})
