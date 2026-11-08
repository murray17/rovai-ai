import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, rename, mkdir, rmdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Extends the real Host HTTP owner with generated-file lifecycle assertions.
// Uses its existing isolated Host, editor identities and Threads; no Runtime.
export async function exercisePastedText({ host, origin, session, otherSession, threadId, otherThreadId, dataDir, spools }) {
  const root = await host.request('host.camp.attachmentOutputRoot', { threadId })
  const text = '\n  Remote paste 😀 中文\r\n\t' + 'Line with spaces  \r\n'.repeat(650)
  const bytes = Buffer.from(text)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }
  const files = async (action, id, editor = session, scope = threadId) => (await fetch(`${origin}/api/v1/files`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${editor.token}` },
    body: JSON.stringify({ action, request: { threadId: scope, attachmentRefIds: [id] } })
  })).json()
  const upload = async (contents = bytes, extra = {}) => {
    const intent = { commandId: crypto.randomUUID(), threadId, expectedRevision: 1,
      displayName: '粘贴内容-1.txt', byteSize: contents.length, sha256: createHash('sha256').update(contents).digest('hex'),
      target: { kind: 'pasted_text' }, ...extra }
    const data = new FormData(); data.append('intent', JSON.stringify(intent)); data.append('file', new Blob([contents]), intent.displayName)
    const response = await fetch(`${origin}/api/v1/uploads`, { method: 'POST', headers: { Authorization: headers.Authorization }, body: data })
    return { response, intent, data }
  }
  const prepare = async () => {
    const { response } = await upload()
    assert.equal(response.status, 200, await response.clone().text())
    const { generatedBy, ...source } = (await response.json()).draft
    assert.equal(generatedBy, 'long_text_paste')
    assert.equal(dirname(source.sourcePath), root)
    assert.match(basename(source.sourcePath), /^[\da-f-]{36}\.txt$/)
    assert.deepEqual(await readFile(source.sourcePath), bytes)
    assert.ok(source.pastedTextPreview.startsWith('Remote paste 😀 中文 Line with spaces'))
    assert.equal(Array.from(source.pastedTextPreview).length, 160)
    return source
  }
  const spoolCount = (await spools()).length
  const source = await prepare()
  assert.equal((await spools()).length, spoolCount, 'generated text goes directly to the Thread output directory')
  assert.equal((await files('restoreComposerAttachments', source.id))[0].generatedBy, 'long_text_paste')
  for (const [editor, scope] of [[otherSession, threadId], [session, otherThreadId]]) {
    assert.equal(await files('removePastedText', source.id, editor, scope), 'retained')
    assert.deepEqual(await readFile(source.sourcePath), bytes)
  }
  assert.deepEqual(await files('discardPastedText', source.id), { released: true })
  assert.equal((await files('restoreComposerAttachments', source.id))[0].generatedBy, 'long_text_paste', 'generic discard must not destroy unsent deletion authority')
  // A cleanup error must retain its registration; the already-saved local draft
  // is not rolled back by this endpoint. A directory cannot be unlinked as a file.
  await rename(source.sourcePath, source.sourcePath + '.saved')
  await mkdir(source.sourcePath)
  assert.equal((await files('removePastedText', source.id)).ok, false)
  assert.equal((await files('restoreComposerAttachments', source.id))[0].generatedBy, 'long_text_paste')
  await rmdir(source.sourcePath); await rename(source.sourcePath + '.saved', source.sourcePath)
  assert.equal(await files('removePastedText', source.id), 'deleted')
  await assert.rejects(readFile(source.sourcePath), { code: 'ENOENT' })
  assert.equal(await files('removePastedText', source.id), 'retained', 'idempotent removal cannot gain authority from a receipt')

  const malformed = await upload(Buffer.from([0xff]))
  assert.equal(malformed.response.status, 400, 'generated text requires valid UTF-8')
  const beforeReplay = new Set(await readdir(root))
  const replay = await upload()
  assert.equal(replay.response.status, 200)
  const replaySource = (await replay.response.json()).draft
  const replayResult = await fetch(`${origin}/api/v1/uploads`, { method: 'POST', headers: { Authorization: headers.Authorization }, body: replay.data })
  assert.equal(replayResult.status, 200)
  assert.equal((await replayResult.json()).draft.sourcePath, replaySource.sourcePath)
  // Cancellation cleanup is asynchronous; wait only for this request's duplicate.
  for (let attempt = 0; attempt < 100 && (await readdir(root)).filter(name => !beforeReplay.has(name)).length !== 1; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal((await readdir(root)).filter(name => !beforeReplay.has(name)).length, 1)
  assert.equal(await files('removePastedText', replaySource.id), 'deleted')

  const protectedSource = await prepare()
  // Sending the actual source from another Thread also protects the original.
  const sent = await host.request('camp.messages.send', { commandId: crypto.randomUUID(), threadId: otherThreadId,
    content: { version: 2, segments: [] }, sourceAttachments: [protectedSource], quotes: [], replyToThreadMessageId: null, execution: null })
  assert.notEqual(sent.commandResult.status, 'rejected', JSON.stringify(sent))
  const snapshot = new DatabaseSync(join(dataDir, 'rovai.sqlite'), { readOnly: true })
  try { assert.equal(snapshot.prepare('SELECT entered_send_flow FROM web_pasted_text_attachment WHERE attachment_id=?').get(protectedSource.id).entered_send_flow, 1) }
  finally { snapshot.close() }
  assert.equal(await files('removePastedText', protectedSource.id), 'retained')
  assert.deepEqual(await readFile(protectedSource.sourcePath), bytes)
  const published = await fetch(`${origin}/api/v1/attachments`, { method: 'POST', headers,
    body: JSON.stringify({ owner: 'message', threadId: otherThreadId, messageId: sent.commandResult.payload.threadMessageId, attachmentRefId: protectedSource.id }) })
  assert.equal(published.status, 200); assert.equal(await published.text(), text)

  // Keep one protected and one unsent source for the existing Host restart seam.
  const attempted = await prepare()
  const rejected = await host.request('camp.messages.send', { commandId: crypto.randomUUID(), threadId,
    content: { version: 2, segments: [] }, sourceAttachments: [attempted], quotes: [], replyToThreadMessageId: crypto.randomUUID(), execution: null })
    .catch(error => ({ error }))
  assert.ok(rejected.error || rejected.commandResult?.status === 'rejected', 'invalid reply must reject publication')
  const unsent = await prepare()
  return { attempted, unsent, text, threadId, editor: { clientId: session.clientId, proof: session.editorProof } }
}

export async function verifyPastedTextRestart({ origin, administratorToken, state }) {
  const login = await fetch(`${origin}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 6, administratorToken, editor: state.editor }) })
  assert.equal(login.status, 200)
  const session = await login.json()
  const files = async (action, id) => (await fetch(`${origin}/api/v1/files`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ action, request: { threadId: state.threadId, attachmentRefIds: [id] } }) })).json()
  for (const source of [state.attempted, state.unsent]) {
    const restored = (await files('restoreComposerAttachments', source.id))[0]
    assert.equal(restored.generatedBy, 'long_text_paste'); assert.equal(restored.availability, 'available')
    assert.equal(restored.sourcePath, source.sourcePath)
  }
  assert.equal(await files('removePastedText', state.attempted.id), 'retained')
  assert.equal(await readFile(state.attempted.sourcePath, 'utf8'), state.text)
  assert.equal(await files('removePastedText', state.unsent.id), 'deleted')
  await assert.rejects(readFile(state.unsent.sourcePath), { code: 'ENOENT' })
}
