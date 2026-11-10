import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

// Owns production WebEntry/Composer + real Rust receipts, including sends after
// refresh. No configured model is needed: send commands use execution: null.
test('production Web retains its mounted Composer and authentication across a real Host stop/restart', { timeout: 90_000 }, async t => {
  const root = resolve(import.meta.dirname, '../..')
  const uiDirectory = process.env.ROVAI_WEB_RECOVERY_UI_DIRECTORY ?? join(root, 'out/web')
  const binary = process.env.ROVAI_HOST_BIN ?? join(root, 'target/debug/rovai-host')
  const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  try { await access(binary); await access(chrome); await access(join(uiDirectory, 'index.html')) }
  catch { t.skip('Requires a built Host, WebUI and Chrome'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-recovery-live-')))
  const dataDir = join(fixture, 'core')
  const output = process.env.ROVAI_WEB_RECOVERY_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  const args = [...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')]
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), browserProfile: join(fixture, 'chrome'), runtime: false }))
  let host, browser
  try {
    host = launchHost(binary, args, { cwd: root })
    await within(host.ready)
    const profiles = await host.request('members.list')
    const created = await host.request('camps.create', { commandId: crypto.randomUUID(), name: '停服恢复验收', workspace: null,
      memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
    assert.equal(created.status, 'applied')
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'] })
    await browser.send('Page.navigate', { url: service.origin })
    await browser.wait(`document.querySelector('#administrator-token') !== null`)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: service.administratorToken })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.web-login-overlay') === null`)
    await browser.wait(`[...document.querySelectorAll('button')].some(e => e.textContent.includes('停服恢复验收'))`)
    await browser.click(`[...document.querySelectorAll('button')].find(e => e.textContent.includes('停服恢复验收'))`)
    const editor = `.camp-workspace form.composer:not(.single-chat-composer) [contenteditable="true"]`
    await browser.wait(`document.querySelector(${JSON.stringify(editor)}) !== null`)
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.send('Input.insertText', { text: '服务恢复后仍然保留的未提交草稿' })
    await browser.wait(`document.querySelector(${JSON.stringify(editor)}).textContent.includes('未提交草稿')`)
    await browser.evaluate(`void(window.recoveryComposerBeforeStop = document.querySelector(${JSON.stringify(editor)}))`)
    await host.close(); host = null
    await browser.wait(`document.querySelector('.web-offline-dialog') !== null`)
    await browser.click(`document.querySelector('.web-offline-retry')`)
    await browser.wait(`document.querySelector('.web-offline-title').textContent === '仍无法连接服务'`)
    await browser.capture(join(output, 'live-host-stopped.png'))
    await browser.key('Escape')
    assert.equal(await browser.evaluate(`document.querySelector('.web-offline-dialog') !== null`), true)
    host = launchHost(binary, args, { cwd: root })
    await within(host.ready)
    const resumed = await host.request('host.web.start', { listen: new URL(service.origin).host, uiDirectory })
    assert.equal(resumed.origin, service.origin)
    if (await browser.evaluate(`document.querySelector('.web-offline-retry') !== null`)) await browser.click(`document.querySelector('.web-offline-retry')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') === null && document.querySelector('.web-login-overlay') === null`)
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}) === window.recoveryComposerBeforeStop`), true)
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), '服务恢复后仍然保留的未提交草稿')
    await browser.capture(join(output, 'live-host-recovered.png'))
    await browser.send('Page.reload')
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent.includes('未提交草稿') && document.querySelector('.web-login-overlay') === null`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-offline-dialog') === null`), true)
    // Reproduce a persisted, never-admitted command without a Runtime. Recovery
    // must also unblock the real initial navigation reads after a page reload.
    const snapshot = await host.request('camps.open', { threadId: created.payload.threadId, traceId: crypto.randomUUID() })
    const pending = { operation: 'threads.rename', params: { commandId: crypto.randomUUID(), command: {
      threadId: created.payload.threadId, title: '原提交恢复完成', expectedVersion: snapshot.thread.version } } }
    await browser.evaluate(`(() => { const saved = JSON.parse(sessionStorage.getItem('rovai.web.session.v1')); saved.pending = [${JSON.stringify(pending)}]; sessionStorage.setItem('rovai.web.session.v1', JSON.stringify(saved)) })()`)
    await browser.send('Page.reload')
    await browser.wait(`document.querySelector('.web-offline-retry') !== null`)
    await browser.click(`document.querySelector('.web-offline-retry')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') === null && document.body.textContent.includes('原提交恢复完成') && document.querySelector(${JSON.stringify(editor)})?.textContent.includes('未提交草稿')`)
    assert.deepEqual(await browser.evaluate(`JSON.parse(sessionStorage.getItem('rovai.web.session.v1')).pending`), [])
    assert.equal((await host.request('camps.open', { threadId: created.payload.threadId, traceId: crypto.randomUUID() })).thread.title, '原提交恢复完成')

    const threadId = created.payload.threadId
    const draftKey = `rovai.camp-composer-draft.v1:${threadId}`
    const message = text => ({ operation: 'thread.messages.send', params: { commandId: crypto.randomUUID(), threadId,
      content: { version: 2, segments: [{ kind: 'text', text }] }, sourceAttachments: [], quotes: [], replyToThreadMessageId: null, execution: null } })
    const setDraft = async text => {
      await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
      await browser.evaluate(`document.execCommand('selectAll')`)
      await browser.send('Input.insertText', { text })
      await browser.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(draftKey)}))?.body === ${JSON.stringify(text)}`)
    }
    const restorePending = async entry => {
      await browser.evaluate(`(() => { const saved = JSON.parse(sessionStorage.getItem('rovai.web.session.v1')); saved.pending = [${JSON.stringify(entry)}]; sessionStorage.setItem('rovai.web.session.v1', JSON.stringify(saved)) })()`)
      await browser.send('Page.reload')
    }
    // Unknown at refresh: the real mounted editor and persisted draft both
    // settle after the explicit retry, without remounting the Composer.
    const publicSend = message('服务恢复后仍然保留的未提交草稿')
    await restorePending(publicSend)
    await browser.wait(`document.querySelector('.web-offline-retry') !== null && document.querySelector(${JSON.stringify(editor)}) !== null`)
    await browser.evaluate(`void(window.composerBeforeSendRecovery = document.querySelector(${JSON.stringify(editor)}))`)
    await browser.click(`document.querySelector('.web-offline-retry')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') === null && document.querySelector(${JSON.stringify(editor)})?.textContent === ''`)
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}) === window.composerBeforeSendRecovery`), true)
    assert.equal(await browser.evaluate(`localStorage.getItem(${JSON.stringify(draftKey)})`), null)
    const receipt = await host.request('commands.reconcile', { operation: publicSend.operation, params: publicSend.params })
    assert.equal(receipt.result.commandResult.status, 'applied')
    assert.equal((await host.request('camps.open', { threadId, traceId: crypto.randomUUID() })).messages.length, 1)
    await browser.capture(join(output, 'public-send-recovered.png'))

    // A recorded send must settle on read-only startup lookup; neither a retry
    // click nor a duplicate dispatch is necessary to clear the matching draft.
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.recoveryRequests = [];
      const realFetch = window.fetch;
      window.fetch = function(url, init) {
        if (String(url).endsWith('/request') && init?.body) window.recoveryRequests.push(JSON.parse(init.body).operation);
        return realFetch.call(this, url, init);
      };` })
    const recorded = message('已提交但响应丢失')
    await setDraft('已提交但响应丢失')
    assert.equal((await host.request(recorded.operation, recorded.params)).commandResult.status, 'applied')
    await restorePending(recorded)
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent === '' && document.querySelector('.web-offline-dialog') === null`)
    assert.equal(await browser.evaluate(`localStorage.getItem(${JSON.stringify(draftKey)})`), null)
    assert.equal(await browser.evaluate(`recoveryRequests.includes('thread.messages.send')`), false)
    // Later edits belong to the user even when the earlier send is confirmed.
    await setDraft('后来编辑的草稿必须保留')
    await restorePending(recorded)
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent === '后来编辑的草稿必须保留' && document.querySelector('.web-offline-dialog') === null`)
    assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(draftKey)})).body`), '后来编辑的草稿必须保留')
    assert.deepEqual(await browser.evaluate(`JSON.parse(sessionStorage.getItem('rovai.web.session.v1')).pending`), [])
    assert.equal(await browser.evaluate(`recoveryRequests.includes('thread.messages.send')`), false)
    assert.equal((await host.request('camps.open', { threadId, traceId: crypto.randomUUID() })).messages.length, 2)

    // Use the production ConsoleClient against this same real Host to inspect
    // the original Promise as well as the durable receipt (no synthetic Core replies).
    const probe = await build({ configFile: false, logLevel: 'error', define: {
      'process.env.NODE_ENV': JSON.stringify('production')
    }, resolve: { alias: {
      '@contracts': join(root, 'packages/contracts/src/index.ts')
    } }, build: { write: false, lib: {
      entry: join(root, 'apps/web/src/client.ts'), name: 'RecoveryClientProbe', formats: ['iife'] } } })
    await browser.evaluate(`${(Array.isArray(probe) ? probe[0] : probe).output.find(entry => entry.type === 'chunk').code}\nvoid 0`)
    const validation = await browser.evaluate(`(async () => {
      let loseAdmission = true, loseResponse = false, sends = 0;
      const client = new RecoveryClientProbe.ConsoleClient(location.origin, async (url, init) => {
        const send = String(url).endsWith('/request') && JSON.parse(init?.body ?? '{}').operation === 'thread.messages.send';
        if (send) sends++;
        if (send && loseAdmission) { loseAdmission = false; throw new TypeError('Service stopped before admission'); }
        const response = await fetch(url, init);
        if (send && loseResponse) { loseResponse = false; await response.text(); throw new TypeError('Lost response after real Core commit'); }
        return response;
      });
      await client.login(${JSON.stringify(service.administratorToken)});
      const params = ${JSON.stringify(message('').params)};
      let outcome = 'pending';
      const promise = client.request('thread.messages.send', params).then(value => { outcome = value.commandResult?.status ?? 'resolved' }, error => { outcome = 'rejected'; return error.message });
      await new Promise(resolve => setTimeout(resolve, 0));
      const beforeRetry = { outcome, pending: client.pendingCommandCount, connection: client.connectionState };
      await client.retryPending();
      await Promise.race([promise, new Promise(resolve => setTimeout(resolve, 3000))]);
      const result = { beforeRetry, outcome, pending: client.pendingCommandCount, connection: client.connectionState };
      if (outcome === 'rejected' && result.pending === 0) {
        loseResponse = true;
        const sentBefore = sends;
        const delivered = await client.request('thread.messages.send', ${JSON.stringify(message('真实提交后丢失响应').params)});
        await client.retryPending();
        result.lostResponse = { status: delivered.commandResult?.status, sends: sends - sentBefore, pending: client.pendingCommandCount, connection: client.connectionState };
      }
      client.clear(); return result;
    })()`)
    assert.deepEqual(validation.beforeRetry, { outcome: 'pending', pending: 1, connection: 'offline' })
    assert.equal(validation.outcome, 'rejected', JSON.stringify(validation))
    assert.equal(validation.pending, 0)
    assert.equal(validation.connection, 'live')
    assert.deepEqual(validation.lostResponse, { status: 'applied', sends: 1, pending: 0, connection: 'live' })
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'live-verification.json'), JSON.stringify({ hostBinarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
      hostRestartVerified: true, productionWebEntry: true, runtimeExecuted: false, validation,
      checks: ['real Host stopped', 'retry while stopped', 'original Composer DOM retained', 'draft retained', 'same Session resumes', 'reload retains draft and authentication', 'persisted unknown command recovered through Core', 'initial navigation unblocked after recovery', 'public send clears mounted and durable draft after refresh', 'recorded public send settles without dispatch', 'later public edits preserved', 'real Core rejection settles original Promise and gate', 'lost response after real commit recovered without resend'] }, null, 2))
    console.log(`Live recovery evidence: ${output}`)
  } finally {
    await browser?.close(); await host?.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir)
    await rm(fixture, { recursive: true, force: true })
  }
})
