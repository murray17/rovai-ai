import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'

const repo = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')

test('Markdown tables copy complete rich/plain cells with accessible controls and honest recovery', { timeout: 120_000 }, async t => {
  if (!await access(chrome).then(() => true, () => false)) { t.skip('Chrome is not installed'); return }
  const root = await mkdtemp(join(tmpdir(), 'rovai-table-copy-'))
  const out = process.env.ROVAI_TABLE_COPY_OUTPUT ?? join(root, 'evidence')
  let b
  t.after(async () => { await b?.close(); await rm(root, { recursive: true, force: true }) })
  await mkdir(out, { recursive: true })
  await promisify(execFile)(process.execPath, [join(repo, 'scripts/fixtures/markdown-code-copy/build.mjs'), root])
  b = await launchAcceptanceBrowser({ executable: chrome, args: [
    '--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'
  ] })
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  await b.send('Page.navigate', { url: pathToFileURL(join(root, 'markdown-code-copy.html')).href + '?table' })
  await b.wait('!!window.__tableCopy && document.querySelectorAll(".markdown-table-copy").length === 2')
  const button = '.table-message .markdown-table-copy'
  const frame = '.table-message .markdown-table-frame'
  const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
  const copied = selector => b.wait(`document.querySelector(${JSON.stringify(selector)})?.dataset.copyState === 'copied'`)
  const idle = () => b.wait(`document.querySelector('${frame}').dataset.copyState === 'idle'`)
  const text = () => b.evaluate('navigator.clipboard.readText()')
  const before = await b.evaluate('({ quote: __tableCopy.quote(), find: __tableCopy.find() })')
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('${frame} .markdown-table-corner')).opacity`), '0')
  await click(button); await copied(frame)
  const expected = '场景\t当前处理\t调整后处理\n邮件包含付款记录\t写入 payment_report，保存金额与币种\t同时保存邮件编号，便于追溯\ncompanyCode=null\t在 classify 阶段跳过，其他账户继续处理\t记录原因，标记为待核对\n账户不在白名单\t跳过，不入库\t保留原始记录，等待配置更新\n同一邮件重复到达\t依据 messageId 去重\t返回已有结果，避免重复入库'
  assert.equal(await text(), expected)
  assert.deepEqual(await b.evaluate('({ quote: __tableCopy.quote(), find: __tableCopy.find() })'), before)
  const html = await b.evaluate('(async () => { const item = (await navigator.clipboard.read())[0]; return (await item.getType("text/html")).text() })()')
  assert.match(html, /<table/)
  assert.match(html, /<code>payment_report<\/code>/)
  assert.match(html, /<strong>待核对<\/strong>/)
  assert.doesNotMatch(html, /复制|data-|button|svg/)
  await click('.table-document .markdown-table-copy'); await copied('.table-document .markdown-table-frame')
  assert.equal(await text(), '项目\t说明\n行列与格式\t"一\n二，带有 ""引号"""\n代码 与链接\t参考文档')
  await idle()
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await b.evaluate('document.activeElement.blur()')
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('${frame} .markdown-table-corner')).opacity`), '0')
  // Tab enters the scroll region, then its adjacent copy button without a pointer.
  await b.evaluate(`document.querySelector('${frame} .markdown-table-scroll').focus()`)
  await b.key('Tab')
  assert.equal(await b.evaluate(`document.activeElement === document.querySelector('${button}')`), true)
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('${frame} .markdown-table-corner')).opacity`), '1')
  await b.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' })
  await b.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 })
  await copied(frame)
  assert.equal(await text(), expected)

  await idle()
  for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
    await b.evaluate(`document.documentElement.dataset.themeId='${theme}'; document.documentElement.dataset.theme='${['night', 'ember'].includes(theme) ? 'night' : 'day'}'`)
    assert.deepEqual(await b.evaluate(`(() => { const e=document.querySelector('${frame} th'), s=getComputedStyle(e);return { background:s.backgroundColor, left:s.borderLeftWidth, bottom:s.borderBottomWidth } })()`),
      { background: 'rgba(0, 0, 0, 0)', left: '0px', bottom: '1px' })
    await b.capture(join(out, `${theme}.png`))
  }
  await b.evaluate('document.documentElement.dataset.themeId="day";document.documentElement.dataset.theme="day"')
  // Wide cells stay scrollable while the button stays outside the scroll viewport.
  await b.evaluate('__tableCopy.setSource("| 名称 | 完整内容 |\\n| --- | --- |\\n| 长内容 | " + "very_long_identifier_".repeat(35) + " |")')
  await b.wait(`document.querySelector('${frame} td:last-child').textContent.includes('very_long_identifier_')`)
  await b.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await idle()
  const corner = await b.evaluate(`document.querySelector('${button}').getBoundingClientRect().x`)
  assert.equal(await b.evaluate(`(() => { const e=document.querySelector('${frame} .markdown-table-scroll');e.scrollLeft=e.scrollWidth;return e.scrollLeft>0 })()`), true)
  assert.equal(await b.evaluate(`document.querySelector('${button}').getBoundingClientRect().x`), corner)
  await click(button); await copied(frame)
  assert.equal(await text(), '名称\t完整内容\n长内容\t' + 'very_long_identifier_'.repeat(35))
  for (const width of [1040, 2560, 520, 390]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await b.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
  }
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await b.evaluate('document.activeElement.blur()')
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await idle()
  assert.deepEqual(await b.evaluate(`(() => {const e=document.querySelector('${button}'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,opacity:getComputedStyle(e.parentElement).opacity}})()`), { width:44, height:44, opacity:'1' })
  await b.capture(join(out, 'touch-390.png'))
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 700, deviceScaleFactor: 1, mobile: false })

  // Exercise all existing clipboard fallback paths and the visible failure/retry.
  await b.evaluate(`window.originalWrite=navigator.clipboard.write.bind(navigator.clipboard); window.originalExec=document.execCommand.bind(document);
    navigator.clipboard.write=async()=>{throw Error('denied')}; document.execCommand=()=>false;`)
  await click(button)
  await b.wait(`document.querySelector('${frame}').dataset.copyState === 'failed'`)
  assert.equal(await b.evaluate(`!!document.querySelector('${frame} [role="alert"]')`), true)
  await b.capture(join(out, 'failed.png'))
  await b.evaluate('navigator.clipboard.write=window.originalWrite;document.execCommand=window.originalExec')
  await click(button); await copied(frame)
  assert.equal(await b.evaluate(`!!document.querySelector('${frame} [role="alert"]')`), false)
  await b.evaluate(`window.rovai={clipboard:{write: data => new Promise(resolve => {window.finishTableCopy=resolve;window.copiedTableData=data})}}`)
  await click(button)
  await b.wait(`document.querySelector('${button}').disabled`)
  await b.evaluate('__tableCopy.setSource("| 新表格 |\\n| --- |\\n| 新内容 |")')
  await idle()
  await b.evaluate('finishTableCopy();delete window.rovai')
  assert.equal(await b.evaluate(`document.querySelector('${frame}').dataset.copyState`), 'idle')
  await click(button); await copied(frame)
  assert.equal(await text(), '新表格\n新内容')
  await b.evaluate('__tableCopy.language("en")')
  await idle()
  assert.equal(await b.evaluate(`document.querySelector('${button}').getAttribute('aria-label')`), 'Copy table')
  assert.deepEqual(b.errors, [])
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed:true, assertions:'HTML + TSV, formatted cells, newlines/quotes, quote/find exclusion, hover, keyboard, themes, overflow, touch, failure/retry, streaming race, locale' }, null, 2))
})
