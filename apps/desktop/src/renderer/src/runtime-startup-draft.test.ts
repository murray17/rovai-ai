import type { RuntimeStartupSettings } from '@contracts'
import { describe, expect, it } from 'vitest'
import { normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey, startupEdits } from './runtime-startup-draft'

describe('startup editor draft contract', () => {
  it('treats returning to the saved values as clean and preserves empty or spaced values', () => {
    const saved = { programPath: null, environment: [{ name: 'TOKEN', value: '  value  ' }, { name: 'EMPTY', value: '' }] }
    const reordered = { ...saved, environment: [...saved.environment].reverse() }
    expect(runtimeStartupKey(saved)).toBe(runtimeStartupKey(reordered))
    const changed = { ...saved, environment: [...saved.environment, { name: 'HTTP_PROXY', value: 'http://localhost:8080' }] }
    expect(runtimeStartupKey(changed)).not.toBe(runtimeStartupKey(saved))
    expect(normalizedStartupConfiguration(saved)).toEqual(saved)
  })
  it('reports invalid and duplicate variable names while allowing valid drafts to save without probing', () => {
    const draft = { programPath: null, environment: [{ name: 'TOKEN', value: '' }, { name: 'token', value: 'value' }] }
    expect(runtimeEnvironmentErrors(draft, false, 'pi')).toEqual({})
    expect(Object.keys(runtimeEnvironmentErrors(draft, true, 'pi'))).toEqual(['0', '1'])
    for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
      const keyDraft = { ...draft, environment: [{ name, value: 'fixture-key' }] }
      for (const kind of ['pi', 'kimi-code-cli', 'grok-build'] as const) expect(runtimeEnvironmentErrors(keyDraft, false, kind)).toEqual({})
      expect(Boolean(runtimeEnvironmentErrors(keyDraft, false, 'claude-code-cli')[0])).toBe(name === 'ANTHROPIC_API_KEY')
      expect(Boolean(runtimeEnvironmentErrors(keyDraft, false, 'codex-cli')[0])).toBe(name === 'OPENAI_API_KEY')
    }
    for (const name of ['', '1KEY', 'BAD-KEY', 'ROVAI_CONTEXT']) {
      expect(runtimeEnvironmentErrors({ ...draft, environment: [{ name, value: '' }] }, false, 'pi')[0]).toBeTruthy()
    }
  })
  it('submits only edited startup fields and keeps raw environment values', () => {
    const saved: RuntimeStartupSettings = { runtimeKind: 'codex-cli', revision: 1, reconnectRequired: false, configuration: { programPath: null, environment: [{ name: 'HTTP_PROXY', value: 'before' }, { name: 'UNCHANGED', value: 'keep' }] } }
    const draft = { programPath: '/tools/codex', environment: [{ name: 'HTTP_PROXY', value: '  after  ' }, { name: 'UNCHANGED', value: 'keep' }] }
    expect(startupEdits(saved, draft)).toEqual([
      { path: ['programPath'], before: null, after: '/tools/codex', label: '程序路径' },
      { path: ['environment', 'HTTP_PROXY'], before: 'before', after: '  after  ', label: '环境变量 HTTP_PROXY' }
    ])
    expect(startupEdits(saved, saved.configuration)).toEqual([])
  })
})
