import { afterEach, expect, it, vi } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import { ExecutionWindow } from '../../desktop/src/renderer/src/execution-window'
import { emptyLocalThreadComposerDraft, loadLocalThreadComposerDraft, saveLocalThreadComposerDraft } from '../../desktop/src/renderer/src/camp-composer-local-store'
import { campMessageSendParams } from '../../desktop/src/renderer/src/BusinessApp'
import { PendingThreadDraftPersistence } from '../../desktop/src/renderer/src/pending-thread-draft'
import { ConsoleClient } from './client'
import { createThreadAdapter } from './camp-adapter'

// Owns the production Web adapter + execution window seam. A Host-only HTTP
// test bypasses this adapter's allowlist; a populated page hides missing deltas.
afterEach(() => vi.unstubAllGlobals())
it('routes public reference directory and availability reads through the Web adapter', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const requests: unknown[] = []
  const item = { kind: 'thread', id: 'rvcamp_01k87hrb9yfay8vvr14d2pf2db', title: '登录改造', projectBindingKind: 'directory', projectPath: '/project' }
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const request = JSON.parse(String(options?.body))
    requests.push(request)
    return Response.json({ result: request.operation === 'threadReferences.list' ? { items: [item], nextCursor: null } : [item, null] })
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const client = createThreadAdapter(transport, async () => null).environment.client
  const list = { threadId: 'current', kind: 'thread', query: '登录' }
  const resolve = { threadId: 'current', references: [{ kind: 'thread', id: item.id }, { kind: 'mission', id: 'missing' }] }
  try {
    expect(await client.request('threadReferences.list', list)).toEqual({ items: [item], nextCursor: null })
    expect(await client.request('threadReferences.resolve', resolve)).toEqual([item, null])
    expect(requests).toEqual([{ operation: 'threadReferences.list', params: list }, { operation: 'threadReferences.resolve', params: resolve }])
    expect(transport.pendingCommandCount).toBe(0)
  } finally { transport.clear() }
})

it('loads a command after an initially empty Web Run and refreshes its completion', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  let evidence: AgentRunExecutionEvidenceView[] = []
  let changeSequence = 0
  const operations: string[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const { operation, params } = JSON.parse(String(options?.body))
    operations.push(operation)
    expect(params.projection).toBe('blocks')
    const blocks = evidence.map(item => ({
      key: 'tools:1', kind: 'toolGroup', sequence: 1, lastSequence: 1, changeSequence,
      toolCount: 1, counts: { completed: Number(item.phase === 'completed'), running: Number(item.phase !== 'completed'),
        failed: 0, stopped: 0, waiting: 0, recorded: 0 }, evidence: [item]
    }))
    const common = {
      schemaVersion: 3,
      threadId: 'camp',
      agentRunId: 'run',
      throughSequence: evidence.at(-1)?.sequence ?? 0,
      throughChangeSequence: changeSequence,
      hasMore: false
    }
    if (operation === 'agentRunExecution.page') return Response.json({ result: {
      ...common, requestedBeforeSequence: params.beforeSequence, nextBeforeSequence: null, blocks
    } })
    if (operation === 'agentRunExecution.changes') return Response.json({ result: {
      ...common,
      requestedAfterChangeSequence: params.afterChangeSequence,
      nextAfterChangeSequence: changeSequence,
      blocks: blocks.filter(item => item.changeSequence > params.afterChangeSequence)
    } })
    throw Error(`Unexpected request: ${operation}`)
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const adapter = createThreadAdapter(transport, async () => null)
  const client = adapter.environment.client
  const current = new ExecutionWindow('camp', 'run', 12,
    params => client.request('agentRunExecution.page', { ...params, projection: 'blocks' }), () => undefined,
    params => client.request('agentRunExecution.changes', { ...params, projection: 'blocks' }))
  try {
    await current.latest()
    expect(current.loaded).toBe(true)
    expect(current.evidence).toEqual([])
    changeSequence = 1
    evidence = [{ id: 'command', agentRunId: 'run', executionEpoch: 1, sequence: 1,
      operationId: 'command', revision: 1, changeSequence,
      eventType: 'command.started', kind: 'command', phase: 'started',
      payload: { command: 'printf WEB_LIVE_COMMAND_MARKER' }, contentBlobId: null,
      contentByteCount: 0, isTruncated: false, occurredAt: '2026-09-14T00:00:00Z' }]
    await current.refresh()
    expect(current.evidence).toEqual(evidence)
    changeSequence = 2
    evidence = [{ ...evidence[0], revision: 2, changeSequence,
      eventType: 'command.completed', phase: 'completed',
      payload: { command: 'printf WEB_LIVE_COMMAND_MARKER', exitCode: 0 } }]
    await current.refresh()
    expect(current.evidence[0].phase).toBe('completed')
    expect(operations).toEqual(['agentRunExecution.page', 'agentRunExecution.changes', 'agentRunExecution.changes'])
  } finally { current.dispose(); transport.clear() }
})

