import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '../..')
const uiDirectory = process.env.ROVAI_WEB_RECOVERY_UI_DIRECTORY ?? join(root, 'out/web')
const binary = process.env.ROVAI_HOST_BIN ?? join(root, 'target/debug/rovai-host')
const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
async function hasLiveEnvironment(t) {
  try { await Promise.all([access(binary), access(chrome), access(join(uiDirectory, 'index.html'))]); return true }
  catch { t.skip('Requires a built Host, WebUI and Chrome'); return false }
}

// Owns production WebEntry/Composer + real Rust receipts, including sends after
// refresh. No configured model is needed: send commands use execution: null.
test('production Web retains its mounted Composer and authentication across a real Host stop/restart', { timeout: 90_000 }, async t => {
  if (!await hasLiveEnvironment(t)) return
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
    const pending = { operation: 'threads.rename', params: { commandId: crypto.randomUUID(), command: {
      threadId: created.payload.threadId, title: '原提交恢复完成' } } }
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
        if (window.failLogout && String(url).endsWith('/logout')) {
          return Promise.resolve(Response.json({ error: { code: 'session_storage_unavailable', message: '退出未完成，请重试。' } }, { status: 503 }));
        }
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

    // A reloaded upload has an intent but no File. Restore that real intent
    // through WebEntry and verify successful recovery independently of a later error.
    const bytes = Buffer.from('reselect this fixture file')
    const upload = { commandId: crypto.randomUUID(), threadId, expectedRevision: 0, displayName: 'original.txt',
      byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await browser.evaluate(`(() => {
      const saved = JSON.parse(sessionStorage.getItem('rovai.web.session.v1'));
      saved.uploads = [${JSON.stringify(upload)}];
      sessionStorage.setItem('rovai.web.session.v1', JSON.stringify(saved));
    })()`)
    await browser.send('Page.reload')
    await browser.wait(`document.querySelector('.web-offline-retry:not(:disabled)') !== null`)
    await browser.click(`document.querySelector('.web-offline-retry')`)
    const recoveryNotice = `document.querySelector('.app-toast[role=status]')`
    await browser.wait(`!!${recoveryNotice} && !document.querySelector('.web-offline-dialog')`)
    const notice = await browser.evaluate(`(() => {
      const toast = ${recoveryNotice};
      const shell = document.querySelector('.app-shell');
      window.recoveryNotice = toast;
      return {
        mobile: document.documentElement.dataset.mobileWeb === 'true',
        top: toast.getBoundingClientRect().top - shell.getBoundingClientRect().top,
        mountedInShell: toast.parentElement.parentElement === shell,
        live: toast.getAttribute('aria-live'),
        danger: toast.classList.contains('is-danger'),
        text: toast.querySelector('.app-toast-message').textContent,
        controls: [...toast.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))
      };
    })()`)
    assert.deepEqual(notice, { mobile: true, top: 58, mountedInShell: true, live: 'polite', danger: false,
      text: '连接已恢复。未完成的上传需要重新选择原文件。', controls: ['关闭提示'] })
    await browser.capture(join(output, 'live-recovery-notice-mobile.png'))

    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    await browser.wait(`document.documentElement.dataset.mobileWeb !== 'true' && !!document.querySelector('.sidebar-settings-main')`)
    await browser.click(`document.querySelector('.sidebar-settings-main')`)
    const remoteSettings = `[...document.querySelectorAll('.settings-sidebar-menu button')].find(button => button.textContent.trim() === '远程连接')`
    await browser.wait(`!!${remoteSettings}`)
    await browser.click(remoteSettings)
    await browser.wait(`document.querySelector('.remote-connection-page .quiet-button') !== null`)
    await browser.evaluate('window.failLogout = true')
    await browser.click(`document.querySelector('.remote-connection-page .quiet-button')`)
    const connectionError = `document.querySelector('.app-toast.is-danger[role=alert]')`
    await browser.wait(`!!${connectionError}`)
    const failure = await browser.evaluate(`(() => {
      const toast = ${connectionError};
      return {
        live: toast.getAttribute('aria-live'),
        text: toast.querySelector('.app-toast-message').textContent,
        controls: [...toast.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))
      };
    })()`)
    assert.deepEqual(failure, { live: 'assertive', text: '退出未完成，请重试。', controls: ['关闭提示'] })
    await pause(5500)
    assert.equal(await browser.evaluate(`!!${connectionError} && ${recoveryNotice} === window.recoveryNotice`), true)
    await browser.capture(join(output, 'live-recovery-notice-and-error.png'))
    await browser.click(`${connectionError}.querySelector('.app-toast-close')`)
    await browser.wait(`!${connectionError} && ${recoveryNotice} === window.recoveryNotice`)
    await browser.click(`${recoveryNotice}.querySelector('.app-toast-close')`)
    await browser.wait(`!document.querySelector('.app-toast-viewport')`)
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'live-verification.json'), JSON.stringify({ hostBinarySha256: createHash('sha256').update(await readFile(binary)).digest('hex'),
      hostRestartVerified: true, productionWebEntry: true, runtimeExecuted: false, validation, toasts: { notice, failure },
      checks: ['real Host stopped', 'retry while stopped', 'original Composer DOM retained', 'draft retained', 'same Session resumes', 'reload retains draft and authentication', 'persisted unknown command recovered through Core', 'initial navigation unblocked after recovery', 'public send clears mounted and durable draft after refresh', 'recorded public send settles without dispatch', 'later public edits preserved', 'real Core rejection settles original Promise and gate', 'lost response after real commit recovered without resend', 'upload reselection is a polite notice on mobile', 'logout failure is a separate alert', 'notice and error remain until independently dismissed'] }, null, 2))
    console.log(`Live recovery evidence: ${output}`)
  } finally {
    await browser?.close(); await host?.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir)
    await rm(fixture, { recursive: true, force: true })
  }
})

