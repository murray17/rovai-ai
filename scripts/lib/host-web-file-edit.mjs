import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Extends the existing Host pipe/HTTP owner with real Desktop file admission and
// disk writes. The caller owns isolated Core, workspace and cleanup.
export async function exerciseFileEditing({ host, fileCall, session, otherSession, threadId, workspace, fixture }) {
  const root = resolve(import.meta.dirname, '../..')
  const require = createRequire(import.meta.url)
  const esbuild = createRequire(require.resolve('vite'))('esbuild')
  const bundle = join(fixture, 'desktop-file-edit.cjs')
  await esbuild.build({ stdin: { contents: `export { FilePreviewService } from './apps/desktop/src/main/file-preview/file-preview-service'; export { CoreFilePreviewSourceAuthority } from './apps/desktop/src/main/file-preview/file-preview-authority';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs' })
  const { FilePreviewService, CoreFilePreviewSourceAuthority } = await import(pathToFileURL(bundle).href)
  const native = { selectRoot: async () => null, confirmOpen: async () => false, openPath: async () => '', revealPath() {}, copyText() {}, publishExternalUpdate() {} }
  const desktop = new FilePreviewService(new CoreFilePreviewSourceAuthority(host), native)
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
    console.log('File editing: Desktop admission → Host write → disk; Web HTTP → same Host write → disk; scoped handles, conflict, explicit overwrite and deletion verified.')
  } finally {
    if (webHandle) await fileCall(session, 'release', { handleId: webHandle })
    await desktop.closeAll()
  }
}
