import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v11.json'
import type { ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v11 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 11

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.memberCallSenderIdentityField).toBe('senderAgentId')
  })
})