function installPreviewProbe(messageId) {
  const probe = window.imageProbe = { opens: 0, reads: 0, release: null }
  const fetchSource = window.fetch.bind(window)
  window.fetch = async (url, init) => {
    const path = new URL(url, location.href).pathname
    if (path === '/api/v1/files') {
      const { action, request } = JSON.parse(init.body)
      if (action === 'open' && request.locator?.messageId === messageId) probe.opens++
    }
    if (path !== '/api/v1/files/bytes' || JSON.parse(init.body).action !== 'readBinary') return fetchSource(url, init)
    const first = ++probe.reads === 1
    const response = await fetchSource(url, init)
    if (first) {
      // Hold the original response only after the real Host has sent all of its bytes.
      await response.clone().arrayBuffer()
      await new Promise(resolve => { probe.release = resolve })
    }
    return response
  }
  probe.pixel = selector => {
    const image = document.querySelector(selector)
    if (!image?.naturalWidth) return null
    const context = document.createElement('canvas').getContext('2d')
    context.drawImage(image, 0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',')
  }
}

test('Web shares image reads with export and releases previews at the authentication boundary', { timeout: 90_000 }, async t => {
  if (!await hasLiveEnvironment(t)) return
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-image-preview-live-')))
  const dataDir = join(fixture, 'core')
  const skills = join(dataDir, 'skills')
  const profile = join(fixture, 'chrome')
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: skills, browserProfile: profile, runtime: false }))
  let host, browser
  try {
    host = launchHost(binary, [...coreDataDirectoryArguments(dataDir), '--skill-library-root', skills, '--mcp-config-path', join(dataDir, 'mcp.json')], { cwd: root })
    browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'] })
    const [member] = await host.request('members.list')
    const created = await host.request('camps.create', { commandId: crypto.randomUUID(), name: '图片预览验收', workspace: null,
      memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, collaborationMode: 'peer' })
    assert.equal(created.status, 'applied')
    const threadId = created.payload.threadId
    const sourcePath = join(fixture, 'source.png')
    const png = async color => Buffer.from(await browser.evaluate(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = ${JSON.stringify(color)}; context.fillRect(0, 0, 32, 32);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`), 'base64')
    const blue = await png('#0050f0'), orange = await png('#ff7800')
    await writeFile(sourcePath, blue)
    const sent = await host.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId, content: { version: 2, segments: [{ kind: 'text', text: '共享原图' }] },
      sourceAttachments: [{ id: crypto.randomUUID(), kind: 'file', displayName: 'source.png', mediaType: 'image/png', sourcePath, observedByteSize: blue.length }],
      quotes: [], replyToThreadMessageId: null, execution: null })
    assert.equal(sent.commandResult.status, 'applied')
    const messageId = sent.commandResult.payload.threadMessageId
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installPreviewProbe.toString()})(${JSON.stringify(messageId)})` })
    await browser.send('Page.navigate', { url: service.origin })
    const element = selector => `document.querySelector(${JSON.stringify(selector)})`
    const click = selector => browser.click(element(selector))
    const login = async token => {
      await browser.wait(`!!${element('#administrator-token')}`)
      await click('#administrator-token')
      await browser.send('Input.insertText', { text: token })
      await click('.web-login button[type=submit]')
      await browser.wait(`!${element('.web-login-overlay')}`)
    }
    const openThread = `[data-thread-id="${threadId}"] .camp-nav-open`
    const timeline = `[data-message-id="${messageId}"] .image-tile-preview img`
    const exported = `[data-export-message-id="${messageId}"] .message-export-image`
    const pixel = selector => `imageProbe.pixel(${JSON.stringify(selector)})`
    const counts = () => browser.evaluate('[imageProbe.opens, imageProbe.reads]')
    const openExport = async () => {
      await click(`[data-message-id="${messageId}"] .message-more-button`)
      const select = `[...document.querySelectorAll('.message-action-menu [role=menuitem]')].find(e => e.textContent.trim() === '多选')`
      await browser.wait(`!!(${select})`)
      await browser.click(select)
      await browser.wait(`!!${element('.message-selection-actions .primary-button:not(:disabled)')}`)
      await click('.message-selection-actions .primary-button')
      await browser.wait(`!!${element(`[data-export-message-id="${messageId}"] .message-export-attachment`)}`)
    }
    await login(service.administratorToken)
    await browser.wait(`!!${element(openThread)}`)
    await click(openThread)
    await browser.wait('!!imageProbe.release')
    await writeFile(sourcePath, orange)
    await openExport()
    await browser.evaluate('imageProbe.release()')
    await browser.wait(`${pixel(timeline)} && ${pixel(exported)}`)
    assert.deepEqual(await browser.evaluate(`[${pixel(timeline)}, ${pixel(exported)}]`), ['0,80,240', '0,80,240'])
    assert.deepEqual(await counts(), [1, 1], 'public and export viewers share a single Host open/read')
    await browser.evaluate(`void(imageProbe.oldUrl = ${element(timeline)}.src)`)
    await browser.key('Escape')
    await browser.wait(`!${element('.message-export-dialog')}`)
    await browser.key('Escape')
    await click('.sidebar-settings-main')
    const remote = `[...document.querySelectorAll('.settings-sidebar-menu button')].find(e => e.textContent.trim() === '远程连接')`
    await browser.wait(`!!(${remote})`)
    await browser.click(remote)
    await click('.remote-connection-page .quiet-button')
    await browser.wait(`!!${element('#administrator-token')}`)
    assert.equal(await browser.evaluate('fetch(imageProbe.oldUrl).then(() => false, () => true)'), true, 'logout revokes the old preview URL')
    await login(service.administratorToken)
    await click('.settings-sidebar-back')
    await browser.wait(`!!${element(openThread)}`)
    await click(openThread)
    await browser.wait(`${pixel(timeline)} === '255,120,0'`)
    assert.deepEqual(await counts(), [2, 2], 'same-tab login reads the changed original exactly once')

    // Expire the session with the editor, gallery, export and enlarged image all mounted.
    const editor = '#camp-message'
    await click(editor)
    await browser.send('Input.insertText', { text: '认证恢复时保留' })
    await browser.wait(`${element(editor)}.textContent === '认证恢复时保留'`)
    await browser.evaluate(`Object.assign(imageProbe, { editor: ${element(editor)}, oldUrl: ${element(timeline)}.src }); void 0`)
    await openExport()
    await browser.wait(`${pixel(exported)} === '255,120,0'`)
    await click(exported)
    await browser.wait(`${pixel('.message-export-zoom img')} === '255,120,0'`)
    assert.deepEqual(await counts(), [2, 2])
    const rotated = await host.request('host.web.rotate')
    await browser.wait(`!!${element('#administrator-token')} && !${element(timeline)} && !${element('.message-export-dialog, .message-export-zoom')}`)
    assert.equal(await browser.evaluate('fetch(imageProbe.oldUrl).then(() => false, () => true)'), true)
    await writeFile(sourcePath, blue)
    await login(rotated.administratorToken)
    await browser.wait(`${pixel(timeline)} === '0,80,240' && ${pixel(exported)} === '0,80,240'`)
    assert.deepEqual(await counts(), [3, 3])
    assert.equal(await browser.evaluate(`!!${element('.message-export-zoom')}`), false)
    assert.equal(await browser.evaluate(`${element(editor)} === imageProbe.editor && imageProbe.editor.textContent === '认证恢复时保留'`), true)
    assert.deepEqual(browser.errors, [])
  } finally {
    await browser?.close()
    await host?.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir)
    await rm(fixture, { recursive: true, force: true })
  }
})
