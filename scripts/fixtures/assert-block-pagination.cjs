const assert = require('node:assert/strict')

module.exports = async function assertBlockPagination(window, run, capture) {
  const waitFor = async expression => {
    const deadline = Date.now() + 5000
    do {
      await run('window.campOpenTest.settle()')
      if (await run(expression)) return
    } while (Date.now() < deadline)
    const state = await run('window.campOpenTest.executionWindowState()')
    assert.fail(`${expression}: ${JSON.stringify(state)}`)
  }
  const open = async (scene, placement) => {
    await run(`window.campOpenTest.showBlockPagination('${scene}', '${placement}')`)
    await waitFor('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]") !== null')
    await run('document.querySelector("button[aria-label^=打开][aria-label*=执行过程]").click()')
    await waitFor('document.querySelector(".tool-activity-group") !== null')
  }
  const scroll = expression => run(`(() => {
    const host = document.querySelector('.execution-drawer-body')
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))
    ${expression}
  })()`)
  const report = []
  for (const placement of ['bottom', 'inspector']) {
    await open('short', placement)
    await waitFor('Number(document.querySelector(".process-content").dataset.executionLoadedCount) === 14')
    let state = await run('window.campOpenTest.executionWindowState()')
    assert.ok(state.requests.length <= 4, 'initial fill has a bounded request budget')
    assert.equal(state.groupRequests.length, 0, 'folded groups perform no child reads')
    assert.equal(state.toolRows, 0)
    await capture(`block-first-fill-${placement}`)
    await open('sparse', placement)
    await run('document.querySelector(".tool-group-summary").click()')
    await waitFor('Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded) === 96')
    assert.equal((await run('window.campOpenTest.executionWindowState()')).toolRows, 0)
    await scroll('')
    await waitFor('Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded) > 96')
    await open('failure', placement)
    await waitFor('document.querySelector(".execution-history-loader.is-error") !== null')
    const failed = await run(`(() => {
      const host = document.querySelector('.execution-drawer-body').getBoundingClientRect()
      const retry = document.querySelector('.execution-history-loader.is-error button').getBoundingClientRect()
      return { top: retry.top, bottom: retry.bottom, hostTop: host.top, hostBottom: host.bottom }
    })()`)
    assert.ok(failed.top >= failed.hostTop && failed.bottom <= failed.hostBottom, 'automatic fill failure exposes the retry control')
    const before = (await run('window.campOpenTest.executionWindowState()')).requests.length
    await run('new Promise(resolve => setTimeout(resolve, 200))')
    assert.equal((await run('window.campOpenTest.executionWindowState()')).requests.length, before, 'failed fill does not spin')
    await run('window.campOpenTest.failExecutionRead(false); document.querySelector(".execution-history-loader.is-error button").click()')
    await waitFor('document.querySelector(".execution-history-loader.is-error") === null')
    await open('long', placement)
    state = await run('window.campOpenTest.executionWindowState()')
    assert.equal(state.requests.length, 1)
    assert.equal(state.groupRequests.length, 0)
    assert.equal(await run('Number(document.querySelector(".process-content").dataset.executionLoadedCount)'), 1)
    assert.match(await run('document.querySelector(".tool-group-summary").getAttribute("aria-label")'), /120/)
    await run('document.querySelector(".tool-group-summary").click()')
    await waitFor('Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded) >= 24')
    state = await run('window.campOpenTest.executionWindowState()')
    assert.ok(state.toolRows > 0 && state.toolRows <= 48)
    assert.equal(state.contentReads.length, 0)
    assert.equal(state.requests.length, 1, 'child navigation does not page the main timeline')
    const loaded = await run('Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded)')
    await run('window.campOpenTest.failExecutionRead(true)')
    await scroll('host.scrollTop = host.scrollHeight')
    await waitFor('document.querySelector(".execution-group-loader.is-error") !== null')
    assert.equal(await run('Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded)'), loaded)
    await run('window.campOpenTest.failExecutionRead(false); document.querySelector(".execution-group-loader.is-error button").click()')
    await waitFor(`Number(document.querySelector(".tool-activity-group").dataset.executionGroupLoaded) > ${loaded}`)
    const cached = await run('window.campOpenTest.executionWindowState()')
    await run('document.querySelector(".tool-group-summary").click()')
    await run('window.campOpenTest.settle()')
    await run('document.querySelector(".tool-group-summary").click()')
    await run('window.campOpenTest.settle()')
    assert.equal((await run('window.campOpenTest.executionWindowState()')).groupRequests.length, cached.groupRequests.length, 'collapse and reopen retains child pages')
    assert.equal(await run('document.querySelector(".tool-group-items").scrollHeight > document.querySelector(".tool-group-items").clientHeight && getComputedStyle(document.querySelector(".tool-group-items")).overflowY === "auto"'), false, 'children use the Run scroll container')
    assert.equal((await run('window.campOpenTest.executionWindowState()')).overflow, false)
    await capture(`block-command-pages-${placement}`)
    report.push({ placement, outerReads: cached.requests.length, childReads: cached.groupRequests.length, childRows: cached.toolRows })
  }
  return report
}