it('通过 Web 适配器确认 Pending 输入框初始化和草稿 presence，失败后仍可重试', async () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) }
  }
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'Linux x86_64' })
  vi.stubGlobal('window', { sessionStorage: storage, localStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const requests: unknown[] = []
  let rejectPresence = false
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    expect(String(url)).toBe('http://127.0.0.1:8767/api/v1/request')
    requests.push(JSON.parse(String(options?.body)))
    return Response.json(rejectPresence
      ? { error: { code: 'camp.pending_draft_unavailable', message: '暂时无法保留草稿' } }
      : { result: { changed: true } })
  })
  const transport = new ConsoleClient('http://127.0.0.1:8767', fetcher)
  await transport.login('b'.repeat(64))
  const client = createThreadAdapter(transport, async () => null).environment.client
  const persistence = new PendingThreadDraftPersistence(client)
  const empty = emptyLocalThreadComposerDraft('pending')
  const draft = { ...empty, body: '保留未发送内容', content: { version: 2 as const, segments: [{ kind: 'text' as const, text: '保留未发送内容' }] } }
  try {
    await persistence.persist(empty)
    rejectPresence = true
    await expect(persistence.persist(draft)).rejects.toMatchObject({ code: 'camp.pending_draft_unavailable' })
    expect(loadLocalThreadComposerDraft('pending', storage)).toEqual(draft)
    rejectPresence = false
    await persistence.persist(draft)
    await persistence.persist(draft)
    await persistence.persist(empty)
    expect(loadLocalThreadComposerDraft('pending', storage)).toBeNull()
    expect(requests).toEqual([false, true, true, false].map(present => ({
      operation: 'threads.pendingDraft.setPresence', params: { threadId: 'pending', present }
    })))
    expect(transport.pendingCommandCount).toBe(0)
  } finally { transport.clear() }
})

// Subscription alone must not cause idle HTTP work; only retained handles do.
it('polls changes only while files are open and resumes after reopening', async () => {
  vi.useFakeTimers()
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const actions: string[] = []
  const changed = { threadId: 'camp', previewKeys: ['file-key'] }
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    const { action } = JSON.parse(String(options?.body)); actions.push(action)
    if (action === 'open' || action === 'restore') return Response.json({ ok: true, value: { kind: 'file_preview', file: { handleId: action === 'restore' ? 'candidate' : 'file', displayPath: 'file.txt' } } })
    if (action === 'readText') {
      expect(JSON.parse(String(options?.body)).request).toMatchObject({ handleId: 'candidate', expectedGeneration: 'new' })
      return Response.json({ ok: true, value: { text: 'updated Host bytes', contentGeneration: 'new', contentVersion: { size: 18, mtimeMs: 2 } } })
    }
    return Response.json(action === 'release' ? { released: true } : { ok: true, value: [changed] })
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const adapter = createThreadAdapter(transport, async () => null)
  const files = adapter.environment.files
  const notified = vi.fn()
  const unsubscribe = files.onExternalUpdate(notified)
  const open = () => files.open({ kind: 'camp_workspace', threadId: 'camp', rawReference: 'file.txt' })
  try {
    adapter.invalidate()
    await vi.advanceTimersByTimeAsync(6000)
    expect(actions).toEqual([])
    await open(); await vi.advanceTimersByTimeAsync(4000)
    expect(actions).toEqual(['open', 'updates', 'updates'])
    expect(notified).toHaveBeenCalledTimes(2)
    expect(notified).toHaveBeenLastCalledWith(changed)
    await files.release({ handleId: 'file' }); await vi.advanceTimersByTimeAsync(6000)
    expect(actions).toEqual(['open', 'updates', 'updates', 'release'])
    await open(); await vi.advanceTimersByTimeAsync(2000)
    expect(actions.slice(-2)).toEqual(['open', 'updates'])
    const candidate = await files.reload({ handleId: 'file', reopenToken: 'token', expectedGeneration: 'generation' })
    expect(candidate).toMatchObject({ ok: true, value: { handleId: 'candidate' } })
    expect(actions.at(-1)).toBe('restore')
    expect(actions.filter(action => action === 'release')).toHaveLength(1)
    expect(await files.readText({ handleId: 'candidate', expectedGeneration: 'new' }))
      .toMatchObject({ ok: true, value: { text: 'updated Host bytes' } })
    await files.release({ handleId: 'candidate' })
    await files.release({ handleId: 'file' })
  } finally { unsubscribe(); transport.clear(); vi.useRealTimers() }
})

