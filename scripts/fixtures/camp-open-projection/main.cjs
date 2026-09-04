const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, mode] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
const attachmentReview = mode === '--attachment-review'
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
// Production CampWorkspace + adapter, with a closed draft/Skill API. No Core or daily data.
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: attachmentReview || process.platform === 'linux',
    width: attachmentReview ? 1440 : 1200,
    height: attachmentReview ? 920 : 800,
    useContentSize: true,
    title: attachmentReview ? 'Rovai AI · 附件呈现 Mock Camp' : 'CampOpen refresh acceptance fixture',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', event => {
    if (event.level === 'warning' || event.level === 'error' || event.level >= 2) errors.push(event.message)
  })
  await window.loadFile(renderer, attachmentReview ? { query: { review: 'attachments' } } : undefined)
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = async () => { await run('window.campOpenTest.settle()'); return run('window.campOpenTest.state()') }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  try {
    if (attachmentReview) {
      await run(`window.campOpenTest.setComposerText(${JSON.stringify('请按交互稿核对附件尺寸、顺序、图标和视觉层级。')})`)
      await run("window.campOpenTest.scrollAttachmentSurface('agent')")
      const deadline = Date.now() + 5000
      let attachmentState
      while (Date.now() < deadline) {
        await run('window.campOpenTest.settle()')
        attachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
        if (attachmentState.userImageCount === 3 && attachmentState.agentImageCount === 3
          && attachmentState.composerImageCount === 3 && attachmentState.decodedImages === 6) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      await run("window.campOpenTest.scrollAttachmentSurface('user')")
      const userImageDeadline = Date.now() + 5000
      while (Date.now() < userImageDeadline) {
        await run('window.campOpenTest.settle()')
        attachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
        if (attachmentState.decodedImages === 6) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.equal(attachmentState.decodedImages, 6, 'All user and agent review images are decoded')
      await capture('attachment-review-ready')
      console.log(JSON.stringify({ reviewReady: true, userData, attachmentState }))
      return
    }
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
    await run('window.campOpenTest.prepareHistoryLoad()')
    await state()
    await run('window.campOpenTest.bookmark()')
    const beforeHistoryLoad = await state()
    await run('window.campOpenTest.loadEarlier()')
    const afterHistoryLoad = await state()
    assert.equal(afterHistoryLoad.messages.length, 61)
    assert.equal(afterHistoryLoad.sameAnchorNode, true)
    const historyLoadAnchorDelta = afterHistoryLoad.anchorTop - beforeHistoryLoad.anchorTop
    assert.ok(Math.abs(historyLoadAnchorDelta) <= 1,
      `Loading earlier messages cannot count a concurrent append as prepended height (${historyLoadAnchorDelta}px)`)
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
    await run(`window.campOpenTest.setComposerText(${JSON.stringify('请按交互稿核对附件尺寸、顺序、图标和视觉层级。')})`)
    const attachmentDeadline = Date.now() + 5000
    let attachmentState
    while (Date.now() < attachmentDeadline) {
      await run('window.campOpenTest.settle()')
      attachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
      if (attachmentState.agentFileCount === 10
        && attachmentState.userImageCount === 3
        && attachmentState.agentImageCount === 3
        && attachmentState.composerImageCount === 3
        && attachmentState.decodedImages === 6) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.deepEqual(attachmentState.order, {
      userImagesBeforeFiles: true,
      userFilesBeforeBody: true,
      agentBodyBeforeImages: true,
      agentImagesBeforeFiles: true
    })
    assert.deepEqual(attachmentState.userImage, { width: 72, height: 72 })
    assert.equal(attachmentState.userImageCount, 3)
    assert.equal(attachmentState.agentImageCount, 3)
    assert.equal(attachmentState.composerImageCount, 3)
    assert.equal(attachmentState.userFileCount, 6)
    assert.deepEqual(attachmentState.userFileHeights, [46, 46, 46, 46, 46, 46])
    assert.ok(attachmentState.userFileWidths.every(width => width <= 296))
    assert.ok(new Set(attachmentState.userFileWidths).size > 1, 'User files use content-sized widths')
    assert.equal(attachmentState.userFileDetails, 0)
    assert.equal(attachmentState.agentFileCount, 10)
    assert.ok(attachmentState.agentOutputWidth > 650, 'Agent deliveries use the full artifact track')
    assert.ok(attachmentState.agentHeadingGap >= 6 && attachmentState.agentHeadingGap <= 9,
      'Delivery count remains beside its heading')
    assert.equal(attachmentState.agentOpenCueDisplay, 'grid')
    assert.equal(attachmentState.agentColumns, 2)
    assert.deepEqual(new Set(attachmentState.agentIconTypes), new Set([
      'type-web', 'type-code', 'type-notes', 'type-pdf', 'type-word', 'type-sheet',
      'type-slide', 'type-image', 'type-archive', 'type-generic'
    ]))
    assert.deepEqual(attachmentState.composerHeights, [48, 48, 48, 48, 48, 48, 48, 48, 48])
    assert.deepEqual(attachmentState.composerImageWidths, [48, 48, 48])
    assert.ok(attachmentState.composerFileWidths.every(width => width >= 172 && width <= 308))
    assert.ok(attachmentState.composerFileWidths.some(width => width !== 208),
      'Composer files no longer use the old fixed width')
    assert.equal(attachmentState.composerText, '请按交互稿核对附件尺寸、顺序、图标和视觉层级。')
    assert.equal(attachmentState.composerOverflow, true)
    assert.equal(attachmentState.composerScrollbar, 'none')
    assert.equal(attachmentState.overflow, false)
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('ArrowRight')") > 0)
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('Home')") <= 2)
    const wheelResult = await run('window.campOpenTest.wheelComposerAttachments(120)')
    assert.ok(wheelResult.scrollLeft > 0)
    assert.equal(wheelResult.defaultPrevented, true)
    await run("window.campOpenTest.browseComposerAttachments('Home')")
    await run("window.campOpenTest.scrollAttachmentSurface('user')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-day-user-composer')
    await run("window.campOpenTest.scrollAttachmentSurface('agent')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-day-agent')
    await run("document.documentElement.dataset.theme = 'night'")
    await run('window.campOpenTest.settle()')
    await new Promise(resolve => setTimeout(resolve, 160))
    const nightAttachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
    assert.equal(nightAttachmentState.theme, 'night')
    assert.equal(nightAttachmentState.agentCardBackground, 'rgb(27, 34, 39)')
    await capture('attachments-night-agent')
    await run('window.campOpenTest.setAgentOutputWidth(520)')
    await run('window.campOpenTest.settle()')
    assert.equal((await run('window.campOpenTest.attachmentSurfaceState()')).agentColumns, 1)
    await capture('attachments-night-agent-narrow-output')
    await run('window.campOpenTest.setAgentOutputWidth(null)')
    await run("window.campOpenTest.scrollAttachmentSurface('user')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-night-user-composer')
    window.webContents.setZoomFactor(2)
    await run('window.campOpenTest.settle()')
    const zoomedAttachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
    assert.equal(zoomedAttachmentState.overflow, false, 'Attachment surfaces do not overflow at 200% zoom')
    assert.equal(zoomedAttachmentState.agentColumns, 1, 'Agent files collapse to one column at 200% zoom')
    await capture('attachments-night-200-percent')
    window.webContents.setZoomFactor(1)
    assert.deepEqual(errors, [], 'No React key, rendering or fixture API errors')
    console.log(JSON.stringify({ ok: true, messages: appended.messages.length,
      refreshAnchorDelta: refreshed.anchorTop - before.anchorTop,
      appendAnchorDelta: appended.anchorTop - before.anchorTop,
      historyLoadAnchorDelta,
      cards: appended.cards }))
    window.destroy(); app.quit()
  } catch (error) {
    console.error(errors)
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
