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

  it.each([
    ['codebuddy-cli', 'thought_level', '推理强度'],
    ['minimax-code-cli', 'thinkingEffort', '思考强度']
  ] as const)('uses native effort in member summaries and the existing message effort field (%s)', (adapterKind, effortKey, label) => {
    const native: AdapterInstallation = {
      ...installation,
      adapterKind,
      snapshot: {
        ...installation.snapshot!,
        models: [{
          ...installation.snapshot!.models[0],
          options: [{ ...installation.snapshot!.models[0].options[0], key: effortKey }]
        }]
      }
    }
    const configuration: Parameters<typeof memberRuntimeConfigurationPresentation>[0] = {
      adapterKind,
      model: {
        mode: 'explicit', modelId: 'old-model',
        options: { [effortKey]: 'high', reasoning_effort: 'wrong' }
      },
      permissions: { adapterKind, schemaVersion: 1, values: {} }
    }
    expect(memberRuntimeConfigurationPresentation(configuration, native).effort)
      .toEqual({ label, value: 'High' })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind }, native)?.effort)
      .toEqual({ label, value: 'High' })
    const unlisted = { ...configuration, model: {
      mode: 'explicit' as const, modelId: 'unlisted-model', options: { [effortKey]: 'future' }
    } }
    expect(memberRuntimeConfigurationPresentation(unlisted, null).effort)
      .toEqual({ label, value: 'future' })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind, reasoningEffort: 'future' }, null)?.effort)
      .toEqual({ label, value: 'future' })
    expect(memberRuntimeConfigurationPresentation({
      ...configuration, model: { mode: 'explicit', modelId: 'old-model', options: {} }
    }, native).effort).toEqual({ label, value: '跟随模型默认值' })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind, reasoningEffort: null }, native)?.effort).toBeNull()
  })

  it('uses the common default label in member summaries and Hermes history', () => {
    const hermes = {...installation, adapterKind: 'hermes-cli'} as AdapterInstallation
    expect(messageRuntimeModelPresentation({...record, adapterKind: 'hermes-cli', reasoningEffort: 'default'}, hermes)?.effort?.value)
      .toBe('跟随模型默认值')
    expect(messageRuntimeModelPresentation({...record, adapterKind: 'hermes-cli', reasoningEffort: null}, hermes)?.effort)
      .toBeNull()
    const configuration: Parameters<typeof memberRuntimeConfigurationPresentation>[0] = {
      adapterKind: 'hermes-cli', model: {mode: 'explicit', modelId: 'old-model', options: {}},
      permissions: {adapterKind: 'hermes-cli', schemaVersion: 1, values: {}}
    }
    expect(memberRuntimeConfigurationPresentation(configuration, hermes).effort?.value).toBe('跟随模型默认值')
    configuration.model = {mode: 'explicit', modelId: 'old-model', options: {reasoning_effort: 'default'}}
    expect(memberRuntimeConfigurationPresentation(configuration, null).effort?.value).toBe('跟随模型默认值')

    const pi: AdapterInstallation = {
      ...installation, adapterKind: 'pi', snapshot: {
        ...installation.snapshot!, models: [{
          ...installation.snapshot!.models[0],
          options: [{ ...installation.snapshot!.models[0].options[0], key: 'thinking_level' }]
        }]
      }
    }
    expect(memberRuntimeConfigurationPresentation({
      ...configuration, adapterKind: 'pi',
      model: { mode: 'explicit', modelId: 'old-model', options: {} }
    }, pi).effort?.value).toBe('跟随模型默认值')
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
