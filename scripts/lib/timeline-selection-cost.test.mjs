import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('composer caret work skips history measurement and releases an old selection once', { timeout: 90_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome unavailable; timeline cost acceptance did not run')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-timeline-cost-'))
  const out = process.env.ROVAI_TIMELINE_COST_OUTPUT ?? join(fixture, 'report')
  const baseline = process.env.ROVAI_TIMELINE_COST_BASELINE === '1'
  await mkdir(out, { recursive: true })
  let b
  try {
    await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), fixture],
      { env: { ...process.env, ROVAI_FIXTURE_MEASURE_TIMELINE: '1' } })
    b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(fixture, 'profile')}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await b.send('Page.navigate', { url: pathToFileURL(join(fixture, 'rovai-teammate-presence.html')).href + '?pure=1&historyScale=1000' })
    await b.wait('!!window.__timelineCost?.timelineUpdate && !!document.querySelector("[data-message-id=long-1000]")')
    await b.click('document.querySelector("[contenteditable=true]")')
    await b.send('Input.insertText', { text: 'x' })
    await pause(600)
    const reset = () => b.evaluate('void (window.__timelineCost={})')
    const costs = () => b.evaluate('structuredClone(window.__timelineCost)')
    const keys = async () => {
      for (let i = 0; i < 20; i++) {
        await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', windowsVirtualKeyCode: 65 })
        await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
        await pause(70)
      }
      await pause(200)
    }
    await reset(); await keys()
    const input = await costs()
    assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), 'x' + 'a'.repeat(20))
    if (!baseline) assert.equal(input.timelineUpdate?.calls ?? 0, 0, `ordinary input measured history: ${JSON.stringify(input)}`)
    await reset()
    for (let i = 0; i < 10; i++) {
      const key = i % 2 ? 'ArrowRight' : 'ArrowLeft'
      const code = i % 2 ? 39 : 37
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
      assert.equal(await b.evaluate('getSelection().anchorOffset'), i % 2 ? 21 : 20, 'the caret must actually move')
      await pause(70)
    }
    await pause(200)
    const caret = await costs()
    if (!baseline) assert.equal(caret.timelineUpdate?.calls ?? 0, 0, `composer caret measured history: ${JSON.stringify(caret)}`)
    await b.evaluate(`(() => {
      const row=document.querySelector('.timeline-scroll [data-message-id]');
      window.selectedCostRow=row;row.focus({preventScroll:true});
      const range=document.createRange();range.selectNodeContents(row.querySelector('.message-surface'));
      getSelection().removeAllRanges();getSelection().addRange(range);
    })()`)
    await pause(150)
    await b.evaluate('document.querySelector(".timeline-scroll").scrollTop=0')
    await pause(300)
    assert.equal(await b.evaluate('selectedCostRow.isConnected'), true, 'selected history must stay mounted')
    await reset()
    await b.click('document.querySelector("[contenteditable=true]")')
    await pause(350)
    const released = await costs()
    assert.equal(await b.evaluate('selectedCostRow.isConnected'), false, 'returning to composer releases the old selection')
    await reset(); await keys()
    const afterRelease = await costs()
    if (!baseline) assert.equal(afterRelease.timelineUpdate?.calls ?? 0, 0, 'subsequent composer input must stay local')
    const result = { baseline, sourceRef: process.env.ROVAI_FIXTURE_BASE_REF ?? 'working-tree', input, caret, released, afterRelease }
    await writeFile(join(out, 'measurement.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    assert.deepEqual(b.errors, [])
  } finally { await b?.close(); await rm(fixture, { recursive: true, force: true }) }
})