it('confirms uploaded image bindings before reusing local bytes and falls back for changes or missing files', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('atob', () => { throw Error('Binary previews must not use Base64') })
  const file = new File([new Uint8Array(600_000)], 'photo.png', { type: 'image/png' })
  vi.spyOn(file, 'arrayBuffer').mockRejectedValue(Error('No complete upload buffer'))
  let digest = '', changed = false, missing = false, tooLarge = false
  const attachmentId = '11111111-1111-4111-8111-111111111111'
  const source = { id: attachmentId, sourcePath: '/tmp/upload/source', displayName: 'photo.png', kind: 'file', mediaType: 'image/png', observedByteSize: file.size }
  const actions: string[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user' })
    if (String(url).endsWith('/uploads')) {
      digest = JSON.parse(String((options!.body as FormData).get('intent'))).sha256
      return Response.json({ draft: source })
    }
    const { action, request } = JSON.parse(String(options?.body)); actions.push(action)
    if (action === 'restoreComposerAttachments') {
      expect(request).toEqual({ threadId: 'camp', attachmentRefIds: [attachmentId] })
      return Response.json(missing ? [null] : [{ id: attachmentId, sourcePath: source.sourcePath, displayName: source.displayName,
        kind: 'file', mediaType: 'image/png', byteSize: file.size, fileCount: 1, previewKind: 'image', availability: 'available' }])
    }
    if (action === 'open') return Response.json(tooLarge ? { ok: false, error: { code: 'file_too_large' } } : missing ? { ok: false, error: { code: 'file_not_found' } } : {
      ok: true, value: { kind: 'file_preview', file: { handleId: 'file', displayPath: 'photo.png', kind: 'image', size: file.size, contentGeneration: changed ? 'c'.repeat(64) : digest } }
    })
    if (action === 'readBinary') {
      expect(String(url)).toMatch(/\/files\/bytes$/)
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png', 'x-rovai-content-generation': 'c'.repeat(64), 'x-rovai-content-version': '{"size":4,"mtimeMs":1}' } })
    }
    return Response.json({ released: true })
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const adapter = createThreadAdapter(transport, async () => null)
  const attachments = adapter.environment.client.composerAttachments
  const preview = () => attachments.preview({ owner: 'composer', threadId: 'camp', attachmentRefId: attachmentId })
  try {
    const prepared = await attachments.prepare('camp', 1, file)
    expect(prepared).toEqual({ id: attachmentId, sourcePath: source.sourcePath, displayName: source.displayName,
      kind: 'file', mediaType: 'image/png', byteSize: file.size, fileCount: 1, previewKind: 'image', availability: 'available' })
    const saved = new Map<string, string>()
    const draftStorage = { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value) }, removeItem: (key: string) => { saved.delete(key) } }
    saveLocalThreadComposerDraft({ ...emptyLocalThreadComposerDraft('camp'), attachments: [prepared] }, draftStorage)
    const draft = loadLocalThreadComposerDraft('camp', draftStorage)!
    expect(draft).not.toBeNull()
    const restored = await attachments.restore!('camp', [{ ...draft.attachments[0], sourcePath: '/forged/browser/path' }])
    expect(restored).toEqual([prepared])
    expect(campMessageSendParams('send-command', 'camp', { ...draft, attachments: restored }).sourceAttachments).toEqual([source])
    actions.length = 0
    expect((await preview()).preview).toEqual({ blob: file })
    expect(actions).toEqual(['open', 'release'])
    changed = true
    const result = await preview()
    expect(result.availability).toBe('available')
    expect('blob' in result.preview! && await result.preview.blob.arrayBuffer()).toEqual(new Uint8Array([137, 80, 78, 71]).buffer)
    expect(actions.slice(-3)).toEqual(['open', 'readBinary', 'release'])
    tooLarge = true
    expect(await preview()).toEqual({ preview: null, availability: 'available' })
    tooLarge = false; missing = true
    expect(await preview()).toEqual({ preview: null, availability: 'missing' })
    expect(actions.at(-1)).toBe('open')
    expect(await attachments.restore!('camp', [prepared])).toEqual([{ ...prepared, sourcePath: undefined, availability: 'missing' }])
    transport.clear()
    expect(transport.confirmedUpload('camp', digest, file.size)).toBeNull()
  } finally { transport.clear() }
})


