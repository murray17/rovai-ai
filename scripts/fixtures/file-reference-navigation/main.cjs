const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
const interactive = process.env.ROVAI_SHOW_FILE_REFERENCE_FIXTURE === '1'
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

// This fixture mounts the production Camp and file preview with a closed fake API.
// It never starts Core, SQLite, a Skill Library, or a Runtime.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux' || interactive, width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = async () => { await run('window.navigationTest.settle()'); return run('window.navigationTest.state()') }
  const closeTo = (value, expected, label) => assert.ok(Math.abs(value - expected) <= 2, `${label}: ${value}, expected ${expected}`)
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  const click = async selector => {
    const pointer = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getClientRects()[0]; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...pointer, button: 'left', clickCount: 1 })
    return state()
  }
  const selectText = async selector => {
    const points = await run(`(() => {
      window.getSelection().removeAllRanges();
      const node = document.querySelector(${JSON.stringify(selector)}).firstChild;
      const range = document.createRange();
      const end = Math.min(8, node.length);
      range.setStart(node, end > 1 ? 1 : 0); range.setEnd(node, end);
      const r = range.getClientRects()[0];
      return { left: Math.ceil(r.left), right: Math.floor(r.right), y: Math.round(r.top + r.height / 2) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', x: points.left, y: points.y, button: 'left', clickCount: 1, modifiers: ['alt'] })
    for (let step = 1; step <= 4; step += 1) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: points.left + Math.round((points.right - points.left) * step / 4),
        y: points.y, button: 'left', modifiers: ['alt', 'leftButtonDown'] })
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: points.right, y: points.y, button: 'left', clickCount: 1, modifiers: ['alt'] })
    await state()
    const selection = await run('window.getSelection().toString()')
    assert.ok(selection.length > 0, 'Native drag must leave selected text')
    return selection
  }
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    return state()
  }
  const viewport = async width => {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false })
    return state()
  }
  const drag = async delta => {
    const point = await run('(() => { const r = document.querySelector(".file-preview-resize-handle").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 80) } })()')
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 8; step += 1) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + Math.round(delta * step / 8), y: point.y,
        button: 'left', modifiers: ['leftButtonDown'] })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + delta, y: point.y, button: 'left', clickCount: 1 })
    return state()
  }
  const cases = []
  const measurements = {}
  const check = async (name, operation) => {
    try { await operation(); cases.push(name) } catch (error) {
      console.error(await state())
      await capture('failure')
      throw new Error(`${name}: ${error.message}`, { cause: error })
    }
  }
  await state()
  await check('an explicit Markdown location highlights the range and anchors a long message', async () => {
    await run('window.navigationTest.bookmark()')
    const before = await state()
    const after = await click('[title="run_report.py:44-46"]')
    assert.equal(after.visible, true)
    assert.ok(after.width < before.width)
    closeTo(after.linkY, before.linkY, 'Clicked link Y after reflow')
    measurements.openAnchorDrift = Math.abs(after.linkY - before.linkY)
    assert.deepEqual(after.targetLines, [44, 45, 46])
    assert.equal(after.targetVisible, true)
    assert.equal(after.opens.at(-1).rawReference, 'run_report.py:44-46')
    assert.equal(after.sameTimeline, true)
    assert.equal(after.sameLink, true)
    assert.equal(after.falseLinks, 0)
    assert.deepEqual(after.explicitReferenceTypes, [
      { title: 'src/report/run_report.py', type: 'code' },
      { title: '../outside/config.toml', type: 'config' },
      { title: 'run_report.py:44-46', type: 'code' },
      { title: 'src/report/run_report.py', type: 'code' },
      { title: 'src/report/run_report.py', type: 'code' }
    ])
    assert.equal(after.inlineFileLinkCount, 0)
    assert.ok(after.inertInlineCodes.includes('src/report/run_report.py'))
    assert.ok(after.inertInlineCodes.includes('config.toml'))
    assert.ok(after.inertInlineCodes.includes('demo.mp4'))
    assert.ok(after.inertInlineCodes.includes('/Users/name/Downloads/demo.html'))
    assert.ok(after.inertInlineCodes.includes('missing.toml'))
    assert.ok(after.inertInlineCodes.includes('run_gr_reminder.py'))
    assert.equal(after.webHref, 'https://github.com/')
    assert.equal(after.webText, '网页 · GitHub')
    assert.deepEqual(after.notices, [])
    await capture('range-day')
  })
  await check('close, reopen, and keyboard resizing preserve the clicked reading anchor', async () => {
    const before = await state()
    await run('window.navigationTest.trace()')
    closeTo((await click('#toggle-preview')).linkY, before.linkY, 'Close')
    closeTo((await click('#toggle-preview')).linkY, before.linkY, 'Reopen')
    await run('document.querySelector(".file-preview-resize-handle").focus({ preventScroll: true })')
    for (let index = 0; index < 6; index += 1) closeTo((await key('ArrowLeft')).linkY, before.linkY, 'Resize')
    closeTo((await drag(60)).linkY, before.linkY, 'Pointer resize')
    const traced = await state()
    assert.ok(traced.trace.length >= 10, 'Continuous layout must be sampled across frames')
    for (const y of traced.trace) closeTo(y, before.linkY, 'Continuous layout Y')
    measurements.continuousAnchorDrift = Math.max(...traced.trace.map(y => Math.abs(y - before.linkY)))
    measurements.continuousSamples = traced.trace.length
    assert.equal((await state()).draft, '保留原有草稿')
    assert.equal((await state()).overflow, false)
  })
  await check('normal history scrolling replaces the clicked anchor with the visible message', async () => {
    await run('window.navigationTest.scrollBy(220); window.navigationTest.rememberMessage()')
    const before = await state()
    const closed = await click('#toggle-preview')
    closeTo(closed.messageY, before.messageY, 'Visible message on close')
    closeTo((await click('#toggle-preview')).messageY, before.messageY, 'Visible message on reopen')
  })
  await check('following latest stays at the bottom through open, close, and width changes', async () => {
    await run('window.navigationTest.bottom()')
    closeTo((await state()).bottomGap, 0, 'Before')
    closeTo((await click('#toggle-preview')).bottomGap, 0, 'Close at bottom')
    closeTo((await click('#toggle-preview')).bottomGap, 0, 'Open at bottom')
    closeTo((await viewport(1600)).bottomGap, 0, 'Resize at bottom')
  })
  await check('night mode and compact return retain the same historical reading position', async () => {
    await run('window.navigationTest.theme("night"); window.navigationTest.bookmark()')
    await click('[title="run_report.py:44-46"]')
    const before = await state()
    await viewport(800)
    await click('#toggle-preview')
    await viewport(1600)
    closeTo((await state()).linkY, before.linkY, 'Return from compact preview')
    await click('[title="run_report.py:44-46"]')
    assert.equal((await state()).tabCount, 1)
    await capture('range-night')
  })
  const locatedLink = '[title="run_report.py:44-46"]'
  const plainLink = 'a[title="src/report/run_report.py"]'
  const nearbyProse = 'p:has([title="run_report.py:44-46"]) + p + p'
  for (const [label, selector, expectedReference] of [
    ['located Markdown', locatedLink, 'run_report.py:44-46'],
    ['plain Markdown', plainLink, 'src/report/run_report.py']
  ]) {
    await check(`${label} opens with an existing selection elsewhere in the message`, async () => {
      await run('window.navigationTest.bookmark()')
      const selection = await selectText(nearbyProse)
      const before = await state()
      const after = await click(selector)
      const cached = before.opens.some(request => request.rawReference === expectedReference)
      assert.equal(after.opens.length, before.opens.length + Number(!cached))
      if (!cached) assert.equal(after.opens.at(-1).rawReference, expectedReference)
      assert.equal(after.visible, true)
      assert.equal(await run('window.getSelection().toString()'), selection)
      assert.equal(await run('location.hash'), '')
      assert.deepEqual(after.notices, [])
    })
  }
  await check('dragging text inside a link does not open it, but a later single click does', async () => {
    const before = await state()
    await selectText(`${locatedLink} .file-reference-label`)
    assert.equal((await state()).opens.length, before.opens.length)
    await run('document.querySelector(".file-preview-code .cm-scroller").scrollTop = 0')
    const after = await click(locatedLink)
    assert.equal(after.opens.length, before.opens.length, 'Explicit navigation reuses cached content')
    assert.equal(after.targetVisible, true)
    assert.deepEqual(after.targetLines, [44, 45, 46])
  })
  await check('keyboard activation works while other message text is selected', async () => {
    await selectText(nearbyProse)
    await run(`document.querySelector(${JSON.stringify(locatedLink)}).focus({ preventScroll: true })`)
    await run('document.querySelector(".file-preview-code .cm-scroller").scrollTop = 0')
    const before = await state()
    const after = await key('Enter')
    assert.equal(after.opens.length, before.opens.length, 'Explicit navigation reuses cached content')
    assert.equal(after.targetVisible, true)
    assert.deepEqual(after.targetLines, [44, 45, 46])
    assert.equal(await run('location.hash'), '')
  })
  await check('an obsolete authorization result never opens a directory chooser or exposes its internal reason', async () => {
    const before = await state()
    const after = await click('[title="../outside/config.toml"]')
    assert.equal(after.opens.length, before.opens.length + 1)
    assert.equal(after.opens.at(-1).rawReference, '../outside/config.toml')
    assert.equal(after.chooseRootCalls, 0)
    assert.deepEqual(after.notices, before.notices)
    assert.equal(after.tabCount, before.tabCount + 1)
    assert.equal(after.draft, before.draft)
    assert.equal(await run(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-recovery p').textContent`), '无法打开文件')
    assert.equal(await run(`!!document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-recovery button')`), false)
    assert.equal(await run(`document.querySelector('.file-preview-pane').textContent.includes('内部目录授权原因')`), false)
    await capture('file-open-failure-zh')
    await run(`window.navigationTest.language('en')`)
    assert.equal(await run(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-recovery p').textContent`), 'Could not open file')
    await capture('file-open-failure-en')
    await run(`window.navigationTest.language('zh-CN')`)
    await click('[role=tab]:first-child')
    assert.equal((await state()).targetVisible, true)
  })
  await check('failed current-file preview leaves no duplicate error in the preserved Files Changed tab', async () => {
    const before = await state()
    await run('window.navigationTest.openChanges()')
    await run('window.retainedChangesReview = document.querySelector(".agent-run-file-review"); true')
    assert.equal((await state()).openCurrentError, null)
    const failed = await click('.agent-run-file-review-open-current')
    assert.equal(failed.tabCount, before.tabCount + 2)
    assert.deepEqual(failed.opens.at(-1), {
      kind: 'run_evidence', threadId: 'camp-file-navigation', agentRunId: 'run-current-file',
      executionEpoch: 1, evidenceFileId: 'missing-current', action: 'open_current'
    })
    assert.equal(await run(`document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-recovery p').textContent`), '无法打开文件')
    assert.equal(failed.openCurrentError, null, 'The inactive Files Changed tab must not retain a second error')
    assert.deepEqual(failed.notices, before.notices)
    const restored = await click('[role="tab"][aria-label="File Change·missing-current.ts"]')
    assert.equal(await run('window.retainedChangesReview === document.querySelector(".file-preview-tab-panel:not([hidden]) .agent-run-file-review")'), true)
    assert.equal(restored.openCurrentError, null)
    assert.equal(await run('document.querySelector(".agent-run-file-review-open-current").disabled'), false)
    await click('[aria-label="关闭 missing-current.ts"]')
    await click('[aria-label="关闭 File Change·missing-current.ts"]')
    await click('[role="tab"]:first-child')
    assert.equal((await state()).tabCount, before.tabCount)
  })
  await check('sanitized HTML keeps spacing beside visible text in both themes', async () => {
    for (const theme of ['day', 'night']) {
      await run(`window.navigationTest.theme('${theme}')`)
      await run('window.navigationTest.literalSpacingPreview()')
      const current = await state()
      assert.deepEqual(current.literalSpacing, [
        { text: '文前侧间距', start: '2px', end: '0px' },
        { text: '后侧间距文', start: '0px', end: '2px' }
      ])
      measurements.literalSpacing = current.literalSpacing
      await capture(`literal-spacing-${theme}`)
    }
  })
  await check('production agent messages keep long code and tables inside the conversation through preview resizing', async () => {
    await run('window.navigationTest.surface("wide-message")')
    await run('window.navigationTest.bookmark()')
    await click('[title="run_report.py:44-46"]')
    await run('window.navigationTest.bottom()')
    measurements.messageWidths = []
    for (const [theme, width] of [['day', 1799], ['day', 1800], ['day', 2560], ['night', 2560]]) {
      await run(`window.navigationTest.theme(${JSON.stringify(theme)})`)
      const initial = await viewport(width)
      assert.equal(initial.visible, true)
      assert.deepEqual(initial.overflows, [], `Open preview at ${width}px`)
      const narrow = await drag(Math.round(420 - initial.width))
      closeTo(narrow.width, 420, 'Dragged conversation width')
      assert.deepEqual(narrow.overflows, [], `Narrow conversation at ${width}px`)
      await capture(`message-${theme}-${width}-420px`)
      await run('window.navigationTest.scrollArtifacts()')
      const scrolled = await state()
      assert.deepEqual(scrolled.artifacts.map(item => item.tag), ['PRE', 'TABLE'])
      for (const artifact of scrolled.artifacts) {
        assert.equal(artifact.overflowX, 'auto')
        assert.ok(artifact.scrollWidth > artifact.width && artifact.scrollLeft > 0, `${artifact.tag} retains its own scroll`)
      }
      assert.equal(scrolled.timelineScrollLeft, 0)
      measurements.messageWidths.push({ theme, viewport: width, conversation: scrolled.width, artifacts: scrolled.artifacts })
      const closed = await click('#toggle-preview')
      assert.equal(closed.visible, false)
      assert.deepEqual(closed.overflows, [], 'Closing preview lets the message expand within the conversation')
      const reopened = await click('#toggle-preview')
      assert.equal(reopened.visible, true)
      assert.deepEqual(reopened.overflows, [], 'Reopening preview preserves the width constraint')
      assert.equal(reopened.draft, '保留原有草稿')
    }
    window.webContents.setZoomFactor(2)
    assert.deepEqual((await state()).overflows, [], 'Conversation at 200% zoom')
    window.webContents.setZoomFactor(1)
  })
  await check('recent conversations contain long titles while keeping time and status visible', async () => {
    await run('window.navigationTest.surface("home")')
    for (const theme of ['day', 'night']) {
      await run(`window.navigationTest.theme(${JSON.stringify(theme)})`)
      for (const width of [1040, 1440, 2560]) {
        const home = await viewport(width)
        assert.deepEqual(home.overflows, [], `${theme} recent conversations at ${width}px`)
        assert.equal(home.recentRows.length, 3)
        for (const [index, row] of home.recentRows.entries()) {
          assert.equal(row.fullTitle, row.title, 'The complete title remains available')
          assert.equal(row.truncated, index < 2, 'Only long titles need truncation')
          assert.equal(row.ellipsis, 'ellipsis')
          assert.equal(row.timeVisible, true)
          assert.equal(row.statusVisible, index < 2 ? true : null)
        }
        if (width === 1040) await capture(`recent-conversations-${theme}-1040px`)
      }
    }
    await viewport(1040)
    window.webContents.setZoomFactor(2)
    assert.deepEqual((await state()).overflows, [], 'Recent conversations at 200% zoom')
    window.webContents.setZoomFactor(1)
  })
  const report = { ok: true, cases, measurements }
  writeFileSync(join(dirname(userData), 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (interactive) {
    window.show()
    window.focus()
    app.focus({ steal: true })
  } else {
    app.exit(0)
  }
}).catch(error => { console.error(error); app.exit(1) })

app.on('window-all-closed', () => app.quit())
