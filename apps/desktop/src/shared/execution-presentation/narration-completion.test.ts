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

it.each([
  ['HTML comment', '<!--' + 'hidden comment '.repeat(500) + '-->'],
  ['reference definition', '[reference]: https://example.test/' + 'x'.repeat(5000)],
  ['image only', '![' + 'image description '.repeat(500) + '](https://example.test/image.png)']
])('keeps %s narration hidden when the live tail loses its Markdown opening', (_name, body) => {
  const event: LiveRuntimeEvent = { id: 'hidden', agentRunId: 'run', eventType: 'agent.text.block',
    createdAt: '2026-11-15T00:00:00Z', payload: { blockId: 'hidden', text: body, textLength: body.length, status: 'completed' } }
  expect(body.length).toBeGreaterThan(4000)
  for (const textMode of ['complete', 'live_tail'] as const) {
    expect(buildLiveExecutionProgress([event], 'run', { textMode }).items).toEqual([])
  }
})

it.each(['', '![](https://example.test/image.png)'])('omits a tail without visible content: %s', ending => {
  const body = 'Earlier visible progress.\n' + '\n'.repeat(5000) + ending
  const event: LiveRuntimeEvent = { id: 'tail', agentRunId: 'run', eventType: 'agent.text.block',
    createdAt: '2026-11-15T00:00:00Z', payload: { blockId: 'tail', text: body, textLength: body.length, status: 'completed' } }
  expect(buildLiveExecutionProgress([event], 'run', { textMode: 'complete' }).items).toHaveLength(1)
  expect(buildLiveExecutionProgress([event], 'run', { textMode: 'live_tail' }).items).toEqual([])
})
