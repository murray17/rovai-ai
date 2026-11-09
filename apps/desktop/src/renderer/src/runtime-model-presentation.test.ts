import { describe, expect, it } from 'vitest'
import type { AdapterInstallation } from '@contracts'
import { memberRuntimeConfigurationPresentation, messageRuntimeModelPresentation, modelSummary } from './runtime-model-presentation'

describe('message model identity', () => {
  const record = { adapterKind: 'codex-cli', modelId: 'old-model', reasoningEffort: 'high' }
  const installation = { adapterKind: 'codex-cli', snapshot: { models: [
    { id: 'old-model', displayName: 'Old Model', options: [{ key: 'reasoning_effort', values: [{ value: 'high', label: 'High' }] }] },
    { id: 'new-model', displayName: 'New Model', options: [] }
  ] } } as AdapterInstallation

  it('resolves labels only for the frozen adapter/model and preserves values removed from the catalog', () => {
    expect(messageRuntimeModelPresentation(record, installation)).toEqual({
      model: 'Old Model', effort: { label: '推理强度', value: 'High' }
    })
    const fallback = { model: 'old-model', effort: { label: '推理强度', value: 'high' } }
    expect(messageRuntimeModelPresentation(record, null)).toEqual(fallback)
    expect(messageRuntimeModelPresentation(record, { ...installation, adapterKind: 'claude-code-cli' })).toEqual(fallback)
    expect(modelSummary(fallback)).toBe('old-model · high')
  })

  it('uses CodeBuddy thought_level in member summaries and the existing message effort field', () => {
    const codebuddy: AdapterInstallation = {
      ...installation,
      adapterKind: 'codebuddy-cli',
      snapshot: {
        ...installation.snapshot!,
        models: [{
          ...installation.snapshot!.models[0],
          options: [{ ...installation.snapshot!.models[0].options[0], key: 'thought_level' }]
        }]
      }
    }
    const configuration: Parameters<typeof memberRuntimeConfigurationPresentation>[0] = {
      adapterKind: 'codebuddy-cli',
      model: {
        mode: 'explicit', modelId: 'old-model',
        options: { thought_level: 'high', reasoning_effort: 'wrong' }
      },
      permissions: { adapterKind: 'codebuddy-cli', schemaVersion: 1, values: {} }
    }
    expect(memberRuntimeConfigurationPresentation(configuration, codebuddy).effort)
      .toEqual({ label: '推理强度', value: 'High' })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind: 'codebuddy-cli' }, codebuddy)?.effort)
      .toEqual({ label: '推理强度', value: 'High' })
  })

  it('labels Hermes reset intent without substituting the current catalog effort', () => {
    const hermes = {...installation, adapterKind: 'hermes-cli'} as AdapterInstallation
    expect(messageRuntimeModelPresentation({...record, adapterKind: 'hermes-cli', reasoningEffort: 'default'}, hermes)?.effort?.value)
      .toBe('恢复 Hermes 配置默认')
    const configuration: Parameters<typeof memberRuntimeConfigurationPresentation>[0] = {
      adapterKind: 'hermes-cli', model: {mode: 'explicit', modelId: 'old-model', options: {}},
      permissions: {adapterKind: 'hermes-cli', schemaVersion: 1, values: {}}
    }
    expect(memberRuntimeConfigurationPresentation(configuration, hermes).effort?.value).toBe('不覆盖原生会话设置')
    configuration.model = {mode: 'explicit', modelId: 'old-model', options: {reasoning_effort: 'default'}}
    expect(memberRuntimeConfigurationPresentation(configuration, null).effort?.value).toBe('恢复 Hermes 配置默认')
  })

  it('keeps an unknown record, Agent defaults and an unspecified effort distinct', () => {
    expect(messageRuntimeModelPresentation(undefined, installation)).toBeNull()
    expect(messageRuntimeModelPresentation(null, installation)).toBeNull()
    expect(messageRuntimeModelPresentation({ ...record, modelId: null, reasoningEffort: null }, installation))
      .toEqual({ model: '智能体默认', effort: null })
    expect(messageRuntimeModelPresentation({ ...record, reasoningEffort: null }, installation))
      .toEqual({ model: 'Old Model', effort: null })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind: 'claude-code-cli' }, null)?.effort?.label).toBe('思考强度')
    expect(messageRuntimeModelPresentation({ ...record, adapterKind: 'pi', reasoningEffort: 'max' }, null)?.effort)
      .toEqual({ label: '思考强度', value: 'max' })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind: 'pi', reasoningEffort: null }, installation)?.effort).toBeNull()
  })
})
