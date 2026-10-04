import { describe, expect, it } from 'vitest'
import type { AdapterInstallation } from '@contracts'
import { messageRuntimeModelPresentation, modelSummary } from './runtime-model-presentation'

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

  it('keeps an unknown record, Agent defaults and an unspecified effort distinct', () => {
    expect(messageRuntimeModelPresentation(undefined, installation)).toBeNull()
    expect(messageRuntimeModelPresentation(null, installation)).toBeNull()
    expect(messageRuntimeModelPresentation({ ...record, modelId: null, reasoningEffort: null }, installation))
      .toEqual({ model: '智能体默认', effort: null })
    expect(messageRuntimeModelPresentation({ ...record, reasoningEffort: null }, installation))
      .toEqual({ model: 'Old Model', effort: null })
    expect(messageRuntimeModelPresentation({ ...record, adapterKind: 'claude-code-cli' }, null)?.effort?.label).toBe('思考强度')
  })
})
