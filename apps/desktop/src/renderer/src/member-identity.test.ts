import { describe, expect, it } from 'vitest'
import { firstGrapheme } from './member-identity'

describe('firstGrapheme', () => {
  it('keeps composed user-perceived characters intact', () => {
    expect(firstGrapheme('沐瓦')).toBe('沐')
    expect(firstGrapheme('  e\u0301clair')).toBe('e\u0301')
    expect(firstGrapheme('👩🏽‍💻 developer')).toBe('👩🏽‍💻')
  })

  it('uses a stable neutral fallback for a blank name', () => {
    expect(firstGrapheme(' \n ')).toBe('·')
  })
})