it('preserves changed-file download errors for preview refresh without starting a download', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
  vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/login')
    ? Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user', fileTransfers: { nativeDownload: true } })
    : Response.json({ error: { code: 'file_changed' } }, { status: 409 }))
  const transport = new ConsoleClient('http://127.0.0.1:8768', fetcher)
  await transport.login('b'.repeat(64))
  const { environment } = createThreadAdapter(transport, async () => null)
  const result = await environment.files.download!({ handleId: 'preview', expectedGeneration: 'seen' })
  expect(result).toMatchObject({ ok: false, error: { code: 'file_changed', retryable: true } })
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:8768/api/v1/downloads')
  transport.clear()
})

it('keeps generated paste identity through local drafts and sends, with explicit cleanup outcomes', async () => {
  const storage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('sessionStorage', storage); vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { platform: 'MacIntel' }); vi.stubGlobal('window', { sessionStorage: storage, history: { state: null } })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const file = new File([' 😀 text\n'.repeat(2000)], '粘贴内容-1.txt', { type: 'text/plain;charset=utf-8' })
  const source = { id: 'paste-id', sourcePath: '/instance/attachments/thread/uuid.txt', displayName: file.name,
    kind: 'file', mediaType: file.type, observedByteSize: file.size, pastedTextPreview: '😀 text' }
  let failedCleanup = false, uploaded = 0
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/login')) return Response.json({ protocolVersion: 7, token: 'a'.repeat(64), clientId: 'd'.repeat(64), editorProof: 'e'.repeat(64), ownerId: 'local_user', fileTransfers: { uploadMaxBytes: 30 * 1024 * 1024 } })
    if (String(url).endsWith('/uploads')) {
      uploaded++
      const data = options!.body as FormData
      expect(JSON.parse(String(data.get('intent'))).target).toEqual({ kind: 'pasted_text' })
      expect(await (data.get('file') as File).text()).toBe(await file.text())
      return Response.json({ draft: { ...source, generatedBy: 'long_text_paste' } })
    }
    const { action, request } = JSON.parse(String(options!.body))
    expect(request).toEqual({ threadId: 'thread', attachmentRefIds: ['paste-id'] })
    if (action === 'removePastedText') return Response.json(failedCleanup ? { ok: false, error: { code: 'read_failed' } } : 'deleted')
    if (action === 'discardPastedText') return Response.json({ released: true })
    throw new Error('Unexpected request')
  })
  const transport = new ConsoleClient('http://127.0.0.1:8766', fetcher)
  await transport.login('b'.repeat(64))
  const attachments = createThreadAdapter(transport, async () => null).environment.client.composerAttachments
  try {
    const prepared = await attachments.preparePastedText!('thread', file)
    expect(prepared.generatedBy).toBe('long_text_paste')
    expect(prepared.pastedTextPreview).toBe('😀 text')
    const draft = { ...emptyLocalThreadComposerDraft('thread'), attachments: [prepared] }
    // Only Source Ref fields go over the send boundary; deletion provenance stays local.
    expect(campMessageSendParams('send-command', 'thread', draft).sourceAttachments).toEqual([source])
    expect(await attachments.removePastedText!('thread', prepared.id)).toBe('deleted')
    failedCleanup = true
    await expect(attachments.removePastedText!('thread', prepared.id)).rejects.toThrow('清理失败')
    await attachments.discard!('thread', [prepared.id])
    const tooLarge = new File(['x'], 'too-large.txt'); Object.defineProperty(tooLarge, 'size', { value: 25 * 1024 * 1024 + 1 })
    await expect(attachments.preparePastedText!('thread', tooLarge)).rejects.toThrow('25 MiB')
    expect(uploaded).toBe(1)
  } finally { transport.clear() }
})
