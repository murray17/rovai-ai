import type { RuntimeNativeCredential, RuntimeCustomApiConfiguration } from '@contracts'
import { describe, expect, it } from 'vitest'
import { customApiError, emptyCustomApi, normalizedStartupConfiguration, runtimeEnvironmentErrors, runtimeStartupKey } from './runtime-startup-draft'

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
  it('validates a single connection locally without requiring online model verification', () => {
    const key = { action: 'keep' } as const
    const credential: RuntimeNativeCredential = { status: 'available', source: 'environment_reference', sourceLabel: 'RELAY_KEY', version: 'v1', sourceWritable: false, canReplace: true, canClear: true, restriction: null, remedy: null }
    const codex: Extract<RuntimeCustomApiConfiguration, { kind: 'codex-cli' }> = { kind: 'codex-cli', mode: 'custom_api', baseUrl: 'https://offline.invalid/prefix', models: [{ rowId: 'one', id: 'private-id', displayName: '' }, { rowId: 'two', id: 'private-id-2', displayName: '' }], defaultModel: 'private-id-2', defaultRowId: 'two' }
    const draft = { programPath: null, environment: [], customApi: { ...codex, models: [...codex.models] } }
    expect(customApiError(draft, key, credential)).toBeNull()
    expect(customApiError(draft, key, undefined)).toContain('API Key')
    expect(customApiError(draft, { action: 'clear' }, credential)).toBeNull()
    expect(customApiError({ ...draft, customApi: { ...draft.customApi, models: [draft.customApi.models[0]] } }, key, credential)).toContain('默认模型')
    expect(customApiError({ ...draft, customApi: { ...draft.customApi, models: [draft.customApi.models[0], draft.customApi.models[0]] } }, key, credential)).toContain('重复')
    expect(customApiError({ ...draft, customApi: { ...draft.customApi, baseUrl: 'https://user:pass@offline.invalid' } }, key, credential)).toContain('地址')
    expect(customApiError({ ...draft, customApi: { ...draft.customApi, mode: 'official_login', models: [] } }, { action: 'clear' }, credential)).toBeNull()
    const claude: RuntimeCustomApiConfiguration = { kind: 'claude-code-cli', mode: 'custom_api', models: { model: '', reasoningModel: '', haikuModel: '', sonnetModel: '', opusModel: '' }, baseUrl: 'http://localhost:1234/prefix' }
    expect(customApiError({ ...draft, customApi: claude }, { action: 'replace', value: 'fake-local-key' }, undefined)).toBeNull()
    expect(emptyCustomApi('pi')).toBeNull()
    expect(emptyCustomApi('kimi-code-cli')).toBeNull()
    expect(emptyCustomApi('grok-build')).toBeNull()
    const renamed = { ...draft, customApi: { ...draft.customApi, models: draft.customApi.models.map(row => row.rowId === 'two' ? { ...row, id: 'renamed' } : row) } }
    expect(normalizedStartupConfiguration(renamed).customApi).toMatchObject({ defaultRowId: 'two', defaultModel: 'renamed' })
    for (const baseUrl of ['https://offline.invalid/prefix/', 'https://another.invalid/prefix']) expect(customApiError({ ...draft, customApi: { ...draft.customApi, baseUrl } }, key, credential)).toBeNull()
    expect(customApiError(draft, { action: 'replace', value: 'new-key' }, credential)).toBeNull()
  })

})
