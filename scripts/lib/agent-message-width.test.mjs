import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'

const root = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_BROWSER_PATH ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')

test('public message widths follow their own content and recover on resize/replacement', { timeout: 90_000 }, async t => {
  if (!await access(chrome).then(() => true, () => false)) { t.skip('Chrome not installed'); return }
  const temporary = await mkdtemp(join(tmpdir(), 'rovai-agent-message-width-'))
  let browser
  t.after(async () => { await browser?.close(); await rm(temporary, { recursive: true, force: true }) })
  await promisify(execFile)(process.execPath, ['scripts/fixtures/agent-message-width/build.mjs', join(temporary, 'page')], { cwd: root })
  const b = await launchAcceptanceBrowser({ executable: chrome, args: [
    '--headless=new', `--user-data-dir=${join(temporary, 'profile')}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'
  ] })
  browser = b
  const settle = () => b.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))')
  const viewport = async width => { await b.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false }); await settle() }
  await b.send('Page.navigate', { url: pathToFileURL(join(temporary, 'page/index.html')).href })
  await b.wait('window.widthFixture && document.querySelector(".agent-message-content")?.style.getPropertyValue("--agent-message-artifact-width")')
  await viewport(2560)
  const read = () => b.evaluate(`(() => Object.fromEntries([...document.querySelectorAll('[data-fixture-id]')].map(row => {
    const bubble=row.querySelector('.agent-message-content'), p=row.querySelector('.safe-markdown p');
    const table=row.querySelector('.markdown-table-scroll'), pre=row.querySelector('pre');
    return [row.dataset.fixtureId,{ bubble:bubble.getBoundingClientRect().width, text:p.getBoundingClientRect().width,
      right:bubble.getBoundingClientRect().right, track:row.closest('.timeline-track').getBoundingClientRect().right,
      tableScroll:table ? table.scrollWidth-table.clientWidth : 0, codeScroll:pre ? pre.scrollWidth-pre.clientWidth : 0,
      rowHeight:row.querySelector('tr')?.getBoundingClientRect().height ?? 0 }]
  })))()`)
  const change = async (scene, quoted = true) => {
    await b.evaluate(`widthFixture.setMiddle(${JSON.stringify(scene)}); widthFixture.setQuote(${quoted})`)
    await settle()
    const rows = await read()
    assert.ok(Math.abs(rows.middle.bubble - rows.middle.text - 26) < 1, `${scene}: text follows bubble`)
    assert.ok(rows.middle.right <= rows.middle.track + 1, `${scene}: stays inside conversation`)
    assert.equal(rows.before.bubble, rows.after.bubble, `${scene}: siblings independent`)
    return rows.middle
  }
  const wide = (await read()).middle
  assert.equal(wide.text, 780)
  const quoted = await change('prose')
  assert.equal(quoted.bubble, wide.bubble)
  assert.equal((await change('smallTable')).bubble, wide.bubble)
  assert.equal((await change('shortCode')).bubble, wide.bubble)
  const table = await change('wideTable')
  assert.ok(table.text > 780)
  assert.ok(table.text <= 930)
  await b.evaluate('widthFixture.setAttachments(true)')
  assert.equal((await change('wideTable')).bubble, table.bubble, 'attachments cannot reapply the old prose clamp')
  assert.equal((await change('prose')).text, 780)
  await b.evaluate('widthFixture.setAttachments(false)')
  const huge = await change('hugeTable')
  assert.equal(huge.text, 930)
  assert.ok(huge.tableScroll > 0)
  const code = await change('longCode')
  assert.equal(code.text, 930)
  assert.ok(code.codeScroll > 0)
  assert.equal((await change('shortCode')).bubble, wide.bubble, 'wide code replacement shrinks')
  assert.equal((await change('smallTable')).bubble, wide.bubble, 'wide table replacement shrinks')
  assert.ok((await change('short')).bubble < 300, 'quote cannot stretch a short response')
  await b.evaluate('widthFixture.setMention(true)')
  assert.equal((await change('prose')).text, 780, 'structured-message bubble follows same policy')
  await viewport(1440)
  const compact = await change('prose')
  assert.ok(compact.text > 600 && compact.text < 650)
  await viewport(2560)
  assert.equal((await change('prose')).text, 780)
  await viewport(1440)
  assert.equal((await change('prose')).text, compact.text)
  await viewport(1040)
  await change('hugeTable')
  await b.evaluate('document.documentElement.style.setProperty("--fixture-pane-width", "420px")')
  const narrow = await change('wideTable')
  assert.ok(narrow.tableScroll > 0)
  assert.ok(narrow.rowHeight < 60)
  await b.evaluate('document.documentElement.dataset.theme="night"; document.documentElement.style.setProperty("--chat-font-size", "16px")')
  await change('longCode')
  await b.evaluate('document.documentElement.style.removeProperty("--fixture-pane-width"); document.documentElement.style.removeProperty("--chat-font-size")')
  await viewport(2560)
  await change('wideTable')
  if (process.env.ROVAI_MESSAGE_WIDTH_EVIDENCE) {
    await mkdir(process.env.ROVAI_MESSAGE_WIDTH_EVIDENCE, { recursive: true })
    await b.capture(join(process.env.ROVAI_MESSAGE_WIDTH_EVIDENCE, 'night-wide.png'))
    await b.evaluate('document.documentElement.dataset.theme="day"')
    await settle()
    await b.capture(join(process.env.ROVAI_MESSAGE_WIDTH_EVIDENCE, 'day-wide.png'))
  }
  assert.deepEqual(b.errors, [])
})
