const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
// Production Gallery/decoder with only in-memory content. No Core, Runtime, credentials, or network.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1040, height: 900, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code, true)
  const waitFor = async expression => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await run(expression)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`Fixture did not settle: ${expression}`)
  }
  const capture = async name => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await run('Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => undefined)))')
    writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  }
  try {
    await window.loadFile(renderer)
    await waitFor('window.imageGalleryTest?.state().decoded === 3 && window.imageGalleryTest.state().failed === 1')
    assert.equal(await run('window.imageGalleryTest.verifyDecoderFormats()'), true)
    let current = await run('window.imageGalleryTest.state()')
    assert.equal(current.columns, 2)
    assert.equal(current.overflow, false)
    assert.deepEqual(current.fit, ['contain', 'contain', 'contain'])
    await capture('gallery-day-wide')
    window.webContents.focus()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await waitFor('document.activeElement?.classList.contains("image-tile-preview")')
    assert.deepEqual(await run('(() => { const s=getComputedStyle(document.activeElement); return [s.outlineStyle,s.outlineWidth] })()'), ['solid','2px'])
    await capture('gallery-keyboard-focus')
    await run('document.querySelector(".image-tile-preview").focus(); document.querySelector(".image-tile-preview").click()')
    await waitFor('window.imageGalleryTest.state().dialog')
    await capture('gallery-lightbox')
    await run('document.querySelector(".attachment-lightbox-close").click()')
    await waitFor('!window.imageGalleryTest.state().dialog')
    assert.equal((await run('window.imageGalleryTest.state()')).active, '查看大图 登录态恢复检查.svg')
    await run('document.querySelector(".image-tile-menu").scrollIntoView({ block:"center" }); document.querySelector(".image-tile-menu").focus()')
    assert.deepEqual(await run('(() => { const s=getComputedStyle(document.activeElement); return [s.outlineStyle,s.outlineWidth] })()'), ['solid','2px'])
    await run('document.querySelector(".image-tile-menu").dispatchEvent(new PointerEvent("pointerdown", { bubbles:true, button:0, pointerType:"mouse" }))')
    await waitFor('Boolean(document.querySelector(".image-tile-menu-item"))')
    assert.equal(await run('getComputedStyle(document.querySelector(".image-tile-menu-item")).gridTemplateColumns.split(" ").length'), 1)
    await capture('gallery-attachment-menu')
    await run('document.querySelector(".image-tile-menu-item").click()')
    await waitFor('window.imageGalleryTest.calls.some(call=>call.open?.[1] === "attachment")')
    await run('document.querySelector(\'.image-tile-preview[aria-label^="使用系统应用打开"]\').scrollIntoView(); document.querySelector(\'.image-tile-preview[aria-label^="使用系统应用打开"]\').click()')
    await waitFor('window.imageGalleryTest.calls.some(call=>call.open?.[1] === "attachment-broken")')
    await run('scrollTo(0,0)')
    await run('document.documentElement.dataset.theme = "night"')
    await capture('gallery-night-wide')
    window.setContentSize(480, 900)
    await waitFor('window.imageGalleryTest.state().columns === 1')
    assert.equal((await run('window.imageGalleryTest.state()')).overflow, false)
    await capture('gallery-night-narrow')
    const acceptanceFiles = JSON.parse(process.env.ROVAI_IMAGE_ACCEPTANCE_FILES ?? '[]')
    for (const [index, file] of acceptanceFiles.entries()) {
      assert.ok(isAbsolute(file.path))
      const result = { displayName: file.displayName, mediaType: file.mediaType, data: readFileSync(file.path).toString('base64') }
      await run(`window.imageGalleryTest.showRuntimeResults(${JSON.stringify([result])})`)
      await waitFor(`document.querySelector('.image-tile-preview')?.getAttribute('aria-label') === ${JSON.stringify(`查看大图 ${file.displayName}`)}`)
      await waitFor('window.imageGalleryTest.state().decoded === 1 && window.imageGalleryTest.state().failed === 0')
      await run('document.querySelector(".image-tile-preview").click()')
      await waitFor('window.imageGalleryTest.state().dialog')
      await capture(`real-runtime-${index}`)
      await run('document.querySelector(".attachment-lightbox-close").click()')
      await waitFor('!window.imageGalleryTest.state().dialog')
    }
    console.log(JSON.stringify({ ok: true, realDecoder: true, realRuntimeResults: acceptanceFiles.length, runtimeReads: (await run('window.imageGalleryTest.calls')).length }))
    window.destroy()
    app.exit(0)
  } catch (error) {
    await capture('failure')
    console.error(error)
    window.destroy()
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
