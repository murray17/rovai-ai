import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'

// Extends the existing Host pipe/HTTP owner with real Desktop file admission and
// disk writes. The caller owns isolated Core, workspace and cleanup.
export async function exerciseFileEditing({ host, fileCall, session, otherSession, threadId, workspace, fixture }) {
  const root = resolve(import.meta.dirname, '../..')
  const require = createRequire(import.meta.url)
  const esbuild = createRequire(require.resolve('vite'))('esbuild')
  const bundle = join(fixture, 'desktop-file-edit.cjs')
  await esbuild.build({ stdin: { contents: `export { FilePreviewService } from './apps/desktop/src/main/file-preview/file-preview-service'; export { CoreFilePreviewSourceAuthority } from './apps/desktop/src/main/file-preview/file-preview-authority'; export { FilePreviewResources } from './apps/desktop/src/renderer/src/file-preview-resources'; export { createBrowserHtmlPreview } from './apps/web/src/html-preview';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs' })
  const { FilePreviewService, CoreFilePreviewSourceAuthority, FilePreviewResources, createBrowserHtmlPreview } = await import(pathToFileURL(bundle).href)
  const native = { selectRoot: async () => null, confirmOpen: async () => false, openPath: async () => '', revealPath() {}, copyText() {}, publishExternalUpdate() {} }
  const authority = new CoreFilePreviewSourceAuthority(host)
  const desktop = new FilePreviewService(authority, native)
  const path = join(workspace, 'editable.ts')
  const source = { kind: 'camp_workspace', threadId, rawReference: 'editable.ts' }
  await writeFile(path, '\ufeffconst number = 1;\r\n// trailing  ')
  let webHandle
  try {
    await desktop.bindThread(901, threadId)
    const opened = await desktop.open(901, source)
    assert.equal(opened.ok, true, JSON.stringify(opened))
    const file = opened.value.file
    const access = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
    assert.equal((await desktop.editText(902, access, false)).ok, false, 'another window cannot use the edit handle')
    const read = await desktop.editText(901, access, false)
    assert.equal(read.ok, true, JSON.stringify(read))
    const text = 'const number = 2;\n// trailing  '
    const saved = await desktop.editText(901, { ...access, text, expectedVersion: read.value.version }, true)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(await readFile(path, 'utf8'), '\ufeffconst number = 2;\r\n// trailing  ')

    // Hold this one transport call before Host admission, then change the real
    // file. This verifies the Host version check, not cross-process locking.
    const edit = authority.edit.bind(authority)
    let release, entered
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    authority.edit = async (saving, input) => { if (saving) { entered(); await held } return edit(saving, input) }
    const racing = desktop.editText(901, { ...access, text: 'waiting draft', expectedVersion: saved.value.version }, true)
    await started
    await writeFile(path, 'outside while save was waiting')
    release()
    const raced = await racing
    authority.edit = edit
    assert.equal(raced.error.code, 'edit_conflict')
    assert.equal(raced.current.text, 'outside while save was waiting')
    assert.equal(await readFile(path, 'utf8'), raced.current.text)
    // Restore the supported encoding fixture with a fresh, checked baseline.
    await writeFile(path, '\ufeffconst number = 2;\r\n// trailing  ')

    const webFile = (await fileCall(session, 'open', source)).value.file
    webHandle = webFile.handleId
    const webAccess = { handleId: webFile.handleId, expectedGeneration: webFile.contentGeneration }
    const webRead = await fileCall(session, 'readEditableFile', webAccess)
    assert.equal(webRead.ok, true, JSON.stringify(webRead))
    assert.equal(webRead.value.key, read.value.key, 'both clients address the same Host file')
    assert.equal((await fileCall(otherSession, 'saveTextFile', { ...webAccess, text: 'bad', expectedVersion: webRead.value.version })).ok, false, 'handle is editor-scoped')
    // Escaped JSON exceeds the ordinary 1 MiB API limit; the text itself is under 2 MiB.
    const large = '"'.repeat(600_000)
    const webSave = await fileCall(session, 'saveTextFile', { ...webAccess, text: large, expectedVersion: webRead.value.version })
    assert.equal(webSave.ok, true, JSON.stringify(webSave))
    assert.equal(await readFile(path, 'utf8'), '\ufeff' + large)
    await writeFile(path, 'external')
    const conflict = await fileCall(session, 'saveTextFile', { ...webAccess, text: 'local', expectedVersion: webSave.value.version })
    assert.equal(conflict.error.code, 'edit_conflict')
    assert.equal(await readFile(path, 'utf8'), 'external')
    const overwrite = await fileCall(session, 'saveTextFile', { ...webAccess, text: 'local', expectedVersion: conflict.current.version })
    assert.equal(overwrite.ok, true)
    assert.equal(await readFile(path, 'utf8'), 'local')
    await unlink(path)
    assert.equal((await fileCall(session, 'saveTextFile', { ...webAccess, text: 'recreate', expectedVersion: overwrite.value.version })).ok, false)
    await assert.rejects(readFile(path), { code: 'ENOENT' })
    await exerciseHtmlRefresh({ desktop, fileCall, session, threadId, workspace, FilePreviewResources, createBrowserHtmlPreview })
    console.log('File editing: Desktop and Web real Host writes/readback; pending-save external conflict; scoped handles, explicit overwrite and deletion; production save → HTML reload/candidate → fresh Desktop HTTP and Web document bytes verified.')
  } finally {
    if (webHandle) await fileCall(session, 'release', { handleId: webHandle })
    await desktop.closeAll()
  }
}

function waitFor(owner, read) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('HTML save did not prepare a new preview')) }, 5000)
    const check = () => { const value = read(); if (value) { clearTimeout(timeout); unsubscribe(); resolve(value) } }
    const unsubscribe = owner.subscribe(check)
    check()
  })
}

function siteRead(site, path, headers = {}) {
  const origin = new URL(site.origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: origin.port, path, headers: { host: origin.host, ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }))
    })
    request.on('error', reject); request.end()
  })
}

async function htmlBytes(site) {
  if (site.sandboxedDocument !== undefined) return site.sandboxedDocument
  const start = await siteRead(site, new URL(site.entryUrl).pathname, { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' })
  assert.equal(start.status, 302)
  const page = await siteRead(site, new URL(site.documentUrl).pathname, { cookie: start.headers['set-cookie'][0].split(';')[0] })
  assert.equal(page.status, 200)
  return page.text
}

async function exerciseHtmlRefresh({ desktop, fileCall, session, threadId, workspace, FilePreviewResources, createBrowserHtmlPreview }) {
  const path = join(workspace, 'editable.html')
  const originalLocation = globalThis.location
  const originalDocument = globalThis.document
  globalThis.location = { origin: 'http://review.localhost' }
  globalThis.document = { activeElement: null }
  try {
    for (const client of ['Desktop', 'Web']) {
      const before = `<!doctype html><h1>Before ${client}</h1>`
      const after = `<!doctype html><h1>Saved from ${client}</h1>`
      await writeFile(path, before)
      const call = (method, request) => client === 'Desktop' ? desktop[method](901, request) : fileCall(session, method, request)
      const api = {
        bindThread: async () => {}, onExternalUpdate: () => () => {},
        open: request => call('open', request), restore: request => call('open', request),
        reopen: request => call('reopen', request), readText: request => call('readText', request),
        reload: request => call('reload', request), release: request => call('release', request),
        readEditableFile: request => client === 'Desktop' ? desktop.editText(901, request, false) : call('readEditableFile', request),
        saveTextFile: request => client === 'Desktop' ? desktop.editText(901, request, true) : call('saveTextFile', request),
        prepareHtmlSite: request => client === 'Desktop' ? call('prepareHtmlSite', request) : createBrowserHtmlPreview({ files: (method, request) => call(method, request) }, request),
        releaseHtmlSite: request => client === 'Desktop' ? call('releaseHtmlSite', request) : Promise.resolve({ released: true }),
      }
      const owner = new FilePreviewResources(api)
      try {
        owner.activate(threadId)
        const preview = owner.session(threadId)
        const opened = await preview.actions.open({ kind: 'camp_workspace', threadId, rawReference: 'editable.html' })
        assert.equal(opened.kind, 'preview')
        const tab = () => preview.getSnapshot().tabs.find(tab => tab.id === opened.tabId)
        await waitFor(owner, () => tab().content)
        assert.equal(tab().content.kind, 'html')
        assert.ok((await htmlBytes(tab().content.preview)).includes(`<h1>Before ${client}</h1>`))
        await owner.edits.attach(opened.tabId, tab().file)
        const doc = owner.edits.get(opened.tabId)
        owner.edits.change(doc, after)
        assert.equal(await owner.edits.save(doc), true)
        assert.equal(await readFile(path, 'utf8'), after)
        // The real production onSaved callback, not a test-issued reload,
        // prepares the next HTML candidate through the existing preview API.
        const candidate = await waitFor(owner, () => tab().candidate)
        assert.ok((await htmlBytes(candidate.loaded.content.preview)).includes(`<h1>Saved from ${client}</h1>`))
        preview.actions.completeHtmlRefresh(opened.tabId, candidate.file.handleId)
        preview.actions.displayed(opened.tabId, candidate.file.handleId)
        assert.equal(tab().candidate, undefined)
        assert.equal(tab().file.handleId, candidate.file.handleId)
        assert.equal(doc.draft, after); assert.equal(doc.savedText, after)
      } finally { owner.dispose() }
    }
  } finally {
    if (originalLocation === undefined) delete globalThis.location
    else globalThis.location = originalLocation
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
}
