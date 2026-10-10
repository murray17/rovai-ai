import { describe, expect, it } from 'vitest'
import { environmentNeedsConsent, parseMemberEnvironment } from './member-environment'

describe('member environment JSON boundary', () => {
  it('preserves literal strings, empty overrides and deletion without shell expansion', () => {
    const values = { EMPTY: '', LITERAL: ' $HOME ${VAR} ~ " quote\n$(echo no) ' }
    expect(parseMemberEnvironment(JSON.stringify(values), false, 'pi', undefined)).toEqual(values)
    expect(parseMemberEnvironment('', false, 'pi', undefined)).toEqual({})
  })
  it('rejects duplicate decoded keys, Windows aliases, non-string values and reserved variables', () => {
    for (const text of ['{"A":"x","\\u0041":"y"}', '[]', 'null', '{"A":1}', '{"rovai_TOKEN":"secret"}', '{"CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST":"1"}', '{"X":"\\u0000"}']) {
      expect(() => parseMemberEnvironment(text, false, 'pi', undefined)).toThrow()
    }
    expect(() => parseMemberEnvironment('{"Path":"a","PATH":"b"}', true, 'pi', undefined)).toThrow()
    expect(parseMemberEnvironment('{"Path":"a","PATH":"b"}', false, 'pi', undefined)).toEqual({ Path: 'a', PATH: 'b' })
    expect(() => parseMemberEnvironment('{"ANTHROPIC_MODEL":"relay"}', false, 'claude-code-cli', { mode: 'explicit', modelId: 'selected', options: {} })).toThrow()
    expect(parseMemberEnvironment('{"ANTHROPIC_MODEL":"relay"}', false, 'claude-code-cli', { mode: 'runtime_default' })).toEqual({ ANTHROPIC_MODEL: 'relay' })
  })
  it('requires target confirmation only when an existing credential is retained', () => {
    const before = { ANTHROPIC_BASE_URL: 'https://a.example', ANTHROPIC_API_KEY: '<saved>' }
    expect(environmentNeedsConsent(before, { ...before, ANTHROPIC_BASE_URL: 'https://b.example' })).toBe(true)
    expect(environmentNeedsConsent(before, { ...before, ANTHROPIC_BASE_URL: 'https://b.example', ANTHROPIC_API_KEY: 'new-key' })).toBe(false)
    expect(environmentNeedsConsent(before, { ANTHROPIC_BASE_URL: 'https://b.example' })).toBe(false)
  })
})
