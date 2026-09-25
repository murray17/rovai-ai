const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const assertReturnToLatest = require('../assert-return-to-latest.cjs')
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
  const run = code => window.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Fixture action failed: ${code}`, { cause: error }) })
  const state = async () => { await run('window.campOpenTest.settle()'); return run('window.campOpenTest.state()') }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  const assertUserAttachmentLayout = (attachmentState, label) => {
    const layout = attachmentState.userLayout
    assert.ok(layout.attachmentWidth > layout.messageWidth + 300,
      `${label}: attachment width is independent from the short message bubble`)
    assert.ok(Math.abs(layout.attachmentRight - layout.messageRight) <= 1,
      `${label}: attachments and the message bubble share the user-side edge`)
    assert.ok(Math.abs(layout.userAvatarLeft - layout.attachmentRight - 10) <= 1,
      `${label}: attachments retain the avatar gutter`)
    assert.ok(layout.attachmentLeft >= layout.agentAvatarLeft - 1,
      `${label}: attachments do not extend past the agent identity track`)
    assert.ok(layout.attachmentLeft <= layout.agentMessageBodyLeft + 32,
      `${label}: attachments may extend left to the agent avatar or name track`)
  }
  try {
    if (mode === '--command-interaction') {
      const report = await require('../assert-command-interaction.cjs')(window, run, capture)
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ ok: true, mode, report }))
      app.exit(0)
      return
    }
    if (mode === '--entry-preview-selection') {
      const settle = () => run('window.campOpenTest.settle()')
      const waitFor = async expression => {
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (await run(expression)) return
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        throw new Error(`Entry preview condition timed out: ${expression}`)
      }

      await run('window.campOpenTest.showEntryPreview(1)')
      await waitFor('document.querySelectorAll(".run-pulse-chip[data-agent-id]").length >= 3')
      await run('document.querySelector(".run-pulse-chip[data-agent-id=agent-2]").click()')
      await settle()
      assert.equal((await run('window.campOpenTest.entryState()')).selectedAgentId, 'agent-2',
        'the cached preview can select a historical Run')
      await run('window.campOpenTest.completeEntrySnapshot()')
      await settle()
      let entryState = await run('window.campOpenTest.entryState()')
      assert.equal(entryState.selectedAgentId, 'agent-2', 'formal readiness preserves the selected historical Run')
      assert.equal(entryState.expanded, true)

      await run('window.campOpenTest.showEntryPreview(2)')
      await waitFor('document.querySelector(".run-pulse-chip[data-agent-id=agent-1]") !== null')
      await run('document.querySelector(".run-pulse-chip[data-agent-id=agent-1]").click()')
      await settle()
      await run('document.querySelector(".execution-bottom-collapse-button").click()')
      await settle()
      assert.equal((await run('window.campOpenTest.entryState()')).selectedAgentId, null,
        'the cached preview can explicitly close execution')
      await run('window.campOpenTest.completeEntrySnapshot()')
      await settle()
      entryState = await run('window.campOpenTest.entryState()')
      assert.equal(entryState.selectedAgentId, null, 'formal readiness does not reopen an explicitly closed execution')
      assert.equal(entryState.expanded, false)

      await run('window.campOpenTest.showEntryPreview(3)')
      await waitFor('document.querySelector(".run-pulse-chip[data-agent-id=agent-1]") !== null')
      await run('window.campOpenTest.completeEntrySnapshot()')
      await settle()
      entryState = await run('window.campOpenTest.entryState()')
      assert.equal(entryState.selectedAgentId, '__execution_overview__', 'formal readiness auto-opens overview around the running Run when untouched')
      assert.equal(entryState.expanded, true)
      console.log(JSON.stringify({ ok: true, mode, checks: ['historical-selection', 'closed-stays-closed', 'untouched-overview-auto-open'] }))
      window.destroy()
      app.quit()
      return
    }
    if (mode === '--return-latest') {
      await state()
      await run('document.querySelector(".camp-timeline").scrollTop = 200')
      await state()
      assert.equal(await run('document.querySelectorAll("[data-return-scope=camp]").length'), 1)
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 0)
      const top = await run('document.querySelector(".camp-timeline").scrollTop')
      await run('window.campOpenTest.refresh(true)')
      await state()
      assert.ok(Math.abs(await run('document.querySelector(".camp-timeline").scrollTop') - top) < 2)
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 1)
      await capture('return-latest-camp')
      await assertReturnToLatest(window, run, 'camp')
      assert.equal(await run('document.querySelectorAll("[data-return-scope=camp]").length'), 0)
      assert.ok(await run('(() => { const v=document.querySelector(".camp-timeline"); return v.scrollHeight-v.clientHeight-v.scrollTop < 2 })()'))
      for (const placement of ['bottom', 'inspector']) {
        await run(`document.documentElement.dataset.theme = '${placement === 'bottom' ? 'day' : 'night'}'; window.campOpenTest.showFailedExecutions('${placement}')`)
        await state()
        await run('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]").click()')
        await state()
        assert.equal(await run('document.querySelector(".execution-history-toggle")?.getAttribute("aria-expanded")'), 'false')
        await run('document.querySelector(".execution-history-toggle").click()')
        await state()
        await run(`[...document.querySelectorAll('.execution-history-list .execution-run-toggle')]
          .filter(button => button.getAttribute('aria-expanded') === 'false').forEach(button => button.click())`)
        await state()
        await run('document.querySelector(".execution-drawer-body").scrollTop = 0')
        await state()
        assert.equal(await run('document.querySelectorAll(".execution-disclosure .return-to-latest, .execution-history-latest").length'), 0)
        const executionReturnState = await run(`(() => { const host = document.querySelector('.execution-drawer-body'); return {
          buttonCount: document.querySelectorAll('[data-return-scope=execution]').length,
          scrollHeight: host.scrollHeight, clientHeight: host.clientHeight, scrollTop: host.scrollTop,
          historyExpanded: document.querySelector('.execution-history-toggle')?.getAttribute('aria-expanded')
        } })()`)
        assert.equal(executionReturnState.buttonCount, 1, JSON.stringify(executionReturnState))
        await run(`(() => {
          const host = document.querySelector('.execution-drawer-body')
          const button = document.querySelector('[data-return-scope=execution]')
          const target = [...document.querySelectorAll('.execution-run-card-header')]
            .map(header => host.scrollTop + header.getBoundingClientRect().top - button.getBoundingClientRect().top - 3)
            .find(top => top >= 0 && top < host.scrollHeight - host.clientHeight - 24)
          if (target === undefined) throw new Error('No Run header can overlap the control while reading history')
          host.scrollTop = target
        })()`)
        await state()
        const opened = await run('[...document.querySelectorAll(".execution-run-toggle")].map(node=>node.getAttribute("aria-expanded"))')
        const headerOverlap = await run(`(() => {
          const b=document.querySelector('[data-return-scope=execution]').getBoundingClientRect()
          return [...document.querySelectorAll('.execution-run-card-header')].some(node=>{
            const r=node.getBoundingClientRect(); return r.top<=b.top+7 && r.bottom>=b.top+7
          })
        })()`)
        assert.equal(headerOverlap, true, 'regression control overlaps a real Run header')
        await capture(`return-latest-${placement}`)
        await assertReturnToLatest(window, run, 'execution')
        await state()
        assert.deepEqual(await run('[...document.querySelectorAll(".execution-run-toggle")].map(node=>node.getAttribute("aria-expanded"))'), opened)
        assert.equal(await run('document.querySelectorAll("[data-return-scope=execution]").length'), 0)
        assert.ok(await run('(() => { const v=document.querySelector(".execution-drawer-body"); return v.scrollHeight-v.clientHeight-v.scrollTop < 2 })()'))
        await run('window.campOpenTest.appendCollapsedRunningExecution()')
        await state()
        assert.equal(await run('document.querySelector("[data-agent-run-id=empty-failed-latest-running] .execution-run-toggle")?.getAttribute("aria-expanded")'), 'false')
        await run('document.querySelector(".execution-drawer-body").scrollTop = 0')
        await state()
        const beforeReturn = await run('[...document.querySelectorAll(".execution-run-toggle")].map(node=>node.getAttribute("aria-expanded"))')
        await assertReturnToLatest(window, run, 'execution')
        await state()
        assert.deepEqual(await run('[...document.querySelectorAll(".execution-run-toggle")].map(node=>node.getAttribute("aria-expanded"))'), beforeReturn,
          'returning from an older focused Run preserves the collapsed latest running Run')
        assert.equal(await run('document.querySelector(".execution-drawer-body").dataset.followingLatest'), 'true')
      }
      await run('window.campOpenTest.showHistoricalReturnWindow()')
      await run('window.campOpenTest.settle()')
      assert.equal(await run('document.querySelectorAll("[data-return-scope=execution]").length'), 1)
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 0)
      await run('window.campOpenTest.updateReturnWindow(2, true)')
      await run('window.campOpenTest.settle()')
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 1,
        'new output is signalled even at the bottom of an incomplete historical window')
      await run('document.querySelector("[data-return-scope=execution]").focus({preventScroll:true}); window.campOpenTest.updateReturnWindow(2, false)')
      await run('window.campOpenTest.settle()')
      assert.equal(await run('document.querySelectorAll("[data-return-scope=execution]").length'), 0)
      assert.equal(await run('document.activeElement.matches(".execution-drawer-body")'), true,
        'restoring the latest cache returns focus when the control disappears without a click')
      console.log(JSON.stringify({ ok: true, verified: ['camp-new-reply-position', 'pressed-target-stability', 'failed-run-click-isolation', 'bottom-and-inspector'] }))
      app.quit()
      return
    }
    if (mode === '--execution-window') {
      const settle = () => run('window.campOpenTest.settle()')
      const waitFor = async expression => {
        const deadline = Date.now() + 4000
        do { await settle(); if (await run(expression)) return } while (Date.now() < deadline)
        assert.fail(`Execution window condition: ${expression}`)
      }
      const report = []
      const initialPositions = []
      const waitForContent = () => waitFor(`!document.querySelector('.execution-history-loader .camp-history-spinner')
        && ![...document.querySelectorAll('.process-action.current')].some(item => item.textContent.includes('正在读取完整过程'))`)
      const initialFeedback = []
      for (const placement of ['bottom', 'inspector']) {
        await run(`document.documentElement.dataset.theme = '${placement === 'bottom' ? 'day' : 'night'}'; window.campOpenTest.showRunningExecution('${placement}', -1, 0)`)
        await waitFor("document.querySelector('.process-action.current')?.textContent === '执行中'")
        await waitForContent()
        const feedback = await run(`(() => {
          const content = document.querySelector('.process-content')
          const status = content.querySelector('.process-action.current')
          return { text: status.textContent, gap: status.getBoundingClientRect().top - content.getBoundingClientRect().top }
        })()`)
        assert.equal(feedback.gap, 0, `${placement}: initial thinking has no blank row above it`)
        initialFeedback.push({ placement, ...feedback })
        await capture(`initial-thinking-${placement}`)
        await run('window.campOpenTest.appendExecution(1)')
        await waitFor("Boolean(document.querySelector('.tool-activity-group'))")
        assert.equal(await run("Boolean(document.querySelector('.process-action.current'))"), false,
          'first output replaces the initial feedback')
        await run('window.campOpenTest.appendExecution(7)')
        await waitFor("document.querySelector('.process-copy')?.textContent.includes('记录 8')")
        assert.equal(await run("document.querySelector('.process-copy').getBoundingClientRect().height > 0"), true,
          'narration renders after the empty list receives output')
        for (let sample = 0; sample < 3; sample++) {
          await run(`window.campOpenTest.showRunningExecution('${placement}', ${sample})`)
          await waitFor('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]") !== null')
          await run('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]").click()')
          await waitFor('document.querySelector(".process-copy")?.textContent.includes("这一页的执行说明")')
          await settle()
          const position = await run(`(() => { const host = document.querySelector('.execution-drawer-body'); return {
            top: host.scrollTop, gap: host.scrollHeight - host.clientHeight - host.scrollTop,
            following: host.dataset.followingLatest,
          }; })()`)
          assert.ok(position.top > 0 && position.gap < 8, `${placement} sample ${sample}: asynchronous first page and full bodies follow latest: ${JSON.stringify(position)}`)
          initialPositions.push({ placement, sample, ...position })
          if (sample === 1) {
            const initial = await run(`(() => { const root = document.querySelector('.process-content'); return {
              count: Number(root.dataset.executionLoadedCount), first: root.dataset.executionFirstSequence,
              pages: window.campOpenTest.executionWindowState().requests.length
            }; })()`)
            await run('window.campOpenTest.appendExecution(513)')
            await waitFor(`Number(document.querySelector('.process-content').dataset.executionLoadedCount) === ${initial.count + 513}`)
            assert.equal(await run("document.querySelector('.process-content').dataset.executionFirstSequence"), initial.first,
              'live append retains the original loaded prefix')
            assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, initial.pages,
              'live append does not reread latest or shift the historical prefetch cursor')
            await waitFor('document.querySelector(".execution-drawer-body").scrollHeight - document.querySelector(".execution-drawer-body").clientHeight - document.querySelector(".execution-drawer-body").scrollTop < 8')
            assert.ok((await run('window.campOpenTest.executionWindowState()')).dom < 2000, 'hundreds of loaded records keep DOM bounded')
            await run(`window.campOpenTest.showRunningExecution('${placement}', 99)`)
            await settle()
            await run(`window.campOpenTest.showRunningExecution('${placement}', 1)`)
            await settle()
            await run('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]").click()')
            await waitFor(`Number(document.querySelector('.process-content')?.dataset.executionLoadedCount) === ${initial.count + 513}`)
            assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, 0,
              'remount restores cached execution without initial or historical page reads')
            await waitFor('document.querySelector(".execution-drawer-body").scrollHeight - document.querySelector(".execution-drawer-body").clientHeight - document.querySelector(".execution-drawer-body").scrollTop < 8')
          }
          if (sample === 0) {
            await capture(`running-execution-latest-${placement}`)
            for (let index = 0; index < 3; index++) {
              await run('document.querySelector(".execution-history-loader button").click()')
              await waitForContent()
            }
            const before = await run('window.campOpenTest.executionWindowState()')
            await run('document.querySelector(".execution-drawer-body").scrollTop /= 2')
            await waitFor('document.querySelector("[data-return-scope=execution]") !== null')
            await run('document.querySelector("[data-return-scope=execution]").click()')
            await waitForContent()
            const after = await run('window.campOpenTest.executionWindowState()')
            assert.equal(after.requests.filter(request => request.beforeSequence === null).length,
              before.requests.filter(request => request.beforeSequence === null).length, 'return to latest uses the cached page')
            for (const id of before.contentReads) assert.equal(after.contentReads.filter(value => value === id).length,
              before.contentReads.filter(value => value === id).length, `cached full body ${id} is not reread`)
            assert.equal(await run('document.querySelector(".execution-drawer-body").scrollHeight - document.querySelector(".execution-drawer-body").clientHeight - document.querySelector(".execution-drawer-body").scrollTop < 8'), true)
          }
        }
      }
      for (const placement of ['bottom', 'inspector']) {
        await run(`document.documentElement.dataset.theme = '${placement === 'bottom' ? 'day' : 'night'}'; window.campOpenTest.showExecutionWindow('${placement}')`)
        await settle()
        assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, 0, 'closed Run performs no read')
        await run('document.querySelector(".execution-disclosure summary").click()')
        await run('new Promise(resolve => setTimeout(resolve, 350))')
        assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, 0, 'offscreen opened Run waits for the viewport')
        await run('document.querySelector(".execution-disclosure").scrollIntoView({block:"nearest"})')
        await waitFor('window.campOpenTest.executionWindowState().requests.length === 2')
        let state = await run('window.campOpenTest.executionWindowState()')
        assert.equal(state.toolRows, 0)
        assert.equal(state.contentReads.length, 0)
        assert.ok(state.dom < 600, `bounded initial DOM: ${state.dom}`)
        assert.equal(state.overflow, false)
        assert.ok(state.requests[0].limit < 30)
        const summaries = await run('[...document.querySelectorAll(".tool-activity-group > summary")].map(node => node.getAttribute("aria-label"))')
        assert.ok(summaries.length > 0, 'paged execution renders tool group summaries')
        for (const summary of summaries) assert.match(summary, /^已完成 \d+ 个步骤/, 'paging preserves execution outcome copy')
        await run('document.querySelector(".execution-drawer-body").scrollTop = 630')
        await settle()
        await capture(`execution-history-loader-${placement}`)
        const anchor = await run(`(() => { const n = document.querySelector('[data-execution-item-key]'); return {key:n.dataset.executionItemKey, top:n.getBoundingClientRect().top}; })()`)
        await run('document.querySelector(".execution-history-loader button").focus({preventScroll:true})')
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
        await waitFor('window.campOpenTest.executionWindowState().requests.length === 3')
        assert.equal(await run('document.activeElement.matches(".execution-history-loader button")'), true, 'paging retains keyboard focus')
        const after = await run('document.querySelector(' + JSON.stringify(`[data-execution-item-key="${anchor.key}"], [data-execution-item-keys~="${anchor.key}"]`) + ').getBoundingClientRect().top')
        assert.ok(Math.abs(after - anchor.top) < 2, `anchor preserved: ${after - anchor.top}`)
        for (let index = 0; index < 3; index++) {
          await run('document.querySelector(".execution-history-loader button").click()')
          await settle()
        }
        const cachedReads = (await run('window.campOpenTest.executionWindowState()')).requests.length
        await run('window.campOpenTest.failExecutionRead(true)')
        await run('document.querySelector(".execution-drawer-body").scrollTop -= 80')
        await settle()
        for (let index = 0; index < 3; index++) {
          await run('document.querySelector(".execution-drawer-body").scrollTop = document.querySelector(".execution-drawer-body").scrollHeight')
          await settle()
        }
        assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, cachedReads, 'scrolling down restores cached pages without transport reads')
        assert.equal(await run('document.querySelector(".process-content").textContent.includes("记录 1000")'), true, 'scrolling down reaches the already loaded tail')
        assert.equal(await run('[...document.querySelectorAll(".process-content button")].some(button => /载入较新|加载较新/.test(button.textContent))'), false)
        // Loaded history stays in the native scroll range; no page button is needed to revisit it.
        await run('document.querySelector(".execution-drawer-body").scrollTop = document.querySelector(".execution-drawer-body").scrollHeight / 2')
        await settle()
        await run('document.querySelector("[data-return-scope=execution]").click()')
        await settle()
        assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, cachedReads, 'cached latest works offline')
        await run('window.campOpenTest.failExecutionRead(false)')
        await run('[...document.querySelectorAll(".tool-activity-group > summary")].at(-1).click()')
        await settle()
        state = await run('window.campOpenTest.executionWindowState()')
        assert.ok(state.toolRows > 0 && state.toolRows < 30)
        assert.equal(state.contentReads.length, 0, 'opening a group does not fetch outputs or diffs')
        await run('document.querySelector(".execution-drawer-body").scrollTop = document.querySelector(".execution-drawer-body").scrollHeight')
        await waitFor('Boolean(document.querySelector(".modified-file-row summary"))')
        await run('document.querySelector(".modified-file-row summary").click()')
        await waitFor('window.campOpenTest.executionWindowState().contentReads.length === 1')
        await waitFor('document.querySelector(".modified-file-row").textContent.includes("TOKEN=fixture-value")')
        await run('document.querySelector(".modified-file-row").scrollIntoView({block:"center"})')
        await settle()
        await capture(`execution-window-diff-${placement}`)
        await run('document.querySelector(".tool-call-disclosure summary").click()')
        await waitFor('document.querySelector(".process-content").textContent.includes("OUTPUT_TOKEN=fixture-value")')
        await run('document.querySelector(".tool-call-disclosure[open]").scrollIntoView({block:"center"})')
        await settle()
        assert.ok(await run('document.querySelector(".tool-call-disclosure[open]")?.textContent.includes("OUTPUT_TOKEN=fixture-value")'), 'page-boundary group changes retain the opened result')
        assert.equal((await run('window.campOpenTest.executionWindowState()')).contentReads.length, 2, 'retained results do not refetch on a group boundary')
        await run('document.querySelector(".tool-call-disclosure[open]").closest(".tool-activity-group").querySelector(":scope > summary").click()')
        await settle()
        await run('[...document.querySelectorAll(".tool-activity-group > summary")].at(-1).click()')
        await waitFor('document.querySelector(".tool-call-disclosure[open]")?.textContent.includes("OUTPUT_TOKEN=fixture-value")')
        await waitFor('document.querySelector(".modified-file-row[open]")?.textContent.includes("TOKEN=fixture-value")')
        assert.equal((await run('window.campOpenTest.executionWindowState()')).contentReads.length, 2,
          'remounted rows restore open disclosures and cached full results')
        await capture(`execution-window-${placement}`)
        report.push({ placement, background: await run('getComputedStyle(document.querySelector(".execution-drawer")).backgroundColor'), ...(await run('window.campOpenTest.executionWindowState()')), text: undefined })
      }
      assert.notEqual(report[0].background, report[1].background, 'both themes are applied')
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ ok: true, mode, report, initialPositions, initialFeedback }))
      app.exit(0)
      return
    }
    if (mode === '--composer-local-draft') {
      const settle = () => run('window.campOpenTest.settle()')
      const localDraftState = async () => { await settle(); return run('window.campOpenTest.localDraftState()') }
      const waitFor = async expression => {
        const deadline = Date.now() + 4000
        do { await settle(); if (await run(expression)) return } while (Date.now() < deadline)
        assert.fail(`Local draft condition: ${expression}`)
      }
      await settle()
      await run('document.querySelector("#camp-message").focus()')
      await window.webContents.insertText('当前已有草稿')
      await waitFor('window.campOpenTest.localDraftState().body === "当前已有草稿"')
      let value = await localDraftState()
      assert.equal(value.text, '当前已有草稿')
      assert.equal(value.editable, 'true')
      assert.equal(value.pendingRows, 0, 'public Camp has no private pending queue')
      await run('window.campOpenTest.refresh(true)')
      value = await localDraftState()
      assert.equal(value.text, '当前已有草稿', 'business projection refresh preserves the local draft')
      assert.equal(value.body, '当前已有草稿')
      await run('window.campOpenTest.remount()')
      await waitFor('window.campOpenTest.localDraftState().text === "当前已有草稿"')
      value = await localDraftState()
      assert.equal(value.body, '当前已有草稿', 'remount restores the Camp-local draft')
      assert.equal(value.editable, 'true')
      for (const theme of ['day', 'night']) {
        await run('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
        await settle()
        await capture(`camp-local-draft-${theme}`)
      }
      console.log(JSON.stringify({ ok: true, mode, checks: ['local-persistence', 'projection-refresh', 'remount', 'no-private-pending-queue'] }))
      window.destroy(); app.quit()
      return
    }
    if (mode === '--current-user-profile') {
      const settle = () => run('window.campOpenTest.settle()')
      const key = async keyCode => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
        if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
        await settle()
      }
      const click = async selector => {
        await run('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"nearest"})')
        await settle()
        const point = await run('(() => { const r = document.querySelector(' + JSON.stringify(selector) +
          ').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()')
        point.x = Math.round(point.x * window.webContents.getZoomFactor())
        point.y = Math.round(point.y * window.webContents.getZoomFactor())
        window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
        window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
        await settle()
      }
      const card = async () => {
        await run('Promise.all(document.querySelector(".mention-profile-popover")?.getAnimations().map(animation => animation.finished) ?? [])')
        return run('(() => { const p = document.querySelector(".current-user-profile-card"); if (!p) return null; ' +
        'const r = p.closest("[role=dialog]").getBoundingClientRect(); const a = p.querySelector(".profile-portrait"); ' +
        'return { name: p.querySelector("h2").textContent, text: p.textContent, avatarText: a.textContent, ' +
        'avatarWidth: a.getBoundingClientRect().width, imageLoaded: Boolean(a.querySelector("img")?.naturalWidth), ' +
        'width: r.width, bounded: r.left >= 11 && r.top >= 11 && r.right <= innerWidth - 11 && r.bottom <= innerHeight - 11, ' +
        'focused: document.activeElement === p.closest("[role=dialog]"), count: document.querySelectorAll(".mention-profile-popover").length } })()')
      }
      const user = '[data-message-id=profile-user] .current-user-profile-trigger'
      const external = '[data-message-id=profile-external] .current-user-profile-trigger'
      const mention = '[data-message-id=profile-agent] .message-mention-token.current-user'
      await run('window.campOpenTest.showCurrentUserProfile()')
      await settle()
      const canonical = await run('window.campOpenTest.currentUserMessages()')
      await click(user)
      let opened = await card()
      assert.equal(opened.name, '你')
      assert.equal(opened.text, '你你', 'Only the avatar glyph and name are visible')
      assert.equal(opened.avatarWidth, 160)
      assert.equal(opened.count, 1)
      assert.equal(opened.focused, false, 'Pointer activation keeps focus on the trigger')
      await capture('current-user-profile-default')
      await key('Escape')
      assert.equal(await card(), null)
      assert.equal(await run('document.activeElement.matches(' + JSON.stringify(user) + ')'), true)

      for (const selector of [user, external, mention]) {
        for (const activation of ['Enter', 'Space']) {
          await run('document.querySelector(' + JSON.stringify(selector) + ').focus()')
          await key(activation)
          opened = await card()
          assert.ok(opened, selector + ' ' + activation + ' opens the card')
          assert.equal(opened.focused, true, selector + ' ' + activation + ' focuses the card')
          assert.equal(await run('document.querySelector(' + JSON.stringify(selector) + ').getAttribute("aria-expanded")'), 'true')
          await key('Escape')
          assert.equal(await card(), null)
          assert.equal(await run('document.activeElement.matches(' + JSON.stringify(selector) + ')'), true)
          assert.equal(await run('document.querySelector(' + JSON.stringify(selector) + ').getAttribute("aria-expanded")'), 'false')
        }
      }
      await click(mention)
      const avatarDataUrl = 'data:image/png;base64,' + readFileSync(join(__dirname,
        '../../../apps/desktop/src/renderer/src/assets/characters/muwa/icon-192.png')).toString('base64')
      await run('window.campOpenTest.updateCurrentUserProfile(' + JSON.stringify({ displayName: 'Murray', avatarDataUrl }) + ')')
      const imageDeadline = Date.now() + 3000
      do {
        await settle()
        opened = await card()
      } while (!opened.imageLoaded && Date.now() < imageDeadline)
      assert.equal(opened.name, 'Murray')
      assert.equal(opened.text, 'Murray')
      assert.equal(opened.imageLoaded, true)
      assert.equal(await run('document.querySelector(' + JSON.stringify(mention) + ').textContent'), '@Murray')
      assert.deepEqual(await run('[...document.querySelectorAll(".conversation-bubble.user .bubble-meta strong, ' +
        '.conversation-bubble.external_principal .bubble-meta strong")].map(node => node.textContent)'), ['Murray', 'Murray'])
      assert.equal(await run('document.querySelectorAll(".message-mention-token.current-user").length'), 1)
      assert.equal(await run('document.querySelector(".current-user-markdown-content").textContent'), '正文 @你 与 @你 保持原样。')
      await capture('current-user-profile-custom')

      await click('[data-message-id=profile-agent] .message-author-name-trigger')
      assert.equal(await card(), null)
      assert.equal(await run('document.querySelectorAll(".mention-profile-popover[data-content-kind=member]").length'), 1)
      await click(user)
      assert.equal((await card()).count, 1, 'Personal and teammate cards are mutually exclusive')
      window.webContents.sendInputEvent({ type: 'mouseDown', x: 2, y: 2, button: 'left', clickCount: 1 })
      window.webContents.sendInputEvent({ type: 'mouseUp', x: 2, y: 2, button: 'left', clickCount: 1 })
      await settle()
      assert.equal(await card(), null, 'Outside click closes the card')
      await run('(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector(".current-user-markdown-content")); ' +
        'getSelection().removeAllRanges(); getSelection().addRange(r); document.querySelector(' + JSON.stringify(mention) + ').click() })()')
      await settle()
      assert.equal(await card(), null, 'Selecting body text does not accidentally open the profile')
      await run('getSelection().removeAllRanges()')
      await run('window.campOpenTest.updateCurrentUserProfile(' +
        JSON.stringify({ displayName: 'Murray', avatarDataUrl: null }) + ')')
      await settle()
      await click(external)
      assert.equal((await card()).avatarText, '你', 'A custom name keeps the default avatar glyph')
      await key('Escape')

      const layouts = []
      await run('window.campOpenTest.updateCurrentUserProfile(' +
        JSON.stringify({ displayName: 'MurrayABCDEFGHIJKLMNOPQRSTUVWX123', avatarDataUrl }) + ')')
      for (const theme of ['day', 'night']) {
        for (const [width, height, zoom] of [[1440, 920, 1], [1040, 700, 1], [2560, 1440, 1], [1440, 920, 2]]) {
          window.setContentSize(width, height)
          window.webContents.setZoomFactor(zoom)
          await run('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
          await settle()
          await click(mention)
          opened = await card()
          assert.ok(opened, theme + ' ' + width + ' zoom ' + zoom + ' opens the card')
          assert.equal(opened.bounded, true, theme + ' ' + width + ' zoom ' + zoom)
          assert.equal(Math.round(opened.width), 240)
          assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
          await capture('current-user-profile-' + theme + '-' + width + '-' + zoom)
          layouts.push({ theme, width, zoom, bounded: opened.bounded })
          await key('Escape')
        }
      }
      assert.equal(await run('window.campOpenTest.currentUserMessages()'), canonical, 'Historical content is unchanged')
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ ok: true, mode, layouts }))
      app.exit(0)
      return
    }
    if (mode === '--message-groups') {
      const settledGroups = async () => {
        for (let index = 0; index < 4; index += 1) await run('window.campOpenTest.settle()')
        return run('window.campOpenTest.messageGroupState()')
      }
      const layouts = []
      for (const theme of ['day', 'night']) {
        for (const width of [1440, 1040]) {
          window.setContentSize(width, 920)
          await run(`document.documentElement.dataset.theme = '${theme}'; window.campOpenTest.showMessageGroups('short')`)
          let grouped = await settledGroups()
          assert.equal(grouped.overflow, false)
          assert.equal(grouped.emptyBubbles, 0)
          assert.deepEqual(grouped.messages.filter(item => item.head).map(item => item.id), ['group-1', 'group-5', 'group-6'])
          assert.ok(grouped.messages.every(item => item.label && item.buttons === 2))
          const bubbleSurface = await run('(() => { const probe = document.createElement("span"); ' +
            'probe.style.color = "var(--conversation-user-message-surface)"; document.body.append(probe); ' +
            'const color = getComputedStyle(probe).color; probe.remove(); return color })()')
          assert.equal(grouped.messages[0].background, bubbleSurface)
          assert.ok(grouped.messages.every(item => item.contentBackground === 'rgba(0, 0, 0, 0)'))
          assert.ok(grouped.messages.every(item => Math.abs(item.left - grouped.messages[0].left) <= 1))
          assert.ok(Math.abs(grouped.messages[1].top - grouped.messages[0].bottom - 8) <= 1)
          await run('document.querySelector("[data-message-id=group-2] .message-copy-button").focus()')
          await settledGroups()
          await run('Promise.all(document.querySelector("[data-message-id=group-2] .message-actions").getAnimations().map(animation => animation.finished))')
          assert.equal(await run('getComputedStyle(document.querySelector("[data-message-id=group-2] .message-actions")).opacity'), '1')
          await run('document.querySelector("[data-message-id=group-2] .message-copy-button").click()')
          assert.equal((await settledGroups()).copiedPublicText, '连续发来的短消息共用身份信息。')
          await run('document.querySelector("[data-message-id=group-3] .message-copy-button").click()')
          assert.equal((await settledGroups()).copiedPublicText, '设计说明-1.md\n设计说明-2.md')
          await run('document.querySelector("[data-message-id=group-3] .message-reply-button").click()')
          assert.equal((await settledGroups()).repliedPublicMessageId, 'group-3')
          assert.equal(await run('document.activeElement.id'), 'camp-message')
          await run('document.querySelector("[data-message-id=group-3]").focus()')
          grouped = await settledGroups()
          assert.equal(grouped.messages[2].head, true, 'Reply/notification focus restores attachment author')
          await run('document.activeElement.blur()')
          await run('document.querySelector("[data-message-id=group-2]").classList.add("conversation-find-current-message")')
          assert.equal((await settledGroups()).messages[1].head, true, 'Find restores current author')
          await run('document.querySelector("[data-message-id=group-2]").classList.remove("conversation-find-current-message")')
          await capture(`message-groups-${theme}-${width}`)
          layouts.push({ theme, width, heads: grouped.messages.filter(item => item.head).map(item => item.id) })
        }
      }
      window.setContentSize(1440, 920)
      await run('document.documentElement.dataset.theme = "day"; window.campOpenTest.showMessageGroups("files")')
      let files = await settledGroups()
      assert.ok(files.messages[2].height < 320)
      assert.equal(files.messages[3].head, false)
      await run('document.querySelector(".timeline-track").style.width = "420px"')
      files = await settledGroups()
      assert.ok(files.messages[2].height >= 320, 'Stacked files cross the height boundary')
      assert.equal(files.messages[3].head, true)
      await capture('message-groups-narrow-files')
      await run('document.querySelector(".timeline-track").style.width = ""; window.campOpenTest.showMessageGroups("image")')
      await settledGroups()
      await run('document.querySelector("[data-message-id=group-3]").scrollIntoView({block:"center"})')
      const imageDeadline = Date.now() + 5000
      while (Date.now() < imageDeadline && !await run('Boolean(document.querySelector("[data-message-id=group-3] img")?.naturalWidth)')) {
        await run('window.campOpenTest.settle()')
      }
      const imageGroup = await settledGroups()
      assert.ok(imageGroup.messages[2].height >= 320)
      assert.equal(imageGroup.messages[3].head, true)
      assert.equal(imageGroup.emptyBubbles, 0)
      await capture('message-groups-large-image')
      for (const scenario of ['long', 'diff']) {
        await run(`window.campOpenTest.showMessageGroups('${scenario}')`)
        const group = await settledGroups()
        assert.equal(group.messages[3].head, true, `${scenario} restores the next author`)
      }
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ ok: true, mode, layouts, fileHeights: files.messages.map(item => item.height) }))
      app.exit(0)
      return
    }
    if (mode === '--run-artifacts') {
      await run('window.campOpenTest.showRunArtifacts()')
      const imageDeadline = Date.now() + 5000
      while (Date.now() < imageDeadline) {
        await run('window.campOpenTest.settle()')
        if (await run('Boolean(document.querySelector(".run-artifact-output .image-tile-preview img")?.naturalWidth)')) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      const layouts = []
      for (const theme of ['day', 'night']) {
        for (const width of [1440, 1040]) {
          window.setContentSize(width, 920)
          await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
          await run('window.campOpenTest.settle()')
          const layout = await run(`(() => {
            const rect = node => node.getBoundingClientRect();
            const outputs = [...document.querySelectorAll('.run-artifact-output')];
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              outputs: outputs.map(node => ({
                id: node.dataset.runArtifactOutputId,
                name: node.querySelector('.bubble-meta strong').textContent,
                avatars: node.querySelectorAll('.member-avatar').length,
                files: node.querySelectorAll('.run-file-changes-card').length,
                images: node.querySelectorAll('.image-gallery').length,
                imageWidth: node.querySelector('.image-tile-preview img')
                  ? rect(node.querySelector('.image-tile-preview img')).width : 0,
                actions: node.querySelectorAll('.message-actions').length,
                authorLeft: rect(node.querySelector('.member-avatar')).left,
                bodyLeft: rect(node.querySelector('.message-body')).left,
                fileLeft: rect(node.querySelector('.run-file-changes-card')).left,
                fileTop: rect(node.querySelector('.run-file-changes-card')).top,
                bodyBottom: rect(node.querySelector('.message-body')).bottom
              }))
            };
          })()`)
          assert.equal(layout.overflow, false)
          assert.deepEqual(layout.outputs.map(item => item.name), ['爱丽丝', '奥黛丽'])
          for (const output of layout.outputs) {
            assert.equal(output.avatars, 1)
            assert.equal(output.files, 1)
            assert.equal(output.actions, 0)
            assert.ok(Math.abs(output.bodyLeft - output.authorLeft - 42) <= 1)
            assert.ok(Math.abs(output.fileLeft - output.bodyLeft) <= 1)
            assert.ok(output.fileTop >= output.bodyBottom)
          }
          assert.deepEqual(layout.outputs.map(item => item.images), [1, 0])
          assert.ok(layout.outputs[0].imageWidth > 100, 'The Runtime image is decoded and visibly sized')
          await capture(`run-artifacts-${theme}-${width}`)
          layouts.push({ theme, width, ...layout })
        }
      }
      await run('document.querySelector(".run-artifact-output .message-author-name-trigger").click()')
      await run('window.campOpenTest.settle()')
      assert.ok(await run('document.querySelector(".mention-profile-popover")?.textContent.includes("爱丽丝")'))
      await run('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
      await run('window.campOpenTest.showRunArtifacts(true)')
      await run('window.campOpenTest.settle()')
      assert.equal(await run('document.querySelectorAll(".run-artifact-output").length'), 1)
      assert.equal(await run('document.querySelectorAll(".timeline-track .member-avatar").length'), 2)
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(JSON.stringify({ ok: true, mode, layouts }))
      app.exit(0)
      return
    }
    if (mode === '--text-evidence') {
      await run('window.campOpenTest.showTextEvidence()')
      await run('window.campOpenTest.settle()')
      await run('document.querySelector(".execution-disclosure summary").click()')
      const waitForText = async (expression) => {
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          await run('window.campOpenTest.settle()')
          if (await run(expression)) return
        }
        assert.fail(`Execution text condition was not reached: ${expression}`)
      }
      await waitForText('Boolean(document.querySelector(".history-load-error button"))')
      await run('document.querySelector(".history-load-error button").click()')
      await waitForText('document.querySelector(".process-content").textContent.includes("LONG_BODY_A_END")')
      const text = await run(`(() => {
        const bodies = [...document.querySelectorAll('.process-copy')].map(node => node.textContent);
        return { bodies: bodies.map(body => ({ length: body.length, start: body.slice(0, 12), tail: body.slice(-15) })),
          hasFailure: Boolean(document.querySelector('.history-load-error')),
          tools: document.querySelectorAll('.tool-activity-group').length,
          privateReasoningVisible: document.body.textContent.includes('HIDDEN_REASONING') };
      })()`)
      assert.equal(text.bodies.length, 3)
      assert.ok(text.bodies[0].length > 30_000 && text.bodies[0].tail.includes('LONG_BODY_A_END'))
      assert.ok(text.bodies[1].start.includes('BODY_B'))
      assert.ok(text.bodies[2].start.includes('BODY_C'))
      assert.equal(text.hasFailure, false)
      assert.equal(text.privateReasoningVisible, false)
      assert.equal(text.tools, 2)
      await capture('execution-text-full-history')
      console.log(JSON.stringify({ ok: true, mode, text }))
      app.exit(0)
      return
    }
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
    assert.ok(attachmentState.userFileWidths.every(width => width <= 220))
    assert.ok(new Set(attachmentState.userFileWidths).size > 1, 'User files use content-sized widths')
    assert.ok(attachmentState.longUserFile, 'Long user attachment fixture is present')
    assert.equal(attachmentState.longUserFile.cardWidth, 220)
    assert.equal(
      attachmentState.longUserFile.title,
      'rovai-file-reference-and-tab-icons-md-doc-code-larger.html'
    )
    assert.ok(attachmentState.longUserFile.nameScrollWidth > attachmentState.longUserFile.nameClientWidth,
      'Long user attachment names are visibly truncated')
    assert.equal(attachmentState.userFileDetails, 0)
    assert.equal(attachmentState.agentFileCount, 10)
    assert.ok(attachmentState.agentOutputWidth > 650, 'Agent deliveries use the full artifact track')
    assert.equal(attachmentState.agentFileGroupLabel, 'Agent 交付文件：10 个')
    assert.equal(attachmentState.agentVisibleHeadingCount, 0, 'File count is accessible without an extra visible heading')
    assert.equal(attachmentState.agentOpenCueDisplay, 'grid')
    assert.equal(attachmentState.agentColumns, 2)
    assert.deepEqual(new Set(attachmentState.agentIconTypes), new Set([
      'type-web', 'type-code', 'type-notes', 'type-pdf', 'type-word', 'type-sheet',
      'type-slide', 'type-image', 'type-archive', 'type-generic'
    ]))
    assert.deepEqual(attachmentState.composerHeights, [48, 48, 48, 48, 48, 48, 48, 48, 48])
    assert.deepEqual(attachmentState.composerImageWidths, [48, 48, 48])
    assert.ok(attachmentState.composerFileWidths.every(width => width >= 172 && width <= 308))
    assert.ok(attachmentState.composerFileWidths.some(width => width !== 220),
      'Composer files no longer use the old fixed width')
    assert.equal(attachmentState.composerText, '请按交互稿核对附件尺寸、顺序、图标和视觉层级。')
    assert.equal(attachmentState.composerOverflow, true)
    assert.equal(attachmentState.composerScrollbar, 'none')
    assert.equal(attachmentState.overflow, false)
    assertUserAttachmentLayout(attachmentState, '1200px Day')
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('ArrowRight')") > 0)
    assert.ok(await run("window.campOpenTest.browseComposerAttachments('Home')") <= 2)
    const wheelResult = await run('window.campOpenTest.wheelComposerAttachments(120)')
    assert.ok(wheelResult.scrollLeft > 0)
    assert.equal(wheelResult.defaultPrevented, true)
    await run("window.campOpenTest.browseComposerAttachments('Home')")
    await run("window.campOpenTest.scrollAttachmentSurface('user')")
    await run('window.campOpenTest.settle()')
    await capture('attachments-day-user-composer')
    for (const [width, height, theme] of [[1040, 700, 'day'], [1440, 920, 'night']]) {
      window.setContentSize(width, height)
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await run("window.campOpenTest.scrollAttachmentSurface('user')")
      await run('window.campOpenTest.settle()')
      const responsiveAttachmentState = await run('window.campOpenTest.attachmentSurfaceState()')
      assert.equal(responsiveAttachmentState.overflow, false, `${width}px ${theme}: no document overflow`)
      assertUserAttachmentLayout(responsiveAttachmentState, `${width}px ${theme}`)
      await capture(`attachments-${theme}-user-layout-${width}`)
    }
    window.setContentSize(1200, 900)
    await run("document.documentElement.dataset.theme = 'day'")
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
      userAttachmentLayout: attachmentState.userLayout,
      cards: appended.cards }))
    window.destroy(); app.quit()
  } catch (error) {
    console.error(errors)
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
