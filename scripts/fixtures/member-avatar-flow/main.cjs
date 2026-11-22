const assert = require('node:assert/strict')
const { mkdir, writeFile, readFile, readdir } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createInterface } = require('node:readline')
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const [renderer, userData, coreBinary, sourceFile] = process.argv.slice(2)
const root = resolve(__dirname, '../../..')
const dataDir = join(userData, 'core')
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
let core, window
const calls = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const { launchHost } = await import(pathToFileURL(join(root, 'scripts/lib/host-test-client.mjs')).href)
  const { coreDataDirectoryArguments } = await import(pathToFileURL(join(root, 'scripts/lib/runtime-camp-files-root.mjs')).href)
  await mkdir(dataDir, { recursive: true })
  console.log(`Automatic acceptance Core: ${coreBinary}; userData: ${userData}; Skill Library: ${join(dataDir, 'skills')}; MCP: ${join(dataDir, 'mcp.json')}`)
  core = launchHost(coreBinary, [...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'),
    '--mcp-config-path', join(dataDir, 'mcp.json')])
  createInterface({ input: core.child.stdout }).on('line', line => {
    const frame = JSON.parse(line)
    if (frame.kind === 'core_startup' && frame.error) console.error(frame.error)
  })
  await core.ready
  ipcMain.handle('avatar-fixture:request', async (_, method, params) => {
    assert.ok(['memberAvatars.read', 'memberAvatars.save'].includes(method))
    const result = await core.request(method, params)
    calls.push({ method, kind: params.kind, crop: params.crop, avatarRef: params.avatarRef })
    return result
  })
  window = new BrowserWindow({ width: 1000, height: 1000, show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.on('console-message', (_, details) => {
    if (details.level === 'error') console.error(details.message)
  })
  const run = expression => window.webContents.executeJavaScript(expression)
  const waitFor = async expression => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) { if (await run(expression)) return; await delay(50) }
    throw new Error(`Timed out: ${expression}; ${await run('document.body.innerText')}`)
  }
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const cropReady = "Boolean(document.querySelector('.avatar-crop-stage img')?.naturalWidth) && !document.querySelector('.avatar-cut-dialog .app-dialog-footer .member-editor-primary').disabled"
  await window.loadFile(renderer)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
  await waitFor("Boolean(document.querySelector('.avatar-picker-upload'))")
  await run("window.uploadStatus = document.querySelector('.avatar-picker-dialog [role=status]')")
  assert.equal(await run('window.uploadStatus?.textContent'), '', 'The upload status is mounted before processing')
  await click('.avatar-picker-upload')
  await waitFor("window.uploadStatus.textContent === '正在处理头像…'")
  assert.equal(await run("window.uploadStatus.closest('[aria-busy=true]')"), null, 'The live region is outside busy controls')
  assert.equal(await run("document.querySelector('.avatar-picker-upload').textContent.trim()"), '上传头像', 'The action retains its name')
  const { root: documentNode } = await window.webContents.debugger.sendCommand('DOM.getDocument')
  const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode.nodeId, selector: 'input[type="file"]' })
  await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [sourceFile] })
  await waitFor(cropReady)
  const initialUrl = await run("document.querySelector('.avatar-crop-stage img').src")
  const initialTransform = await run("document.querySelector('.avatar-crop-stage img').style.transform")
  await run("document.querySelector('.avatar-crop-stage').focus()")
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await waitFor(`document.querySelector('.avatar-crop-stage img').style.transform !== ${JSON.stringify(initialTransform)}`)
  assert.equal(await run("document.querySelector('.avatar-crop-stage img').src"), initialUrl,
    'Moving the crop retains the animation URL')
  const center = await run("(() => { const r = document.querySelector('.avatar-crop-stage').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), width: 1, height: 1 } })()")
  const displayed = new Set()
  for (let i = 0; i < 8; i++) {
    const pixel = (await window.webContents.capturePage(center)).getBitmap()
    displayed.add(pixel.subarray(0, 3).toString('hex'))
    await delay(100)
  }
  assert.ok(displayed.size >= 2, 'The actual crop preview renders multiple GIF frames')
  await click('.avatar-cut-dialog .app-dialog-footer .member-editor-primary')
  await waitFor("Boolean(document.querySelector('[data-avatar-ref]').textContent) && !document.querySelector('.avatar-picker-dialog')")
  const firstRef = await run("document.querySelector('[data-avatar-ref]').textContent")
  const portrait = await core.request('memberAvatars.read', { avatarRef: firstRef, rendition: 'portrait' })
  assert.equal(portrait.mediaType, 'image/gif')
  assert.deepEqual([portrait.width, portrait.height], [768, 256])
  assert.equal(Buffer.from(portrait.base64, 'base64').subarray(0, 6).toString(), 'GIF89a')
  assert.deepEqual((await readdir(join(dataDir, 'member-avatars', firstRef.split('/').at(-1)))).sort(), ['manifest.json', 'source.gif'])
  assert.deepEqual(Buffer.from(portrait.base64, 'base64'), await readFile(sourceFile), 'new GIF must not be re-encoded')
  assert.ok(portrait.displayCrop)
  await click('[data-reopen]')
  await waitFor("Boolean(document.querySelector('.avatar-picker-upload'))")
  assert.equal(await run("!!document.querySelector('.avatar-crop-stage')"), false, 'Changing an avatar starts with selection, not old-source recropping')
  assert.equal(await run("document.querySelector('.avatar-picker-preset-toggle').getAttribute('aria-expanded')"), 'false')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor("!document.querySelector('.avatar-picker-dialog')")
  assert.equal(await run("document.querySelector('[data-avatar-ref]').textContent"), firstRef)
  await click('[data-reopen]')
  await waitFor("Boolean(document.querySelector('.avatar-picker-upload'))")
  await click('.avatar-picker-upload')
  const { root: secondDocument } = await window.webContents.debugger.sendCommand('DOM.getDocument')
  const { nodeId: secondInput } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: secondDocument.nodeId, selector: 'input[type="file"]' })
  await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: secondInput, files: [sourceFile] })
  await waitFor(cropReady)
  await run("document.querySelector('.avatar-crop-stage').focus()")
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' })
  await delay(100)
  await click('.avatar-cut-dialog .app-dialog-footer .member-editor-primary')
  await waitFor("!document.querySelector('.avatar-picker-dialog')")
  assert.deepEqual(calls.filter(call => call.method === 'memberAvatars.save').map(call => call.kind), ['image', 'image'])
  const secondRef = await run("document.querySelector('[data-avatar-ref]').textContent")
  assert.notEqual(secondRef, firstRef, 'A changed crop produces its own content-addressed avatar')
  await window.loadFile(renderer)
  await waitFor("Boolean(document.querySelector('.member-avatar img')?.naturalWidth)")
  assert.equal(await run("document.querySelector('[data-avatar-ref]').textContent"), secondRef)
  const display = await run("(() => { const img = document.querySelector('.member-avatar img'); return { width: img.naturalWidth, crop: img.style.left } })()")
  assert.equal(display.width, 768)
  assert.ok(display.crop, 'Reloaded avatar applies the persisted geometry')
  const icon = await core.request('memberAvatars.read', { avatarRef: secondRef, rendition: 'icon' })
  assert.equal(icon.mediaType, 'image/gif')
  const cover = await core.request('memberAvatars.read', { avatarRef: secondRef, rendition: 'icon', staticPng: true })
  assert.equal(cover.mediaType, 'image/png')
  assert.deepEqual([cover.width, cover.height], [192, 192])
  const firstPixel = nativeImage.createFromBuffer(Buffer.from(cover.base64, 'base64')).getBitmap().subarray(0, 4)
  assert.deepEqual([...firstPixel], [0, 0, 255, 255], 'Channel cover uses the first complete red frame')
  const large = await core.request('memberAvatars.read', { avatarRef: secondRef, rendition: 'icon', staticPng: true, targetEdge: 240 })
  assert.deepEqual([large.width, large.height], [240, 240])
  let budget = null
  if (process.env.ROVAI_AVATAR_STRESS_GIF) {
    const bytes = await readFile(process.env.ROVAI_AVATAR_STRESS_GIF)
    const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8)
    const refs = [], renditions = {}
    for (let index = 0; index < 12; index++) {
      const saved = await core.request('memberAvatars.save', { kind: 'image', sourceBase64: bytes.toString('base64'),
        sourceWidth: width, sourceHeight: height, crop: { centerX: .4 + index / 100, centerY: .5, size: .75 } })
      refs.push(saved.avatarRef)
      renditions[saved.avatarRef] = await core.request('memberAvatars.read', { avatarRef: saved.avatarRef, rendition: 'icon' })
    }
    const loadStarted = Date.now()
    await run(`window.showAvatarStress(${JSON.stringify(refs)})`)
    await waitFor("document.querySelectorAll('[data-stress] img').length === 12 && [...document.querySelectorAll('[data-stress] img')].every(img => img.naturalWidth)")
    const loadedMs = Date.now() - loadStarted
    const { measureAvatarBudget } = await import(pathToFileURL(join(root, 'scripts/lib/avatar-render-budget.mjs')).href)
    budget = await measureAvatarBudget(run, async () => (await window.webContents.capturePage()).toPNG().toString('base64'))
    budget.loadedMs = loadedMs
    budget.processMemory = app.getAppMetrics().filter(metric => metric.type === 'Tab').map(metric => metric.memory)
    assert.equal(budget.animated, 12)
    await writeFile(join(userData, 'stress-seed.json'), JSON.stringify({ refs, renditions }))
    await writeFile(join(userData, 'stress-electron.json'), JSON.stringify(budget, null, 2))
    await writeFile(join(userData, 'stress-electron.png'), (await window.webContents.capturePage()).toPNG())
  }
  console.log(JSON.stringify({ ok: true, budget, cases: ['animated upload and crop preview', 'stable Blob URL during adjustment',
    'single-file 768×256 GIF remains intact', 'save/reopen/reupload through Core', 'renderer reload', 'single animated file and on-demand PNG at channel size'] }))
}).catch(async error => {
  process.exitCode = 1
  console.error(error)
  try {
    if (window && !window.isDestroyed()) await writeFile(join(userData, 'failure.png'), (await window.webContents.capturePage()).toPNG())
  } catch (captureError) { console.error('Failure screenshot unavailable:', captureError) }
}).finally(async () => {
  if (core) await core.close()
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(process.exitCode ?? 0)
})
