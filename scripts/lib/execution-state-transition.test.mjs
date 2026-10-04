import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

const root = resolve(import.meta.dirname, '../..')

// Production ThreadWorkspace owns the state replacement and bottom-follow behavior.
// A standalone status row cannot detect the resulting card/viewport displacement.
test('execution cards keep their live line anchored and expanded tool groups retain a downward cue', { timeout: 120_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) {
    t.skip('Chrome is not installed; execution geometry acceptance did not run')
    return
  }
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-execution-transition-'))
  const renderer = join(fixture, 'renderer')
  let browser, server
  let passed = false
  const report = []
  try {
    await build({
      configFile: false, root: join(root, 'scripts/fixtures/execution-state-transition'),
      base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: renderer, minify: false }
    })
    server = createServer(async (request, response) => {
      const path = resolve(renderer, '.' + new URL(request.url, 'http://localhost').pathname)
      if (!path.startsWith(renderer + sep)) { response.writeHead(403).end(); return }
      try {
        const body = await readFile(path)
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
        response.end(body)
      } catch { response.writeHead(404).end() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await launchAcceptanceBrowser({ executable: chrome, args: [
      '--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run',
      '--no-default-browser-check', '--remote-debugging-port=0',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'
    ] })
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 920, deviceScaleFactor: 1, mobile: false
    })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await browser.send('Page.navigate', {
      url: `http://127.0.0.1:${server.address().port}/index.html?${new URLSearchParams({ mode: 'inspector', theme: 'day', windowed: '1' })}`
    })
    await browser.wait(`!!window.executionTransition`)
    await browser.evaluate(`document.querySelector('.camp-execution-entry')?.click()`)
    await browser.wait(`!!document.querySelector('.run-pulse-chip[data-agent-id]:not([data-agent-id="__execution_overview__"])')`)
    await browser.evaluate(`document.querySelector('.run-pulse-chip[data-agent-id]:not([data-agent-id="__execution_overview__"])')?.click()`)
    await browser.wait(`document.querySelector('.execution-drawer')?.getBoundingClientRect().width > 0`)
    await browser.wait(`!!document.querySelector('.process-action.current .running-text')`)
    const initialWindowFrame = await browser.evaluate(`(() => {
      const rect = element => element?.getBoundingClientRect().toJSON() ?? null
      return {
        card: rect(document.querySelector('.execution-process-stage')),
        text: rect(document.querySelector('.process-action.current .running-text > span:not(.running-text-highlight)')),
        historyLoader: Boolean(document.querySelector('.execution-history-loader'))
      }
    })()`)
    await browser.capture(join(fixture, 'day-inspector-initial-window.png'))
    await browser.evaluate(`window.executionTransition.resolveWindow()`)
    await browser.wait(`window.executionTransition.windowReady()`)
    await pause(80)
    const settledWindowFrame = await browser.evaluate(`(() => {
      const rect = element => element?.getBoundingClientRect().toJSON() ?? null
      return {
        card: rect(document.querySelector('.execution-process-stage')),
        text: rect(document.querySelector('.process-action.current .running-text > span:not(.running-text-highlight)')),
        historyLoader: Boolean(document.querySelector('.execution-history-loader'))
      }
    })()`)
    const windowFrames = [initialWindowFrame, settledWindowFrame]
    report.push({ label: 'day/inspector/initial-window-load', states: windowFrames })
    assert.equal(initialWindowFrame.historyLoader, false,
      'day/inspector initial window: live connection feedback must not stack a redundant history loader')
    for (const [element, keys] of [['card', ['y', 'height']], ['text', ['x', 'y']]]) {
      for (const key of keys) {
        const values = windowFrames.map(frame => frame[element][key])
        assert.ok(Math.max(...values) - Math.min(...values) <= 1,
          `day/inspector initial window: ${element}.${key} jumps: ${values}`)
      }
    }
    for (const theme of ['day', 'night']) {
      for (const mode of ['bottom', 'inspector', 'mobile']) {
        const label = `${theme}/${mode}`
        await browser.send('Emulation.setDeviceMetricsOverride', {
          width: mode === 'mobile' ? 390 : 1440, height: mode === 'mobile' ? 844 : 920,
          deviceScaleFactor: 1, mobile: mode === 'mobile'
        })
        await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mode === 'mobile' })
        await browser.send('Page.navigate', {
          url: `http://127.0.0.1:${server.address().port}/index.html?${new URLSearchParams({ mode, theme })}`
        })
        await browser.wait('!!window.executionTransition')
        if (mode === 'mobile') await browser.evaluate(`document.querySelector('.mobile-camp-tabs [data-detail="execution"]')?.click()`)
        if (mode === 'inspector') await browser.evaluate(`document.querySelector('.camp-execution-entry')?.click()`)
        await browser.wait(`!!document.querySelector('.run-pulse-chip[data-agent-id]:not([data-agent-id="__execution_overview__"])')`)
        await browser.evaluate(`document.querySelector('.run-pulse-chip[data-agent-id]:not([data-agent-id="__execution_overview__"])')?.click()`)
        await browser.wait(`document.querySelector('.execution-drawer')?.getBoundingClientRect().width > 0`)
        const states = []
        for (const [phase, text] of [['connecting', '思考中'], ['thinking', '思考中'], ['body', '开始检查。']]) {
          await browser.evaluate(`window.executionTransition.setPhase('${phase}')`)
          await browser.wait(`document.querySelector('.process-content')?.textContent.includes('${text}') === true`)
          await pause(200) // Allow the production ResizeObserver and bottom-follow frame to settle.
          states.push(await browser.evaluate(`(() => {
            const text = document.querySelector('.process-action.current .running-text > span:not(.running-text-highlight), .process-copy p')
            const range = document.createRange()
            range.selectNodeContents(text)
            return { phase: '${phase}', card: document.querySelector('.execution-process-stage').getBoundingClientRect().toJSON(), text: range.getBoundingClientRect().toJSON() }
          })()`))
          await browser.capture(join(fixture, `${theme}-${mode}-${phase}.png`))
        }
        report.push({ label, states })
        for (const [element, keys] of [['card', ['y', 'height']], ['text', ['x', 'y']]]) {
          for (const key of keys) {
            const values = states.map(state => state[element][key])
            assert.ok(Math.max(...values) - Math.min(...values) <= 1,
              `${label}: ${element}.${key} jumps across connecting → thinking → first narration: ${values}`)
          }
        }
        await browser.evaluate(`window.executionTransition.setPhase('tools')`)
        await browser.wait(`!!document.querySelector('.tool-activity-group > summary .command-expand-cue')`)
        await browser.evaluate(`{ const details = document.querySelector('.tool-activity-group'); if (details) details.open = true }`)
        await browser.wait(`document.querySelector('.tool-activity-group')?.open && !!document.querySelector('.tool-group-items .tool-call-disclosure')`)
        await browser.evaluate('document.activeElement.blur()')
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
        await browser.wait(`getComputedStyle(document.querySelector('.tool-activity-group > summary .command-expand-cue')).opacity === '1'`)
        await browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
        await pause(200)
        const cue = await browser.evaluate(`(() => {
          const cue = document.querySelector('.tool-activity-group > summary .command-expand-cue')
          return { opacity: getComputedStyle(cue).opacity, transform: getComputedStyle(cue.querySelector('svg')).transform }
        })()`)
        assert.equal(cue.opacity, '1', `${label}: expanded cue disappears without hover/focus`)
        assert.equal(cue.transform, 'matrix(0, 1, -1, 0, 0, 0)', `${label}: cue must point down`)
        await browser.capture(join(fixture, `${theme}-${mode}-expanded.png`))
        await browser.evaluate(`{ const details = document.querySelector('.tool-group-items .tool-call-disclosure'); if (details) details.open = true }`)
        await browser.wait(`document.querySelector('.tool-group-items .tool-call-disclosure')?.open === true`)
        assert.equal(await browser.evaluate(`document.querySelector('.tool-activity-group').open`), true,
          `${label}: child disclosure must not collapse its group`)
        await browser.evaluate(`{ const details = document.querySelector('.tool-activity-group'); if (details) details.open = false }`)
        await browser.wait(`document.querySelector('.tool-activity-group')?.open === false`)
      }
    }
    assert.deepEqual(browser.errors, [])
    passed = true
  } finally {
    await writeFile(join(fixture, 'measurements.json'), JSON.stringify(report, null, 2))
    await browser?.close()
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    if (!passed || process.env.ROVAI_KEEP_EXECUTION_TRANSITION_FIXTURE === '1') {
      console.log(`Preserved execution transition evidence: ${fixture}`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
