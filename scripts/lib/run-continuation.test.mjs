import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildHostWebParity } from '../review-host-web-parity.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'

test('production continuation action preserves source, reconciles lost receipts and confirms session replacement', { timeout: 90_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-continuation-ui-'))
  let browser
  try {
    const artifact = await buildHostWebParity(join(fixture, 'artifact'))
    browser = await launchAcceptanceBrowser({
      executable: process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--headless=new', `--user-data-dir=${join(fixture, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank']
    })
    const url = pathToFileURL(artifact.productPath)
    url.search = 'scenario=continuation&surface=web&theme=day'
    await browser.send('Page.navigate', { url: url.href })
    await browser.wait('window.continuationFixture !== undefined')
    await browser.wait('document.querySelector(".camp-execution-entry") !== null')
    await browser.click('document.querySelector(".camp-execution-entry")')
    await browser.wait('document.querySelector(".run-pulse-chip") !== null')
    await browser.click('document.querySelector(".run-pulse-chip")')
    await browser.wait('document.querySelector(".execution-continue") !== null')
    const button = 'document.querySelector(".execution-continue")'
    const model = 'window.continuationFixture'
    const original = await browser.evaluate(`JSON.stringify(${model}.get().snapshot.agentRuns)`)
    const draft = await browser.evaluate('document.querySelector("[contenteditable=true]").textContent')
    assert.deepEqual(await browser.evaluate(`(() => { const b=${button}, r=b.getBoundingClientRect(); return [r.width,r.height,b.textContent,b.getAttribute('aria-label')] })()`), [24, 24, '', '继续执行'])
    if (process.env.ROVAI_CONTINUATION_UI_OUTPUT) {
      await mkdir(process.env.ROVAI_CONTINUATION_UI_OUTPUT, { recursive: true })
      await browser.capture(join(process.env.ROVAI_CONTINUATION_UI_OUTPUT, 'continuation-card.png'))
    }
    await browser.evaluate(`${model}.continuation.hold=true; ${button}.focus()`)
    assert.equal(await browser.evaluate(`document.activeElement === ${button}`), true)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait(`${button}.disabled`)
    await browser.evaluate(`${button}.click()`)
    await browser.evaluate(`${model}.continuation.hold=false`)
    await browser.wait(`!${button}.disabled`)
    assert.equal(await browser.evaluate(`${model}.continuation.attempts.length`), 1)
    await browser.click(button)
    await browser.wait(`${model}.continuation.receipts.size === 2`)
    assert.equal(await browser.evaluate(`JSON.stringify(${model}.get().snapshot.agentRuns)`), original)
    assert.equal(await browser.evaluate('document.querySelector("[contenteditable=true]").textContent'), draft)

    await browser.evaluate(`${model}.continuation.mode='response-lost'`)
    await browser.click(button)
    await browser.wait(`${button}.getAttribute('aria-label') === '确认提交结果'`)
    await browser.click(button)
    await browser.wait(`${button}.getAttribute('aria-label') === '继续执行'`)
    assert.equal(await browser.evaluate(`${model}.continuation.receipts.size`), 3)
    assert.equal(await browser.evaluate(`${model}.continuation.attempts.at(-1).commandId === ${model}.continuation.attempts.at(-2).commandId`), true)

    await browser.evaluate(`${model}.continuation.mode='new-session'`)
    await browser.click(button)
    await browser.wait('document.querySelector(".app-dialog") !== null')
    assert.match(await browser.evaluate('document.querySelector(".app-dialog").textContent'), /当前工作区会保留/)
    assert.equal(await browser.evaluate(`${model}.continuation.receipts.size`), 3)
    if (process.env.ROVAI_CONTINUATION_UI_OUTPUT) await browser.capture(join(process.env.ROVAI_CONTINUATION_UI_OUTPUT, 'continuation-session.png'))
    await browser.click('document.querySelector("[data-dialog-autofocus]")')
    await browser.wait('document.querySelector(".app-dialog") === null')
    assert.equal(await browser.evaluate(`${model}.continuation.receipts.size`), 4)
    assert.equal(await browser.evaluate(`${model}.continuation.attempts.at(-1).command.useNewSession`), true)
    assert.equal(await browser.evaluate(`JSON.stringify(${model}.get().snapshot.agentRuns)`), original)
    assert.deepEqual(browser.errors, [])
  } catch (error) {
    if (browser) console.error(await browser.evaluate(`({attempts:window.continuationFixture?.continuation.attempts, errors:document.body.innerText.slice(-600)})`), browser.errors)
    throw error
  } finally {
    await browser?.close()
    await rm(fixture, { recursive: true, force: true })
  }
})
