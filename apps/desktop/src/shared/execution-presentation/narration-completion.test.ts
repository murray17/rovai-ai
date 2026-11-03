import { expect, it } from 'vitest'
import { buildLiveExecutionProgress, type LiveRuntimeEvent } from './index'

it('preserves streaming line endings and distinguishes completed text from full-text display', () => {
  const body = '```mermaid\ngraph TD\n A-->B\n```\n'
  const event: LiveRuntimeEvent = { id: 'block', agentRunId: 'run', eventType: 'agent.text.block',
    createdAt: '2026-11-03T00:00:00Z', payload: { blockId: 'block', text: body, textLength: body.length, status: 'streaming' } }
  const project = (payload: unknown, outputTruncated = false) => buildLiveExecutionProgress([
    { ...event, payload, outputTruncated }
  ], 'run', { textMode: 'complete' }).items[0]
  expect(project(event.payload)).toMatchObject({ kind: 'narration', body })
  expect(project(event.payload)).not.toHaveProperty('contentComplete')
  for (const status of ['interrupted', 'failed', 'cancelled', undefined]) {
    expect(project({ ...event.payload as object, status })).not.toHaveProperty('contentComplete')
  }
  const complete = { ...event.payload as object, status: 'completed' }
  expect(project(complete)).toHaveProperty('contentComplete', true)
  expect(project(complete, true)).not.toHaveProperty('contentComplete')
  expect(project({ ...complete, textLength: body.length + 100 })).not.toHaveProperty('contentComplete')
})
