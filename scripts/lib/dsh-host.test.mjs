import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { apply, readinessService } from '../../crates/rovai-core/src/dsh/bootstrap.mjs'

test('DSH official prompt seam binds immutable root identity per session and fails closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-dsh-host-test-'))
  try {
    const variables = new Map(), sections = [], events = new Map(), provided = new Map()
    let denied = []
    await apply({ loader: { entries: () => [] }, tools: { schemas: () => ['mcp__fixture__echo', 'mcp__fixture__native_only', 'read'].map(name => ({ name })) }, systemPrompt: {
      variable: (key, fn) => variables.set(key, fn), section: section => sections.push(section)
    }, provide: (key, value) => provided.set(key, value), on: (name, fn) => events.set(name, fn) },
    { bindingRoot: root, observationRoot: root, mcpServerNames: ['fixture'] })
    assert.deepEqual(provided.get(readinessService), { ready: true })
    let toolChangeEvent
    events.get('agent/created')({ agent: { session: { header: {} }, ctx: {
      tools: { restrict: ({ deny }) => { denied = deny; return () => {} } }, on: name => { toolChangeEvent = name }
    } } })
    assert.deepEqual(denied, ['mcp__fixture__echo', 'mcp__fixture__native_only'])
    assert.equal(toolChangeEvent, 'tools/change')
    assert.equal(events.has('tools/pre-execute'), false)
    const bootstrap = 'Member A: {{literal}}'
    const binding = { schemaVersion: 1, sessionId: 'session-a', bootstrap,
      sha256: createHash('sha256').update(bootstrap).digest('hex') }
    writeFileSync(join(root, 'session-a.json'), JSON.stringify(binding))
    const render = (id, header = {}) => variables.get('rovai_bootstrap')({ agent: { session: { id, header } } })
    assert.equal(render('session-a'), bootstrap)
    assert.equal(render('session-a'), bootstrap) // same assembly after a native compact
    assert.throws(() => render('session-b'))
    assert.equal(render('session-child', { parentSession: 'session-a' }), '')
    assert.throws(() => render('../session-a'))
    writeFileSync(join(root, 'session-a.json'), JSON.stringify({ ...binding, bootstrap: 'tampered' }))
    assert.throws(() => render('session-a'), /binding_invalid/)
    assert.deepEqual(sections, [{ name: 'rovai:bootstrap', order: 11000, text: '{{rovai_bootstrap}}' }])
    events.get('tools/result')({ name: 'bash', callId: 'call', agent: { session: { id: 'session-a', header: {} } } },
      { isError: false, value: { exitCode: 7, stdout: { text: 'private body' } } })
    const observation = readdirSync(root).find(name => name !== 'session-a.json')
    const result = JSON.parse(readFileSync(join(root, observation), 'utf8'))
    assert.equal(result.exitCode, 7)
    assert.equal(result.sessionId, 'session-a')
    assert.equal(JSON.stringify(result).includes('private body'), false)
    events.get('tools/result')({ name: 'edit', callId: 'edit-call', agent: { session: { id: 'session-a', header: {} } } },
      { isError: false, value: { path: '/workspace/example.txt', before: 'old\n', after: 'new\n', output: 'private output' } })
    const editKey = createHash('sha256').update(JSON.stringify(['session-a', 'edit-call'])).digest('hex')
    const edit = JSON.parse(readFileSync(join(root, `${editKey}.json`), 'utf8'))
    assert.deepEqual({ path: edit.path, before: edit.before, after: edit.after }, {
      path: '/workspace/example.txt', before: 'old\n', after: 'new\n'
    })
    assert.equal(JSON.stringify(edit).includes('private output'), false)
    events.get('tools/result')({ name: 'write', callId: 'write-create', agent: { session: { id: 'session-a', header: {} } } },
      { isError: false, value: { path: '/workspace/created.txt', before: null, after: 'created\n' } })
    const createKey = createHash('sha256').update(JSON.stringify(['session-a', 'write-create'])).digest('hex')
    const create = JSON.parse(readFileSync(join(root, `${createKey}.json`), 'utf8'))
    assert.deepEqual({ path: create.path, before: create.before, after: create.after }, {
      path: '/workspace/created.txt', before: null, after: 'created\n'
    })
    for (const [name, callId, value] of [
      ['write', 'write-missing-before', { path: '/workspace/missing-before.txt', after: 'created\n' }],
      ['write', 'write-missing-after', { path: '/workspace/missing-after.txt', before: null }],
      ['write', 'write-malformed-before', { path: '/workspace/malformed-before.txt', before: 0, after: 'created\n' }],
      ['edit', 'edit-null-before', { path: '/workspace/invalid-edit.txt', before: null, after: 'changed\n' }],
      ['edit', 'edit-malformed-after', { path: '/workspace/malformed-edit.txt', before: 'old\n', after: null }],
      ['write', 'write-oversized', { path: '/workspace/oversized.txt', before: null, after: 'x'.repeat(2 * 1024 * 1024 + 1) }]
    ]) {
      events.get('tools/result')({ name, callId, agent: { session: { id: 'session-a', header: {} } } },
        { isError: false, value })
      const observationKey = createHash('sha256').update(JSON.stringify(['session-a', callId])).digest('hex')
      const fallback = JSON.parse(readFileSync(join(root, `${observationKey}.json`), 'utf8'))
      assert.equal(fallback.path, value.path)
      assert.equal(Object.hasOwn(fallback, 'before'), false)
      assert.equal(Object.hasOwn(fallback, 'after'), false)
    }
    events.get('session/event')({ id: 'session-a', header: {} }, { type: 'assistant/message', seq: 12,
      data: { turn: 2, usage: { inputTokens: 10, outputTokens: 3, totalTokens: 103, cacheReadTokens: 90 }, message: { content: 'private reply' } } })
    const usageFile = readdirSync(root).find(name => name.includes('.usage-'))
    const usage = JSON.parse(readFileSync(join(root, usageFile), 'utf8'))
    assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 3, totalTokens: 103, cacheReadTokens: 90 })
    assert.equal(usage.seq, 12)
    assert.equal(JSON.stringify(usage).includes('private reply'), false)
    const observe = event => events.get('session/event')({ id: 'session-a', header: {} }, event)
    observe({ type:'compaction/start', seq:13, data:{compactionId:'auto-1',turn:2} })
    observe({ type:'compaction/summary', seq:14, data:{compactionId:'auto-1',summary:'private summary',usage:{inputTokens:20,outputTokens:4}} })
    observe({ type:'compaction/end', seq:15, data:{compactionId:'auto-1',turn:2} })
    const compactionFile=readdirSync(root).find(name=>name.endsWith('.usage-14.json'))
    const compaction=JSON.parse(readFileSync(join(root,compactionFile),'utf8'))
    assert.equal(compaction.turn,2)
    assert.equal(compaction.sourceEvent,'compaction/summary')
    assert.deepEqual(compaction.usage,{inputTokens:20,outputTokens:4})
    assert.equal(JSON.stringify(compaction).includes('private summary'),false)
    observe({ type:'compaction/start', seq:16, data:{compactionId:'manual-1',turn:null} })
    observe({ type:'compaction/summary', seq:17, data:{compactionId:'manual-1',usage:{inputTokens:999}} })
    observe({ type:'compaction/end', seq:18, data:{compactionId:'manual-1',turn:null} })
    observe({ type:'compaction/summary', seq:19, data:{compactionId:'auto-1',usage:{inputTokens:999}} })
    assert.equal(readdirSync(root).filter(name=>name.includes('.usage-')).length,2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('DSH bootstrap publishes ACP readiness only after native MCP entries settle', async () => {
  let release
  const activation = new Promise(resolve => { release = resolve })
  const calls = []
  const nativeMcp = {
    disabled: false,
    options: { name: '@deepseek-ai/dsh-mcp-client' },
    async refresh() { calls.push('refresh'); await activation },
    async _await() { calls.push('await') }
  }
  let ready = false
  const pending = apply({
    loader: { entries: () => [nativeMcp] },
    tools: { schemas: () => [] },
    systemPrompt: { variable: () => {}, section: () => {} },
    on: () => {},
    provide: key => { assert.equal(key, readinessService); ready = true }
  }, { bindingRoot: '/unused', observationRoot: '/unused', mcpServerNames: [] })
  await Promise.resolve()
  assert.equal(ready, false)
  assert.deepEqual(calls, ['refresh'])
  release()
  await pending
  assert.equal(ready, true)
  assert.deepEqual(calls, ['refresh', 'await'])
})
