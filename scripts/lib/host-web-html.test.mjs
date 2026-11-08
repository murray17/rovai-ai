import assert from 'node:assert/strict'
import { access, mkdtemp, realpath, readFile, writeFile, rm, mkdir, readdir, rename, open, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
// Actual Rust resource authorization + production React viewer + Chrome CSP.
// No daily data, native App, model, or network dependency is used by this fixture.
test('trusted Web HTML uses native storage, forms, popups and modals while preserving source and diagnostics', { timeout: 90_000 }, async t => {
  if (process.platform !== 'darwin') { t.skip('macOS Chrome acceptance; other platforms remain separately unverified'); return }
  const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (!await access(executable).then(() => true, () => false)) { t.skip('Chrome unavailable'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-html-')))
  const dataDir = join(fixture, 'core')
  const uploadScratch = join(fixture, 'uploads')
  await mkdir(uploadScratch)
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), browserProfile: join(fixture, 'chrome'), runtime: false }))
  const host = launchHost(process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug/rovai-host'), [
    ...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository, env: { ...process.env, TMPDIR: uploadScratch, TMP: uploadScratch, TEMP: uploadScratch } })
  let browser
  let submittedForm = ''
  const formServer = createServer(async (request, response) => {
    if (request.method === 'POST') {
      for await (const chunk of request) submittedForm += chunk
    }
    response.setHeader('Content-Type', 'text/html'); response.end('<h1>FORM_OK</h1>')
  })
  await new Promise(resolve => formServer.listen(0, '127.0.0.1', resolve))
  const formOrigin = `http://127.0.0.1:${formServer.address().port}`
  try {
    await within(host.ready)
    const profiles = await host.request('members.list')
    const created = await host.request('camps.create', { commandId: crypto.randomUUID(), name: 'HTML attachment acceptance', workspace: null, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(repository, 'out/web') })
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Interactive attachment</title><link rel="stylesheet" href="./theme.css"><style>body{margin:0}button{position:absolute;left:20px;top:60px;width:200px;height:40px}h1{font:24px sans-serif}</style></head><body><h1>Rendered HTML</h1><button id="run">Run interaction</button><p id="result"></p><form action="${formOrigin}/submit" method="post" target="form-result"><input name="value" value="native-form"><button id="submit" style="top:120px">Submit form</button></form><iframe name="form-result" hidden></iframe><script>
      const visits=Number(localStorage.getItem('preview-visits')||0)+1;
      localStorage.setItem('preview-visits',String(visits));
      sessionStorage.setItem('preview-session','native-session');
      const report=()=>parent.postMessage({type:'html-acceptance',visits,nativeStorage:localStorage instanceof Storage&&sessionStorage instanceof Storage,parentSentinel:parent.sessionStorage.getItem('acceptance-sentinel'),session:sessionStorage.getItem('preview-session'),color:getComputedStyle(document.body).backgroundColor,clicked:document.querySelector('#result').textContent},location.origin);
      document.querySelector('#run').onclick=()=>{document.querySelector('#result').textContent='INTERACTION_OK';report();const missing=new Image();missing.src='./missing-local-image.png';document.body.append(missing)};report();
    </script></body></html>`
    const file = join(fixture, 'interactive.html'); await writeFile(file, html)
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    const downloadDirectory = join(fixture, 'downloads'); await mkdir(downloadDirectory)
    // Chrome can create the destination before writing its bytes. Existence is
    // not download completion; retain exact-byte assertions after the length settles.
    const waitDownload = (name, size) => within((async () => {
      while ((await stat(join(downloadDirectory, name)).catch(() => null))?.size !== size) await new Promise(resolve => setTimeout(resolve, 50))
    })())
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory })
    const listen = `window.htmlAcceptance=[];addEventListener('message',e=>{if(e.source===document.querySelector('.file-preview-html')?.contentWindow&&e.origin===location.origin&&e.data?.type==='html-acceptance')window.htmlAcceptance.push(e.data)})`
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: listen })
    await browser.send('Page.navigate', { url: service.origin })
    await browser.wait(`document.querySelector('#administrator-token') !== null`)
    assert.equal(await browser.evaluate(`document.querySelector('#administrator-token').placeholder`), '输入 64 位的 Token')
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: service.administratorToken })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.web-login-overlay') === null`)
    await browser.wait(`[...document.querySelectorAll('button')].some(e=>e.textContent.includes('HTML attachment acceptance'))`)
    await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('HTML attachment acceptance'))`)
    await browser.wait(`document.querySelector('.conversation-controls .composer-file-input:not(:disabled)') !== null`)
    await browser.evaluate(`sessionStorage.setItem('acceptance-sentinel','private')`)
    await browser.setFiles('.conversation-controls .composer-file-input', [file])
    await browser.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
    const uploads = (await readdir(uploadScratch)).filter(name => name.startsWith('rovai-web-upload-'))
    assert.equal(uploads.length, 1)
    const stylesheet = join(uploadScratch, uploads[0], 'theme.css')
    await writeFile(stylesheet, 'body{background:rgb(236,238,239)}')
    await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.documentState==='loaded' && window.htmlAcceptance.length>0`)
    const actual = await browser.evaluate('window.htmlAcceptance.at(-1)')
    assert.equal(actual.visits, 1); assert.equal(actual.nativeStorage, true)
    assert.equal(actual.parentSentinel, 'private'); assert.equal(actual.session, 'native-session')
    assert.equal(actual.color, 'rgb(236, 238, 239)')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html').sandbox.value`), 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html-stage').dataset.channelState`), 'connected')
    await browser.evaluate('new Promise(resolve=>setTimeout(resolve,300))')
    const point = await browser.evaluate(`(()=>{const r=document.querySelector('.file-preview-html').getBoundingClientRect();return{x:r.x+120,y:r.y+80}})()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await browser.wait(`window.htmlAcceptance.at(-1)?.clicked==='INTERACTION_OK'`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.resourceState==='partial-failure'`)
    // Exercise author form submission to another HTTP origin through a child frame.
    // This requires both allow-forms and the response's form-action policy.
    await browser.evaluate(`document.querySelector('.file-preview-html').contentDocument.querySelector('form').requestSubmit()`)
    const formDeadline = Date.now() + 5000
    while (!submittedForm && Date.now() < formDeadline) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(submittedForm, 'value=native-form')
    const popup = await browser.send('Runtime.evaluate', { expression: `(()=>{const w=document.querySelector('.file-preview-html').contentWindow;const popup=w.open(${JSON.stringify(formOrigin)},'preview-popup');const opened=Boolean(popup);popup?.close();return opened})()`, returnByValue: true, userGesture: true })
    assert.equal(popup.result.value, true, 'trusted author scripts can open popups with user activation')
    const modal = browser.send('Runtime.evaluate', { expression: `document.querySelector('.file-preview-html').contentWindow.confirm('PREVIEW_MODAL')`, returnByValue: true, userGesture: true })
    // CDP keeps evaluate pending while the native modal is open.
    let accepted = false
    for (let attempt = 0; attempt < 40 && !accepted; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      accepted = await browser.send('Page.handleJavaScriptDialog', { accept: true }).then(() => true, () => false)
    }
    assert.equal(accepted, true, 'native confirm is available inside the preview')
    assert.equal((await modal).result.value, true)
    await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 })
    await browser.wait(`document.querySelector('input[aria-label="查找文件内容"]') !== null`)
    await browser.send('Page.bringToFront')
    await browser.click(`document.querySelector('input[aria-label="查找文件内容"]')`)
    await browser.send('Input.insertText', { text: 'Rendered HTML' })
    await browser.wait(`document.body.textContent.includes('共 1 处匹配')`)
    await browser.key('Escape')
    assert.equal(await browser.evaluate(`document.querySelector('.attachment-download') === null`), true)
    await browser.capture('/tmp/rovai-web-html-rendered.png')
    await browser.evaluate(`window.downloadBlobCount=0;window.originalObjectURL=URL.createObjectURL;URL.createObjectURL=function(...args){window.downloadBlobCount++;return window.originalObjectURL.apply(this,args)}`)
    const retainedTabId = await browser.evaluate(`document.querySelector('.file-preview-tab-activate').id`)
    await browser.click(`document.querySelector('.sidebar-settings-entry button')`)
    await browser.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent==='远程连接')`)
    await browser.click(`[...document.querySelectorAll('.remote-connection-page button')].find(e=>e.textContent==='退出登录')`)
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: service.administratorToken })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.web-login-overlay')===null`)
    await browser.click(`document.querySelector('.settings-sidebar-back')`)
    await browser.wait(`document.querySelector('.file-preview-tab-activate')?.id===${JSON.stringify(retainedTabId)} && document.querySelector('.file-download-action:not(:disabled)')!==null`)
    await browser.click(`document.querySelector('.file-download-action')`)
    await waitDownload('interactive.html', Buffer.byteLength(html))
    assert.equal(await readFile(join(downloadDirectory, 'interactive.html'), 'utf8'), html)
    assert.equal(await browser.evaluate('window.downloadBlobCount'), 0, 'native download must not create a full-file Blob')
    assert.equal(await browser.evaluate(`document.querySelector('.file-download-notice,.image-action-notice')===null`), true, 'successful download adds no visible toast')

    const toggleSource = async label => {
      await browser.click(`document.querySelector('.file-preview-view-switch [aria-label="${label}"]')`)
    }
    await toggleSource('查看源码')
    await browser.wait(`document.querySelector('.file-preview-code-mirror .cm-content')?.textContent.includes('Rendered HTML')`)
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-code-mirror .cm-content').textContent.includes('data-rovai-preview-diagnostic')`), false)
    await toggleSource('交互预览')
    assert.equal(await browser.evaluate(`window.htmlAcceptance.at(-1).clicked`), 'INTERACTION_OK', 'source toggle preserves iframe interaction state')
    await writeFile(`${stylesheet}.tmp`, 'body{background:rgb(210,220,230)}')
    await rename(`${stylesheet}.tmp`, stylesheet)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    const visitsBeforeRefresh = Number(await browser.evaluate(`localStorage.getItem('preview-visits')`))
    await browser.evaluate('window.previewReloadMarker=true')
    await browser.send('Page.reload')
    await browser.wait('window.previewReloadMarker!==true')
    await browser.wait(`document.querySelector('.web-login-overlay')===null && document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-login-overlay')===null`), true)
    // Composer drafts restore their exact attachment locator; file tabs may be
    // reopened explicitly without changing editor ownership or requiring Token.
    if (!await browser.evaluate(`document.querySelector('.file-preview-html')!==null`)) await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await browser.wait(`document.querySelector('.file-preview-html-stage')?.dataset.documentState==='loaded'`)
    await browser.wait(`window.htmlAcceptance.at(-1)?.color==='rgb(210, 220, 230)'`)
    assert.equal(Number(await browser.evaluate(`localStorage.getItem('preview-visits')`)), visitsBeforeRefresh + 1, 'native localStorage survives a page refresh at phone width')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html').contentWindow.sessionStorage.getItem('preview-session')`), 'native-session')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html-stage').dataset.channelState`), 'connected')
    assert.equal(await readFile(file, 'utf8'), html, 'preview never rewrites the original attachment')
    await browser.click(`document.querySelector('[aria-label="关闭 interactive.html"]')`)
    await browser.wait(`document.querySelector('.file-preview-html')===null`)
    // Open binary files first; their recovery viewer retains the source download.
    const binaryPath = join(fixture, 'unsupported.bin'); const binaryBytes = Buffer.from([0xff, 0, 1, 2, 3])
    await writeFile(binaryPath, binaryBytes)
    await browser.setFiles('.conversation-controls .composer-file-input', [binaryPath])
    await browser.wait(`document.querySelector('[aria-label="打开文件预览 unsupported.bin"]')!==null`)
    await browser.click(`document.querySelector('[aria-label="打开文件预览 unsupported.bin"]')`)
    await browser.wait(`document.querySelector('.file-preview-recovery')!==null`)
    // Reload creates a new URL global, so instrument this document too.
    await browser.evaluate(`window.downloadBlobCount=0;window.revokedPreviewBlobs=0;window.originalObjectUrl=URL.createObjectURL.bind(URL);window.originalRevokeUrl=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(...args)=>{window.downloadBlobCount++;return window.originalObjectUrl(...args)};URL.revokeObjectURL=(...args)=>{window.revokedPreviewBlobs++;return window.originalRevokeUrl(...args)}`)
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action:not(:disabled)')!==null`), true)
    const binaryTab = await browser.evaluate(`(()=>{const r=document.querySelector('.file-preview-tab-activate[aria-selected="true"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...binaryTab, button: 'right', clickCount: 1 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...binaryTab, button: 'right', clickCount: 1 })
    await browser.wait(`[...document.querySelectorAll('.file-preview-tab-menu button')].some(e=>e.textContent==='下载文件')`)
    await browser.click(`[...document.querySelectorAll('.file-preview-tab-menu button')].find(e=>e.textContent==='下载文件')`)
    await waitDownload('unsupported.bin', binaryBytes.length)
    assert.deepEqual(await readFile(join(downloadDirectory, 'unsupported.bin')), binaryBytes)
    assert.equal(await browser.evaluate('window.downloadBlobCount ?? 0'), 0)
    await browser.capture('/tmp/rovai-web-file-download-mobile.png')

    // Downloads use current bytes without refreshing the open preview. A missing
    // file still has one local error, hidden when its owning viewer is hidden.
    await browser.click(`document.querySelector('.mobile-icon-button[aria-label="返回对话"]')`)
    await browser.wait(`document.querySelector('.file-preview-retained-host:not([hidden])')===null`)
    await browser.click(`document.querySelector('[aria-label="打开文件预览 interactive.html"]')`)
    await browser.wait(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.dataset.documentState==='loaded'`)
    const uploadedHtml = join(uploadScratch, uploads[0], 'source')
    const currentHtml = html + '<!-- changed after preview -->'
    await writeFile(uploadedHtml, currentHtml)
    await rm(join(downloadDirectory, 'interactive.html'))
    await browser.click(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action')`)
    await waitDownload('interactive.html', Buffer.byteLength(currentHtml))
    assert.equal(await readFile(join(downloadDirectory, 'interactive.html'), 'utf8'), currentHtml)
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-html').contentDocument.documentElement.outerHTML.includes('changed after preview')`), false, 'download does not replace the visible preview')
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-notice')===null`), true)
    assert.equal(await browser.evaluate('window.downloadBlobCount ?? 0'), 0)
    await rename(uploadedHtml, uploadedHtml + '.held')
    await browser.click(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action:not(:disabled)')`)
    await browser.wait(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-notice')?.textContent.includes('源文件已不存在')`)
    const visibleDownloadErrors = `[...document.querySelectorAll('.file-download-notice')].filter(e=>e.getClientRects().length).length`
    assert.equal(await browser.evaluate(visibleDownloadErrors), 1)
    await browser.capture('/tmp/rovai-web-file-download-local-error.png')
    await browser.click(`document.querySelector('.file-preview-tab-activate[aria-label^="unsupported.bin"]')`)
    assert.equal(await browser.evaluate(visibleDownloadErrors), 0, 'A error must not cover B')
    await browser.click(`document.querySelector('.file-preview-tab-activate[aria-label^="interactive.html"]')`)
    await browser.click(`document.querySelector('.mobile-icon-button[aria-label="返回对话"]')`)
    await browser.wait(`document.querySelector('.file-preview-retained-host:not([hidden])')===null`)
    assert.equal(await browser.evaluate(visibleDownloadErrors), 0, 'folding the viewer must hide its feedback')
    await browser.click(`document.querySelector('[aria-label="打开文件预览 interactive.html"]')`)
    await browser.wait(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-notice')!==null`)
    await rename(uploadedHtml + '.held', uploadedHtml)
    await rm(join(downloadDirectory, 'interactive.html'))
    await browser.click(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action:not(:disabled)')`)
    await waitDownload('interactive.html', Buffer.byteLength(currentHtml))
    assert.equal(await readFile(join(downloadDirectory, 'interactive.html'), 'utf8'), currentHtml)
    assert.equal(await browser.evaluate(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-notice')===null`), true, 'retry recovers the local failure without refreshing or reopening')
    await browser.click(`document.querySelector('[aria-label="关闭 interactive.html"]')`)
    await browser.click(`document.querySelector('[aria-label="关闭 unsupported.bin"]')`)
    const oversizedPath = join(fixture, 'too-large.bin')
    const oversized = await open(oversizedPath, 'w'); await oversized.truncate(30 * 1024 * 1024 + 1); await oversized.close()
    const uploadsBeforeLimit = browser.responses.filter(response => response.path === '/api/v1/uploads').length
    await browser.click(`document.querySelector('#camp-message')`)
    await browser.send('Input.insertText', { text: '保留正文和其他附件' })
    await browser.setFiles('.conversation-controls .composer-file-input', [oversizedPath])
    await browser.wait(`document.querySelector('.attachment-error')?.textContent.includes('30 MiB')`)
    assert.equal(browser.responses.filter(response => response.path === '/api/v1/uploads').length, uploadsBeforeLimit)
    assert.equal(await browser.evaluate(`document.querySelector('#camp-message').textContent`), '保留正文和其他附件')
    assert.equal(await browser.evaluate(`document.querySelectorAll('.composer-attachment-card .attachment-open').length`), 2)
    await browser.click(`document.querySelector('[aria-label="移除失败附件 too-large.bin"]')`)
    const cancelledPath = join(fixture, 'cancel-and-retry.bin')
    await writeFile(cancelledPath, Buffer.alloc(2 * 1024 * 1024, 0x61))
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 128 * 1024 })
    await browser.setFiles('.conversation-controls .composer-file-input', [cancelledPath])
    await browser.wait(`document.querySelector('.web-upload-row progress')?.value > 0`)
    // The browser can report buffered upload progress before Host admission.
    await within((async () => { while ((await readdir(uploadScratch)).filter(name => name.startsWith('rovai-web-upload-')).length < 3) await new Promise(resolve => setTimeout(resolve, 50)) })())
    await browser.capture('/tmp/rovai-web-upload-progress-mobile.png')
    await browser.click(`[...document.querySelectorAll('.web-upload-actions button')].find(e=>e.textContent==='取消上传')`)
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await browser.wait(`!document.querySelector('.web-upload-status') || document.querySelector('.web-upload-status').textContent.includes('已取消')`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-offline-dialog')===null`), true, 'cancelling an upload does not block a healthy page')
    // Host may still be observing the aborted stream. Recheck the same receipt
    // until the admitted attempt settles; never manufacture a second intent.
    await within((async () => {
      while (await browser.evaluate(`document.querySelector('.web-upload-status') !== null && !document.querySelector('.web-upload-status').textContent.includes('原上传已确认')`)) {
        await browser.evaluate(`[...document.querySelectorAll('.web-upload-actions button')].find(e=>e.textContent==='核对结果')?.click()`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    })())
    await browser.click(`document.querySelector('[aria-label="移除失败附件 cancel-and-retry.bin"]')`)
    await browser.setFiles('.conversation-controls .composer-file-input', [cancelledPath])
    await browser.wait(`document.querySelector('[aria-label="打开文件预览 cancel-and-retry.bin"]')!==null`)
    assert.equal((await readdir(uploadScratch)).filter(name => name.startsWith('rovai-web-upload-')).length, 3, 'cancelled unbound bytes are cleaned before retry')
    const patchPath = join(fixture, 'changes.patch')
    await writeFile(patchPath, 'diff --git a/report.txt b/report.txt\n--- a/report.txt\n+++ b/report.txt\n@@ -1 +1 @@\n-before\n+after\n')
    await browser.setFiles('.conversation-controls .composer-file-input', [patchPath])
    await browser.wait(`document.querySelector('[aria-label="打开文件预览 changes.patch"]')!==null`)
    await browser.click(`document.querySelector('[aria-label="打开文件预览 changes.patch"]')`)
    await browser.wait(`document.querySelector('.file-preview-tab-panel:not([hidden])')?.textContent.includes('before')`)
    await browser.wait(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action:not(:disabled)')!==null`)
    await browser.click(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-download-action')`)
    const patchBytes = await readFile(patchPath)
    await waitDownload('changes.patch', patchBytes.length)
    assert.deepEqual(await readFile(join(downloadDirectory, 'changes.patch')), patchBytes, 'a real patch file remains downloadable')
    await browser.click(`document.querySelector('[aria-label="关闭 changes.patch"]')`)
    // Publish an image-shaped file without starting a Run. A failed image
    // decoder must leave the message attachment's source download accessible.
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    const author = await (await fetch(service.origin + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 7, administratorToken: service.administratorToken }) })).json()
    const imageIntent = { commandId: crypto.randomUUID(), threadId: created.payload.threadId, expectedRevision: 0, displayName: 'broken.png', byteSize: imageBytes.length, sha256: createHash('sha256').update(imageBytes).digest('hex') }
    const imageForm = new FormData(); imageForm.append('intent', JSON.stringify(imageIntent)); imageForm.append('file', new Blob([imageBytes]), 'broken.png')
    const imageUpload = await fetch(service.origin + '/api/v1/uploads', { method: 'POST', headers: { Authorization: `Bearer ${author.token}`, 'X-Rovai-Upload-Command-Id': imageIntent.commandId }, body: imageForm })
    assert.equal(imageUpload.status, 200)
    const imageSource = (await imageUpload.json()).draft
    const publication = await (await fetch(service.origin + '/api/v1/request', { method: 'POST', headers: { Authorization: `Bearer ${author.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'camp.messages.send', params: {
      commandId: crypto.randomUUID(), threadId: created.payload.threadId, content: { version: 2, segments: [{ kind: 'text', text: 'Image source download' }] }, sourceAttachments: [imageSource], quotes: [], replyToThreadMessageId: null, execution: null
    } }) })).json()
    assert.equal(publication.result.commandResult.status, 'applied')
    await browser.wait(`document.querySelector('.image-tile-placeholder')?.textContent==='暂不支持预览'`)
    assert.equal(await browser.evaluate(`document.querySelector('.image-gallery [aria-label^="下载"]') === null`), true)
    const imageBlobsBeforeOpen = await browser.evaluate('window.downloadBlobCount')
    await browser.click(`document.querySelector('.image-gallery .image-tile-preview')`)
    await browser.wait(`document.querySelector('.image-gallery-lightbox [aria-label="下载原图"]') !== null`)
    // Opening refreshes the preview once; wait for decode failure before measuring download allocations.
    await browser.wait(`document.querySelector('.image-lightbox-unavailable') !== null && window.downloadBlobCount > ${imageBlobsBeforeOpen} && window.revokedPreviewBlobs === window.downloadBlobCount`)
    const imageBlobsBeforeDownload = await browser.evaluate('window.downloadBlobCount')
    await browser.click(`document.querySelector('.image-gallery-lightbox [aria-label="下载原图"]')`)
    await waitDownload('broken.png', imageBytes.length)
    assert.deepEqual(await readFile(join(downloadDirectory, 'broken.png')), imageBytes)
    assert.equal(await browser.evaluate('window.downloadBlobCount'), imageBlobsBeforeDownload)
    assert.equal(await browser.evaluate(`document.querySelector('.image-lightbox-feedback,.image-action-notice')===null`), true)
    await browser.capture('/tmp/rovai-web-image-download-mobile.png')
    await browser.evaluate(`document.documentElement.dataset.theme='night'`)
    await browser.capture('/tmp/rovai-web-image-download-mobile-night.png')
    assert.deepEqual(browser.errors, [])
    console.log(JSON.stringify({ rendered: true, realClick: true, originalSource: true, nativeStorage: true, form: true, popup: true, modal: true, mobileWidth: true, relativeCss: true, replacementSave: true, refresh: true, released: true, nativeDownload: true, reauthenticatedPreviewDownload: true, imageDownload: true, uploadLimitAndCancel: true }))
  } catch (error) {
    if (browser) console.log(JSON.stringify(await browser.evaluate(`({samples:window.htmlAcceptance,search:document.querySelector('input[aria-label="查找文件内容"]')?.value,active:document.activeElement?.tagName,visibleText:document.body.innerText.slice(-800),frame:document.querySelector('.file-preview-html')?.getBoundingClientRect().toJSON()})`).catch(()=>null)))
    if (browser) await browser.capture('/tmp/rovai-web-html-failure.png').catch(() => {})
    throw error
  } finally {
    await browser?.close(); await host.close()
    await new Promise(resolve => formServer.close(resolve))
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})
