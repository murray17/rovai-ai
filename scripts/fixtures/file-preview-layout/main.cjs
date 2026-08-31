const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData), 'The preview fixture requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

// Only the production Renderer runs here. The closed API fixture never starts
// Core, SQLite, a Skill Library, a Runtime, or any daily App/data connection.
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  const run = (code) => window.webContents.executeJavaScript(code, true)
  const snapshot = async () => {
    await run('window.previewTest.settle()')
    return run('window.previewTest.snapshot()')
  }
  const open = async () => { await run('window.previewTest.open()'); return snapshot() }
  const conversationSnapshot = async () => { await snapshot(); return run('window.previewTest.conversationSnapshot()') }
  const closeTo = (value, expected, message) => assert.ok(Math.abs(value - expected) < 1, `${message}: ${value}, expected ${expected}`)
  const cases = []
  const check = async (name, operation) => {
    try { await operation(); cases.push(name) } catch (error) {
      console.error(await run('JSON.stringify({ state: window.previewTest.snapshot(), conversation: window.previewTest.conversationSnapshot(), pointerEvents: window.previewTest.pointerEvents })'))
      writeFileSync(join(dirname(userData), 'failure.png'), (await window.webContents.capturePage()).toPNG())
      throw new Error(`${name}: ${error.message}`, { cause: error })
    }
  }
  window.webContents.debugger.attach('1.3')
  const viewport = async (width, height = 920) => {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    })
    return snapshot()
  }
  let pointer
  let mousePressed = false
  const mouse = (type, clickCount = 1) => {
    if (type === 'mouseDown') mousePressed = true
    if (type === 'mouseUp') mousePressed = false
    window.webContents.sendInputEvent({
      type, ...pointer, button: 'left', clickCount, modifiers: mousePressed ? ['leftButtonDown'] : []
    })
  }
  const begin = async () => {
    const state = await snapshot()
    assert.ok(state.handle, 'The split separator must be available')
    pointer = { x: state.handle.x, y: state.handle.y }
    mouse('mouseMove')
    mouse('mouseDown')
    await snapshot()
    return state
  }
  const drag = async (requestedWidth) => {
    const state = await begin()
    pointer.x += Math.round(state.width - requestedWidth)
    mouse('mouseMove')
    return snapshot()
  }
  const release = async () => { mouse('mouseUp'); return snapshot() }
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    return snapshot()
  }
  const reset = async () => {
    await begin()
    await release()
    mouse('mouseDown', 2)
    mouse('mouseUp', 2)
    return snapshot()
  }
  const capture = async (name, clip) => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage(clip)).toPNG())
  const click = async (selector) => {
    await run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest', inline: 'nearest' })`)
    await snapshot()
    pointer = await run(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } })()`)
    mouse('mouseMove')
    await snapshot()
    mouse('mouseDown')
    mouse('mouseUp')
    return snapshot()
  }
  const reviewSnapshot = async () => { await snapshot(); return run('window.previewTest.reviewSnapshot()') }

  await viewport(1440)
  await check('the persistent preview toggle opens an empty reading plane and closes without saving a new ratio', async () => {
    const initial = await reviewSnapshot()
    assert.equal(initial.toggleVisible, true)
    assert.equal(initial.separatorVisible, true)
    assert.equal(initial.toggleExpanded, 'false')
    const opened = await click('.file-preview-toggle')
    assert.equal(opened.visible, true)
    assert.equal(opened.tabCount, 0, 'An empty preview is not a fake file tab')
    const empty = await reviewSnapshot()
    assert.equal(empty.emptyVisible, true)
    assert.equal(empty.headerDrag, 'drag')
    assert.equal(empty.toggleNoDrag, true)
    assert.ok(empty.dragSpace >= 24, 'The toggle leaves a blank native window drag target')
    assert.equal(empty.fileOpens.length, 0)
    await capture('preview-empty')
    assert.equal((await click('.file-preview-toggle')).visible, false)
    assert.equal((await snapshot()).stored, null)
  })

  await check('44/56 default shares the header/body boundary and keeps the complete workspace', async () => {
    const state = await open()
    closeTo(state.available, 1170, 'Workspace excludes the navigation rail')
    closeTo(state.width, state.available * .56, 'Default preview ratio')
    assert.equal(state.aligned, true)
    assert.equal(state.overflow, false)
    assert.equal(state.stored, null, 'Opening must not persist a clamped ratio')
    assert.equal(state.handle.width, 9)
    assert.equal(state.lineWidth, '1px')
    assert.deepEqual(state.aria, { min: '420', max: '750', now: '655' })
    await capture('preview-day-1440x920')
  })

  await check('dragging left protects the conversation minimum and commits only on release', async () => {
    const moving = await drag(1_000)
    closeTo(moving.conversation, 420, 'Conversation minimum')
    assert.equal(moving.lineWidth, '3px')
    assert.match(moving.hint, /420px/)
    assert.equal(moving.aligned, true)
    assert.equal(moving.stored, null)
    const done = await release()
    closeTo(Number(done.stored) * done.available, 750, 'Committed preview width')
    assert.equal(done.resizing, false)
    await reset()
  })

  await check('320–420px follows the pointer then rebounds; exactly 320px does not close', async () => {
    const moving = await drag(350)
    closeTo(moving.width, 350, 'Transient preview width')
    assert.equal(moving.armed, false)
    closeTo((await release()).width, 420, 'Stable rebound width')
    await drag(320)
    const done = await release()
    assert.equal(done.visible, true)
    closeTo(done.width, 420, 'Threshold rebound width')
  })

  await check('drag-to-close keeps the preferred ratio, file tab, reading position and draft', async () => {
    await run('window.previewTest.bookmark()')
    const before = await snapshot()
    const moving = await drag(319)
    assert.equal(moving.armed, true)
    assert.equal(moving.hint, '松开关闭文件预览')
    assert.equal(moving.opacity, '0.35')
    assert.equal(moving.lineColor, moving.hintColor, 'The entire divider immediately matches the danger hint')
    await capture('preview-close-armed')
    const closed = await release()
    assert.equal(closed.visible, false)
    assert.equal(closed.handle, null)
    assert.equal(closed.tabCount, 0, 'Hidden preview tabs leave the persistent toggle available')
    assert.equal((await reviewSnapshot()).toggleVisible, true)
    closeTo(closed.conversation, closed.available, 'Conversation reclaims the full width')
    assert.equal(closed.stored, before.stored)
    assert.match(closed.focused, /camp-timeline/)
    const reopened = await open()
    closeTo(reopened.width, before.width, 'Reopen last stable width')
    assert.equal(reopened.tabCount, 1)
    assert.equal(reopened.sameViewer, true)
    assert.equal(reopened.scroll, 640)
    assert.equal(reopened.draft, '保留这条未发送草稿')
  })

  await check('Escape, pointercancel and lost capture restore the pre-drag ratio', async () => {
    const before = await snapshot()
    for (const cancel of [() => key('Escape'), () => run('window.previewTest.cancelPointer()'), () => run('window.previewTest.cancelPointer(true)')]) {
      await drag(280)
      await cancel()
      const done = await release()
      assert.equal(done.visible, true)
      assert.equal(done.stored, before.stored)
      closeTo(done.width, before.width, 'Cancelled drag width')
      assert.equal(done.resizing, false)
    }
  })

  await check('keyboard resize uses 24/80px steps, double click resets, Delete and Backspace close', async () => {
    await run('document.querySelector(".file-preview-resize-handle").focus()')
    for (const [code, modifiers, expected] of [
      ['Left', [], 444], ['Left', ['shift'], 524], ['Right', [], 500], ['Right', ['shift'], 420], ['Right', [], 420]
    ]) closeTo((await key(code, modifiers)).width, expected, 'Keyboard preview width')
    assert.equal(Number((await reset()).stored), .56, 'Default ratio reset')
    for (const code of ['Delete', 'Backspace']) {
      await run('document.querySelector(".file-preview-resize-handle").focus()')
      assert.equal((await key(code)).visible, false)
      assert.equal((await open()).stored, '0.56')
    }
  })

  await check('container resize cancels active dragging and never overwrites the preferred ratio', async () => {
    await drag(800)
    await viewport(1_130)
    const done = await release()
    closeTo(done.width, 440, 'Container clamps while preserving the conversation')
    assert.equal(done.stored, '0.56')
    assert.equal(done.resizing, false)
    const restored = await viewport(1_440)
    closeTo(restored.width, restored.available * .56, 'Ratio after window expands')
    assert.equal(restored.aligned, true)
  })

  await check('actual workspace threshold replaces the conversation and returns without losing content', async () => {
    const split = await viewport(1_111)
    assert.equal(split.compact, false)
    closeTo(split.conversation, 420, 'Last split conversation width')
    const compact = await viewport(1_110)
    assert.equal(compact.compact, true)
    assert.equal(compact.returnVisible, true)
    assert.equal(compact.controlsVisible, false)
    assert.equal(compact.handle, null)
    assert.equal(compact.aligned, true)
    assert.equal(compact.overflow, false)
    assert.equal(compact.focused, 'file-preview-tab-activate')
    closeTo(compact.width, compact.available, 'Compact preview width')
    await run('document.querySelector(".file-preview-return").click()')
    const back = await snapshot()
    assert.equal(back.visible, false)
    assert.equal(back.controlsVisible, true)
    assert.match(back.focused, /camp-timeline/)
    assert.equal(back.stored, '0.56')
    await open()
    await viewport(1_040, 700)
    await capture('preview-day-1040x700')
  })

  await check('compact conversation follows its own width on a 2560px desktop without remounting content', async () => {
    const wide = await viewport(2_560, 1_440)
    await run('window.previewTest.bookmark()')
    for (const conversationWidth of [481, 480, 450, 420]) {
      const moving = await drag(wide.available - conversationWidth)
      closeTo(moving.conversation, conversationWidth, 'Requested conversation width')
      const layout = await conversationSnapshot()
      assert.deepEqual(layout.overflows, [], 'Conversation, cards and Composer must not overflow')
      closeTo(layout.task.left, layout.files.left, 'Task and Files Changed stay aligned')
      closeTo(layout.task.right, layout.files.right, 'Both cards share the right boundary')
      assert.equal(layout.viewLabel, '查看变化')
      assert.equal(layout.fileStatsFit, true)
      assert.deepEqual(layout.fileStats, ['+123−45', '+124−46'])
      assert.equal(layout.pathTruncated, true, 'Long paths give space to the statistics')
      assert.ok(layout.attachment.width >= 28 && layout.attachment.height >= 28, 'Attachment hit target is preserved')
      assert.ok(layout.send.height >= 28 && layout.stop.height >= 28, 'Primary actions retain their hit targets')
      assert.equal(layout.codeScrolls, true)
      assert.equal(layout.tableScrolls, true)
      if (conversationWidth <= 480) {
        assert.equal(layout.glyphWidth, 26)
        assert.equal(layout.filesGlyphWidth, 28)
        assert.equal(layout.chevronVisible, false)
        assert.equal(layout.hintVisible, false)
        closeTo(layout.task.left, layout.track.left, 'Compact task removes its left indent')
        closeTo(layout.task.width, layout.track.width, 'Compact task uses the reading track')
        assert.ok(layout.noteBody.top >= layout.noteLabel.bottom, 'Task status explanation stacks vertically')
        closeTo(layout.composer.left - layout.pane.left, 12, 'Compact Composer gutter')
      } else {
        assert.equal(layout.glyphWidth, 30)
        assert.equal(layout.chevronVisible, true)
        assert.equal(layout.hintVisible, true)
        closeTo(layout.task.left - layout.track.left, 42, 'Standard card indent stays unchanged')
      }
      const done = await release()
      assert.equal(done.sameEditor, true)
      assert.equal(done.sameTimeline, true)
      assert.equal(done.sameTask, true)
      assert.equal(done.sameViewer, true)
      assert.equal(done.draft, '保留这条未发送草稿')
      await capture(`conversation-day-${conversationWidth}px`, { x: 270, y: 0, width: 600, height: 1440 })
    }
  })

  await check('compact find owns the tool area and approval/recovery stay above the same Composer', async () => {
    await run('window.previewTest.find(true)')
    const finding = await conversationSnapshot()
    assert.equal(finding.viewSwitcherVisible, false)
    assert.equal(finding.findOverflow, false)
    assert.ok(finding.find.left >= finding.pane.left && finding.find.right <= finding.pane.right)
    await capture('conversation-find-420px', { x: 270, y: 0, width: 600, height: 1440 })
    await run('document.querySelector(".conversation-find-icon-button.close").click()')
    assert.equal((await conversationSnapshot()).viewSwitcherVisible, true)
    await viewport(2_560, 700)
    await run('window.previewTest.docks("both")')
    const docked = await conversationSnapshot()
    assert.deepEqual(docked.overflows, [])
    assert.equal(docked.approvalHeadingSingleLine, true)
    assert.equal(docked.recoveryTextWraps, true)
    assert.equal(docked.approvalActionsVisible, true, 'The sample approval options are fully readable')
    closeTo(docked.approval.width, docked.pane.width, 'Approval shares the full conversation width')
    closeTo(docked.approval.left, docked.pane.left, 'Approval aligns with the conversation column')
    closeTo(docked.recovery.width, 396, 'Recovery follows the narrow conversation')
    assert.ok(docked.approval.bottom <= docked.composer.top && docked.recovery.bottom <= docked.composer.top)
    assert.ok(docked.composer.bottom <= 700, 'Both docks keep the Composer within the window')
    assert.equal((await snapshot()).sameEditor, true)
    await capture('conversation-approval-recovery-420px', { x: 270, y: 0, width: 600, height: 700 })
    await run('window.previewTest.docks("none")')
    await reset()
  })

  await check('wide, night and 200% reduced-motion layouts preserve one boundary without overflow', async () => {
    await run('document.documentElement.dataset.theme = "night"')
    const wide = await viewport(2_560, 1_440)
    closeTo(wide.width, wide.available * .56, 'Wide preview ratio')
    assert.equal(wide.aligned, true)
    assert.equal(wide.overflow, false)
    await capture('preview-night-2560x1440')
    await drag(wide.available - 450)
    await release()
    await capture('conversation-night-450px', { x: 270, y: 0, width: 600, height: 1440 })
    await reset()
    await viewport(1_440)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    window.webContents.setZoomFactor(2)
    const zoomed = await snapshot()
    assert.equal(zoomed.compact, true)
    assert.equal(zoomed.reducedMotion, true)
    assert.equal(zoomed.aligned, true)
    assert.equal(zoomed.overflow, false)
    assert.ok(Number.parseFloat(zoomed.transition) <= .00001, 'Reduced motion disables visible layout transitions')
    await capture('preview-night-200-percent-reduced-motion')
    window.webContents.setZoomFactor(1)
    await viewport(1_440)
  })

  await check('Camp changes release capture and reload restores the saved ratio from local storage', async () => {
    await drag(300)
    await run('window.previewTest.switchCamp()')
    const changed = await release()
    assert.equal(changed.visible, false)
    assert.equal(changed.resizing, false)
    assert.equal(changed.stored, '0.56')
    await new Promise(resolve => {
      window.webContents.once('did-finish-load', resolve)
      window.webContents.reload()
    })
    const reopened = await open()
    closeTo(reopened.width, reopened.available * .56, 'Reloaded ratio')
    assert.equal(reopened.stored, '0.56')
  })

  await check('File Change opens beside the unchanged conversation with its own tab and immutable evidence', async () => {
    await run('document.documentElement.dataset.theme = "day"; window.previewTest.bookmark()')
    const before = await snapshot()
    const reads = (await reviewSnapshot()).fileReads
    const opened = await click('.run-file-change-file')
    assert.equal(opened.controlsVisible, true)
    assert.equal(opened.sameEditor, true)
    assert.equal(opened.sameTimeline, true)
    assert.equal(opened.sameViewer, true)
    closeTo(opened.width, before.width, 'Review uses the same preview ratio')
    assert.equal(opened.tabCount, 2)
    const review = await reviewSnapshot()
    assert.equal(review.reviewInPreview, true)
    assert.match(review.selectedTab, /^File Change·very-long-file-preview-name\.tsx$/)
    assert.match(review.text, /历史新内容/)
    assert.equal(review.fileReads, reads, 'Historical review never reads the working file')
    assert.deepEqual(review.reviewRequests, [{ campId: 'camp-1', agentRunId: 'run-1', executionEpoch: 1 }])
    assert.deepEqual(review.tabs.map(tab => tab.icon), ['code', 'file_change'])
    assert.ok(review.tabs.every(tab => tab.iconVisible && tab.noDrag))
    assert.equal(review.headerDrag, 'drag')
    assert.ok(review.dragSpace >= 24)
    assert.equal(review.pickerVisible, true)
    assert.equal(review.sidebarVisible, false)
    assert.equal(review.horizontalScroll, false, 'Short diff lines do not force a full-page minimum width')
    assert.deepEqual(review.overflow, [])
    await capture('file-change-day-1440x920')
  })

  await check('420px review keeps navigation and current-file access while restoring the review tab state', async () => {
    await drag(420)
    await release()
    await run('window.previewTest.selectChangedFile(1); window.previewTest.bookmarkReview()')
    const narrow = await reviewSnapshot()
    assert.equal(narrow.selectedTab, 'File Change·styles.css')
    assert.match(narrow.selectedFile, /styles\.css$/)
    assert.equal(narrow.pickerVisible, true)
    assert.equal(narrow.horizontalScroll, true, 'Long diff lines scroll inside their own reading surface')
    assert.deepEqual(narrow.overflow, [])
    await capture('file-change-day-420px')
    await run('document.querySelector(".agent-run-file-review-open-current").focus()')
    await key('Enter')
    const current = await reviewSnapshot()
    assert.equal(current.selectedTab, 'styles.css')
    assert.equal(current.reviewVisible, false)
    assert.equal(current.tabs.length, 3)
    assert.equal((await snapshot()).focused, 'file-preview-tab-activate', 'Opening from a hidden review transfers keyboard focus to the current file tab')
    assert.deepEqual(current.fileOpens.at(-1), {
      kind: 'run_evidence', campId: 'camp-1', agentRunId: 'run-1', executionEpoch: 1,
      evidenceFileId: 'file-1', action: 'open_current'
    })
    await click('[role="tab"][aria-label="File Change·styles.css"]')
    const restored = await reviewSnapshot()
    assert.equal(restored.sameReview, true)
    assert.equal(restored.reviewScroll, 640)
    assert.equal(restored.reviewRequests.length, 1)
    await run('window.previewTest.openReview(1)')
    assert.equal((await snapshot()).tabCount, 3, 'Opening the same run reuses its review tab')
    assert.equal((await reviewSnapshot()).reviewRequests.length, 1)
    await click('[aria-label="关闭 styles.css"]')
    assert.equal((await snapshot()).tabCount, 2)
    await reset()
  })

  await check('review epochs stay separate, retry stays in preview, and closing reviews never releases a file handle', async () => {
    const before = await reviewSnapshot()
    await run('window.previewTest.otherEpoch(true)')
    const failed = await reviewSnapshot()
    assert.equal(failed.tabs.length, 3)
    assert.match(failed.error, /文件变化暂时无法读取/)
    assert.equal((await snapshot()).controlsVisible, true)
    await click('.file-preview-tab-panel:not([hidden]) .agent-run-file-review-state button')
    assert.equal((await reviewSnapshot()).error, undefined)
    assert.equal((await reviewSnapshot()).fileReads, before.fileReads)
    await click('[aria-label="关闭 File Change·styles.css"]')
    assert.deepEqual((await reviewSnapshot()).releases, before.releases)
    await viewport(2_560, 1_440)
    await run('document.documentElement.dataset.theme = "night"')
    assert.equal((await reviewSnapshot()).sidebarVisible, true)
    assert.deepEqual((await reviewSnapshot()).overflow, [])
    await capture('file-change-night-2560x1440')
    await viewport(1_110)
    assert.equal((await snapshot()).returnVisible, true)
    assert.equal((await reviewSnapshot()).reviewVisible, true)
    await click('.file-preview-toggle')
    assert.equal((await snapshot()).controlsVisible, true)
    await click('.file-preview-toggle')
    assert.equal((await reviewSnapshot()).reviewVisible, true)
    assert.equal((await snapshot()).stored, '0.56')
    await run('window.previewTest.closeAll()')
    assert.equal((await snapshot()).visible, false)
    assert.equal((await reviewSnapshot()).toggleVisible, true)
    await click('.file-preview-toggle')
    assert.equal((await reviewSnapshot()).emptyVisible, true)
    assert.equal((await snapshot()).focused, 'file-preview-return')
    await click('.file-preview-return')
    await viewport(1_440)
    await run('window.previewTest.openReview(); window.previewTest.switchCamp()')
    assert.equal((await snapshot()).visible, false)
    await run('window.previewTest.openReview()')
    assert.equal((await snapshot()).visible, false, 'A stale card cannot open review in another Camp')
  })
  console.log(JSON.stringify({ ok: true, cases }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
