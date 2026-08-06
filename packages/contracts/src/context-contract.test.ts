import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v9.json'
import type { ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v9 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 9

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.memberCallSenderIdentityField).toBe('senderAgentId')
  })
})
