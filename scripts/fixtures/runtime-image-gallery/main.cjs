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
  const assertFramesFitImages = current => {
    assert.equal(current.overflow, false)
    for (const frame of [...current.frames, ...current.lightboxFrames]) {
      const scale = Math.min(frame.width / frame.naturalWidth, frame.height / frame.naturalHeight)
      assert.ok(Math.abs(frame.width - frame.naturalWidth * scale) < 1
        && Math.abs(frame.height - frame.naturalHeight * scale) < 1,
      `Image frame must follow the image aspect ratio without letterboxing: ${JSON.stringify(frame)}`)
    }
    for (const frame of current.lightboxFrames) {
      const preview = current.frames.find(candidate => candidate.naturalWidth === frame.naturalWidth
        && candidate.naturalHeight === frame.naturalHeight)
      assert.ok(!preview || (frame.width >= preview.width - 1 && frame.height >= preview.height - 1),
        `Opening the lightbox must not shrink the image: ${JSON.stringify({ preview, frame })}`)
    }
  }
  const showImages = async results => {
    await run(`window.imageGalleryTest.showRuntimeResults(${JSON.stringify(results)})`)
    await waitFor(`document.querySelector('.image-tile-preview')?.getAttribute('aria-label') === ${JSON.stringify(`查看大图 ${results[0].displayName}`)}`)
    await waitFor(`window.imageGalleryTest.state().decoded === ${results.length} && window.imageGalleryTest.state().failed === 0`)
  }
  const imageResult = (width, height, label) => ({
    displayName: `${label}.svg`,
    mediaType: 'image/svg+xml',
    data: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#7897ae"/><text x="20" y="40">${label}</text></svg>`).toString('base64')
  })
  try {
    await window.loadFile(renderer)
    await waitFor('window.imageGalleryTest?.state().decoded === 3 && window.imageGalleryTest.state().failed === 2')
    assert.equal(await run('window.imageGalleryTest.verifyDecoderFormats()'), true)
    let current = await run('window.imageGalleryTest.state()')
    assert.equal(current.columns, 2)
    assert.equal(current.overflow, false)
    assert.deepEqual(current.fit, ['contain', 'contain', 'contain'])
    assert.equal(await run('document.querySelectorAll(".image-gallery-label, .image-tile figcaption, .image-tile-menu, .image-tile-projection").length'), 0)
    assert.equal(await run('[...document.querySelectorAll(".image-tile-preview:disabled")].length'), 2)
    await capture('gallery-day-wide')
    assertFramesFitImages(current)
    window.webContents.focus()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await waitFor('document.activeElement?.classList.contains("image-tile-preview")')
    assert.deepEqual(await run('(() => { const s=getComputedStyle(document.activeElement); return [s.outlineStyle,s.outlineWidth] })()'), ['solid','2px'])
    await capture('gallery-keyboard-focus')
    await run('document.querySelector(".image-tile-preview").focus(); document.querySelector(".image-tile-preview").click()')
    await waitFor('window.imageGalleryTest.state().dialog')
    await capture('gallery-lightbox')
    assertFramesFitImages(await run('window.imageGalleryTest.state()'))
    assert.equal(await run('getComputedStyle(document.querySelector(".image-gallery-lightbox h2")).clip'), 'rect(0px, 0px, 0px, 0px)')
    await run('document.querySelector(".attachment-lightbox-close").click()')
    await waitFor('!window.imageGalleryTest.state().dialog')
    assert.equal((await run('window.imageGalleryTest.state()')).active, '查看大图 登录态恢复检查.svg')
    await run('document.querySelectorAll(".image-gallery")[1].querySelector(".image-tile-preview").click()')
    await waitFor('window.imageGalleryTest.state().dialog')
    assertFramesFitImages(await run('window.imageGalleryTest.state()'))
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor('!window.imageGalleryTest.state().dialog')
    await waitFor('document.activeElement === document.querySelectorAll(".image-gallery")[1].querySelector(".image-tile-preview")')
    assert.equal(await run('document.activeElement === document.querySelectorAll(".image-gallery")[1].querySelector(".image-tile-preview")'), true)
    await run('scrollTo(0,0)')
    await run('document.documentElement.dataset.theme = "night"')
    await capture('gallery-night-wide')
    assertFramesFitImages(await run('window.imageGalleryTest.state()'))
    window.setContentSize(480, 900)
    await waitFor('window.imageGalleryTest.state().columns === 1')
    assert.equal((await run('window.imageGalleryTest.state()')).overflow, false)
    await capture('gallery-night-narrow')
    assertFramesFitImages(await run('window.imageGalleryTest.state()'))

    // Renderer-session cache owner: Blob payload is shared, every mounted Tile keeps its own URL.
    const attachmentResult = imageResult(720, 360, 'attachment-cache')
    await run(`window.imageGalleryTest.setScenarioResult('attachment', ${JSON.stringify(attachmentResult)})`)
    await run(`window.imageGalleryTest.showScenario('attachment', 'cache-attachment')`)
    await waitFor('window.imageGalleryTest.scenarioState().decoded === 1')
    const attachmentCold = await run('window.imageGalleryTest.scenarioState()')
    await run('window.imageGalleryTest.hideScenario()')
    await waitFor(`window.imageGalleryTest.revokedUrls.includes(${JSON.stringify(attachmentCold.src)})`)
    await run(`window.imageGalleryTest.setScenarioResult('attachment', 'throw')`)
    const attachmentWarm = await run(`window.imageGalleryTest.showScenario('attachment', 'cache-attachment')`)
    assert.equal(attachmentWarm.decoded, 1)
    assert.equal(attachmentWarm.loading, 0)
    await run('new Promise(resolve => setTimeout(resolve, 50))')
    assert.equal((await run('window.imageGalleryTest.scenarioState()')).attachmentReads, attachmentCold.attachmentReads)

    const runtimeOld = imageResult(720, 360, 'runtime-old')
    const runtimeNew = imageResult(360, 720, 'runtime-new')
    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(runtimeOld)})`)
    await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-success')`)
    await waitFor('window.imageGalleryTest.scenarioState().naturalWidth === 720')
    const runtimeCold = await run('window.imageGalleryTest.scenarioState()')
    await run('window.imageGalleryTest.hideScenario()')
    await waitFor(`window.imageGalleryTest.revokedUrls.includes(${JSON.stringify(runtimeCold.src)})`)
    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(runtimeNew)})`)
    const runtimeWarm = await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-success')`)
    assert.equal(runtimeWarm.decoded, 1)
    assert.equal(runtimeWarm.loading, 0)
    await waitFor(`window.imageGalleryTest.scenarioState().naturalWidth === 360
      && window.imageGalleryTest.scenarioState().src !== ${JSON.stringify(runtimeWarm.src)}`)
    const runtimeRefreshed = await run('window.imageGalleryTest.scenarioState()')
    assert.equal(runtimeRefreshed.runtimeReads, runtimeCold.runtimeReads + 1)
    await waitFor(`window.imageGalleryTest.revokedUrls.includes(${JSON.stringify(runtimeWarm.src)})`)

    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(runtimeOld)})`)
    await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-throw')`)
    await waitFor('window.imageGalleryTest.scenarioState().naturalWidth === 720')
    await run('window.imageGalleryTest.hideScenario()')
    await run(`window.imageGalleryTest.setScenarioResult('runtime', 'throw')`)
    const runtimeBeforeThrow = await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-throw')`)
    await run('new Promise(resolve => setTimeout(resolve, 50))')
    const runtimeAfterThrow = await run('window.imageGalleryTest.scenarioState()')
    assert.equal(runtimeBeforeThrow.loading, 0)
    assert.equal(runtimeAfterThrow.decoded, 1)
    assert.equal(runtimeAfterThrow.failed, 0)
    assert.equal(runtimeAfterThrow.src, runtimeBeforeThrow.src)

    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(runtimeOld)})`)
    await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-null')`)
    await waitFor('window.imageGalleryTest.scenarioState().naturalWidth === 720')
    await run('window.imageGalleryTest.hideScenario()')
    await run(`window.imageGalleryTest.setScenarioResult('runtime', null)`)
    const runtimeBeforeNull = await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-null')`)
    assert.equal(runtimeBeforeNull.loading, 0)
    await waitFor('window.imageGalleryTest.scenarioState().failed === 1 && window.imageGalleryTest.scenarioState().decoded === 0')

    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(runtimeOld)})`)
    await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-broken')`)
    await waitFor('window.imageGalleryTest.scenarioState().naturalWidth === 720')
    await run('window.imageGalleryTest.hideScenario()')
    const invalidImage = { mediaType: 'image/svg+xml', data: Buffer.from('not an image').toString('base64') }
    await run(`window.imageGalleryTest.setScenarioResult('runtime', ${JSON.stringify(invalidImage)})`)
    const runtimeBeforeBroken = await run(`window.imageGalleryTest.showScenario('runtime', 'cache-runtime-broken')`)
    assert.equal(runtimeBeforeBroken.loading, 0)
    await waitFor('window.imageGalleryTest.scenarioState().failed === 1 && window.imageGalleryTest.scenarioState().decoded === 0')

    // Geometry owner: square / portrait / wide / small media in both layouts and themes.
    for (const [width, theme] of [[1040, 'day'], [480, 'night']]) {
      window.setContentSize(width, 900)
      await waitFor(`innerWidth === ${width}`)
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      for (const [name, imageWidth, imageHeight] of [['square', 768, 768], ['portrait', 720, 1440], ['wide', 1600, 400], ['small', 96, 64]]) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}"><rect width="100%" height="100%" fill="#a0bdc6"/></svg>`
        const result = { displayName: `${name}-${theme}.svg`, mediaType: 'image/svg+xml', data: Buffer.from(svg).toString('base64') }
        await showImages([result])
        assertFramesFitImages(await run('window.imageGalleryTest.state()'))
        await run('document.querySelector(".image-tile-preview").click()')
        await waitFor('window.imageGalleryTest.state().dialog')
        assertFramesFitImages(await run('window.imageGalleryTest.state()'))
        await run('document.querySelector(".attachment-lightbox-close").click()')
        await waitFor('!window.imageGalleryTest.state().dialog')
        await showImages([result, { ...result, displayName: `second-${result.displayName}` }])
        assertFramesFitImages(await run('window.imageGalleryTest.state()'))
      }
    }
    const acceptanceFiles = JSON.parse(process.env.ROVAI_IMAGE_ACCEPTANCE_FILES ?? '[]')
    for (const [index, file] of acceptanceFiles.entries()) {
      assert.ok(isAbsolute(file.path))
      const result = { displayName: file.displayName, mediaType: file.mediaType, data: readFileSync(file.path).toString('base64') }
      for (const [width, theme] of [[1040, 'day'], [480, 'night']]) {
        window.setContentSize(width, 900)
        await waitFor(`innerWidth === ${width}`)
        await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
        await showImages([result])
        await capture(`real-runtime-${index}-${theme}`)
        assertFramesFitImages(await run('window.imageGalleryTest.state()'))
        await run('document.querySelector(".image-tile-preview").click()')
        await waitFor('window.imageGalleryTest.state().dialog')
        await capture(`real-runtime-${index}-${theme}-lightbox`)
        assertFramesFitImages(await run('window.imageGalleryTest.state()'))
        await run('document.querySelector(".attachment-lightbox-close").click()')
        await waitFor('!window.imageGalleryTest.state().dialog')
      }
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
