import { describe, expect, it } from 'vitest'
import { normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey } from './runtime-startup-draft'

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
    expect(runtimeEnvironmentErrors(draft, false)).toEqual({})
    expect(Object.keys(runtimeEnvironmentErrors(draft, true))).toEqual(['0', '1'])
    for (const name of ['', '1KEY', 'BAD-KEY', 'ROVAI_CONTEXT']) {
      expect(runtimeEnvironmentErrors({ ...draft, environment: [{ name, value: '' }] }, false)[0]).toBeTruthy()
    }
  })
})
