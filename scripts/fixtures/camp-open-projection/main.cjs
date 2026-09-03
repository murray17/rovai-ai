const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
// Production CampWorkspace + adapter, with a closed draft/Skill API. No Core or daily data.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1200, height: 800, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', event => {
    if (event.level === 'warning' || event.level === 'error' || event.level >= 2) errors.push(event.message)
  })
  await window.loadFile(renderer)
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = async () => { await run('window.campOpenTest.settle()'); return run('window.campOpenTest.state()') }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  try {
    let current = await state()
    assert.equal(current.messages.length, 60, 'Earlier pages survive the initial bounded Open')
    assert.equal(current.timelineLength, 0)
    assert.equal(current.allEventSequencesNull, true)
    assert.deepEqual(current.cards, { task: 1, stop: 1, files: 1 })
    await run('window.campOpenTest.openTask()')
    current = await state()
    assert.ok(current.auditText.includes('业务状态原因'), 'Task business reasons remain available')
    assert.ok(!current.auditText.includes('审计原因'), 'No optional audit-event cause is inferred')
    await capture('business-cards')
    await run('window.campOpenTest.closeTask()')
    await state()
    await run('window.campOpenTest.bookmark()')
    const before = await state()
    assert.ok(before.scrollTop > 0 && before.bottomGap > 500, 'The fixture is reading older content')
    await run('window.campOpenTest.refresh(false)')
    const refreshed = await state()
    assert.deepEqual(refreshed.messages, before.messages, 'Refresh does not reorder or discard earlier messages')
    assert.equal(refreshed.sameAnchorNode, true)
    assert.ok(Math.abs(refreshed.anchorTop - before.anchorTop) <= 1, 'Refresh preserves the reading anchor')
    await run('window.campOpenTest.refresh(true)')
    const appended = await state()
    assert.deepEqual(appended.messages, [...before.messages, 'message-61'])
    assert.equal(appended.sameAnchorNode, true)
    assert.ok(Math.abs(appended.anchorTop - before.anchorTop) <= 1, 'A background message cannot steal the reading position')
    assert.deepEqual(appended.cards, before.cards)
    assert.equal(appended.allEventSequencesNull, true)
    await capture('refresh-day')
    await run("document.documentElement.dataset.theme = 'night'")
    await state()
    await capture('refresh-night')
    const acceptanceFile = JSON.parse(process.env.ROVAI_IMAGE_ACCEPTANCE_FILES ?? '[]')[0]
    if (acceptanceFile) assert.ok(isAbsolute(acceptanceFile.path))
    const result = acceptanceFile
      ? { displayName: acceptanceFile.displayName, mediaType: acceptanceFile.mediaType, data: readFileSync(acceptanceFile.path).toString('base64') }
      : { displayName: '宽幅图片.svg', mediaType: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="100%" height="100%" fill="#a0bdc6"/></svg>').toString('base64') }
    for (const [width, theme] of [[1040, 'day'], [1440, 'night'], [2560, 'day']]) {
      window.setContentSize(width, 900)
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      for (const count of [1, 2]) {
        await run(`window.campOpenTest.showImages(${JSON.stringify(result)}, ${count})`)
        // Compare the same interaction state: Linux's visible window may otherwise leave
        // the pointer over only one image after the fixture scrolls each gallery into view.
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
        const deadline = Date.now() + 5000
        let tool, sent
        while (Date.now() < deadline) {
          await run('window.campOpenTest.settle()')
          tool = await run('window.campOpenTest.imageAppearance("tool")')
          sent = await run('window.campOpenTest.imageAppearance("send")')
          if (tool.length === count && sent.length === count && [...tool, ...sent].every(image => image.decoded)) break
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        await capture(`images-${theme}-${width}-${count}`)
        assert.deepEqual(sent, tool, 'Tool and sent images must use the same layout and visual style in the real Camp')
        assert.ok([...tool, ...sent].every(image => image.extraText === ''), 'Images have no visible labels, filenames or actions')
      }
    }
    window.setContentSize(1200, 900)
    await run("document.documentElement.dataset.theme = 'day'")
    await run(`window.campOpenTest.showAttachmentSurfaces(${JSON.stringify(result)})`)
    const attachmentDeadline = Date.now() + 5000
    let attachmentState
    while (Date.now() < attachmentDeadline) {
      await run('window.campOpenTest.settle()')
      attachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
      if (attachmentState.agentFileCount === 10 && attachmentState.decodedImages === 5) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.deepEqual(attachmentState.order, {
      userImagesBeforeFiles: true,
      userFilesBeforeBody: true,
      agentBodyBeforeImages: true,
      agentImagesBeforeFiles: true
    })
    assert.deepEqual(attachmentState.userImage, { width: 72, height: 72 })
    assert.deepEqual(attachmentState.userFileHeights, [46, 46, 46])
    assert.equal(attachmentState.userFileDetails, 0)
    assert.equal(attachmentState.agentFileCount, 10)
    assert.equal(attachmentState.agentColumns, 2)
    assert.deepEqual(new Set(attachmentState.agentIconTypes), new Set([
      'type-web', 'type-code', 'type-notes', 'type-pdf', 'type-word', 'type-sheet',
      'type-slide', 'type-image', 'type-archive', 'type-generic'
    ]))
    assert.deepEqual(attachmentState.composerHeights, [48, 48, 48, 48, 48, 48])
    assert.deepEqual(attachmentState.composerImageWidths, [48, 48])
    assert.equal(attachmentState.composerOverflow, true)
    assert.equal(attachmentState.composerScrollbar, 'none')
    assert.equal(attachmentState.overflow, false)
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('ArrowRight')") > 0)
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('Home')") <= 2)
    const wheelResult = await run('window.campOpenTest.wheelComposerAttachments(120)')
    assert.ok(wheelResult.scrollLeft > 0)
    assert.equal(wheelResult.defaultPrevented, true)
    await run("window.campOpenTest.scrollAttachmentSurface('user')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-day-user-composer')
    await run("window.campOpenTest.scrollAttachmentSurface('agent')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-day-agent')
    await run("document.documentElement.dataset.theme = 'night'")
    await run('window.campOpenTest.settle()')
    await capture('attachments-night-agent')
    await run('window.campOpenTest.setAgentOutputWidth(520)')
    await run('window.campOpenTest.settle()')
    assert.equal((await run('window.campOpenTest.attachmentSurfaceState()')).agentColumns, 1)
    await capture('attachments-night-agent-narrow-output')
    await run('window.campOpenTest.setAgentOutputWidth(null)')
    await run("window.campOpenTest.scrollAttachmentSurface('user')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-night-user-composer')
    assert.deepEqual(errors, [], 'No React key, rendering or fixture API errors')
    console.log(JSON.stringify({ ok: true, messages: appended.messages.length,
      refreshAnchorDelta: refreshed.anchorTop - before.anchorTop,
      appendAnchorDelta: appended.anchorTop - before.anchorTop, cards: appended.cards }))
    window.destroy(); app.quit()
  } catch (error) {
    console.error(errors)
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
