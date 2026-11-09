import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('sidebar exports complete history through the existing preview without changing the browsing window', { timeout: 240_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome is not installed')
  const root = await mkdtemp(join(tmpdir(), 'rovai-conversation-export-'))
  await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
  console.log(JSON.stringify({ channel: 'automatic_acceptance', userData: join(root, 'profile'), core: false, runtime: false, skillLibrary: 'unused' }))
  const b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
  const click = async selector => { await b.click(`document.querySelector(${JSON.stringify(selector)})`); await pause(80) }
  const button = async (scope, text) => { await b.click(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`); await pause(80) }
  const currentRow = 'document.querySelector(`[data-thread-id="${__presence.getState().snapshot.thread.id}"]`)'
  const openMenu = async (method = 'more', row = currentRow) => {
    if (method === 'more') await b.click(`${row}.querySelector('.camp-menu-trigger')`)
    else if (method === 'right') {
      const point = await b.evaluate(`(()=>{const r=${row}.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', clickCount: 1, ...point })
      await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', clickCount: 1, ...point })
    } else if (method === 'long') {
      await b.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await pause(80)
      const point = await b.evaluate(`(()=>{const r=${row}.querySelector('.camp-nav-open').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] })
      await pause(570)
      await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await b.evaluate(`${row}.querySelector('.camp-nav-open').focus()`)
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: method === 'f10' ? 'F10' : 'ContextMenu',
        code: method === 'f10' ? 'F10' : 'ContextMenu', windowsVirtualKeyCode: method === 'f10' ? 121 : 93, modifiers: method === 'f10' ? 8 : 0 })
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: method === 'f10' ? 'F10' : 'ContextMenu', code: method === 'f10' ? 'F10' : 'ContextMenu' })
    }
    await b.wait('!!document.querySelector(".sidebar-action-menu")')
  }
  const chooseExport = async () => {
    await b.click('[...document.querySelectorAll(".sidebar-action-menu-item")].find(e=>e.textContent.trim()==="导出会话")')
    await b.wait('!!document.querySelector(".message-export-dialog")')
  }
  const ready = count => b.wait(`document.querySelectorAll('.message-export-entry').length===${count} && !document.querySelector('.message-export-preview[aria-busy=true]')`, 20_000)
  const close = async () => { await b.key('Escape'); await b.wait('!document.querySelector(".message-export-dialog")'); await pause(80) }
  const download = async (label, readText = true) => {
    const count = await b.evaluate('__downloads.length')
    await button('.message-export-dialog', label)
    await b.wait(`__downloads.length===${count + 1}`, 30_000)
    return b.evaluate(readText ? '__downloads.at(-1).blob.text()' : '__downloads.at(-1).blob.size')
  }
  try {
    await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + '?export=1&pure=1' })
    await b.wait('!!window.__presence && !!document.querySelector(".camp-nav-row")')
    await b.evaluate(`window.__downloads=[];const original=URL.createObjectURL.bind(URL),blobs=new Map();URL.createObjectURL=blob=>{const url=original(blob);blobs.set(url,blob);return url};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){__downloads.push({name:this.download,blob:blobs.get(this.href)});return}click.call(this)}`)
    await b.evaluate('__presence.showFullExportCase(8,"tail")')
    const entryChecks = []
    for (const method of ['more', 'right', 'f10', 'context', 'long']) {
      console.log(`Checking sidebar export entry: ${method}`)
      await openMenu(method)
      const labels = await b.evaluate('[...document.querySelectorAll(".sidebar-action-menu-item")].map(e=>e.textContent.trim())')
      assert.deepEqual(labels, ['置顶', '标记未读', '重命名', '复制会话 ID', '导出会话', '删除'])
      await chooseExport(); await ready(6)
      assert.equal(await b.evaluate('document.querySelectorAll(".message-export-dialog").length'), 1)
      await close()
      if (method === 'long') await b.send('Emulation.setTouchEmulationEnabled', { enabled: false })
      assert.equal(await b.evaluate('document.activeElement.classList.contains("camp-nav-open")'), true)
      entryChecks.push({ method, labels })
    }
    // Browsing and new arrivals do not implicitly expand an explicit local selection.
    await b.evaluate('__presence.showFullExportCase(50,"gapped")')
    await click('.message-select-button')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-check input:checked").length'), 1)
    await b.evaluate('__presence.revealExportHistory()')
    await b.wait('document.querySelectorAll(".message-export-check input").length===48')
    await b.evaluate('__presence.appendExportMessage(true)')
    await b.wait('document.querySelectorAll(".message-export-check input").length===49')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-check input:checked").length'), 1)
    await b.key('Escape')
    await b.evaluate('__presence.showFullExportCase(500,"gapped")')
    console.log('Checking complete export from a gapped browsing window')
    await pause(120)
    const browsingBefore = await b.evaluate('[...document.querySelectorAll(".conversation-bubble[data-message-id]")].map(e=>e.dataset.messageId)')
    const draft = await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
    await openMenu(); await chooseExport(); await ready(498)
    assert.equal(await b.evaluate('document.querySelector(".message-export-title").textContent.trim()'), '消息导出')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-entry:first-of-type").length'), 1)
    assert.ok((await b.evaluate('document.querySelector(".message-export-document").textContent')).includes('回复 你 · @爱丽丝'))
    assert.ok((await b.evaluate('document.querySelector(".message-export-document").textContent')).includes('旧关联输出.png'))
    assert.ok((await b.evaluate('document.querySelector(".message-export-document").textContent')).includes('报告.pdf'))
    await b.wait('document.querySelectorAll("[data-export-message-id=export-code] .message-export-attachment img").length===2')
    const htmlBytes = await download('下载 HTML', false)
    const html = await b.evaluate('(async()=>{const html=await __downloads.at(-1).blob.text(),doc=new DOMParser().parseFromString(html,"text/html");return {count:doc.querySelectorAll(".message-export-entry").length,embedded:html.includes("data:image/png;base64,"),excluded:!["已撤回正文不导出","系统记录不导出","private-thread-id","private-mission-id"].some(text=>html.includes(text))}})()')
    assert.equal(html.count, 498); assert.ok(html.embedded && html.excluded)
    await button('.message-export-dialog', 'Markdown')
    const markdown = await download('下载 Markdown')
    assert.ok(markdown.includes('历史正文 250') && markdown.includes('历史正文 500') && markdown.includes('旧关联输出'))
    assert.equal((markdown.match(/^### /gm) ?? []).length, 498)
    await button('.message-export-dialog', '图片 PNG'); await button('.message-export-dialog', '下载 PNG')
    await b.wait('document.querySelector(".message-export-error")?.textContent.includes("长图过长")')
    assert.equal(await b.evaluate('__downloads.length'), 2)
    await close()
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".conversation-bubble[data-message-id]")].map(e=>e.dataset.messageId)'), browsingBefore)
    assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), draft)
    await b.evaluate('__presence.showFullExportCase(500,"all")')
    await openMenu(); await chooseExport(); await ready(498); await button('.message-export-dialog', 'Markdown')
    assert.equal(await download('下载 Markdown'), markdown, 'Loading history in the UI cannot change the full export')
    await close()

    await b.evaluate('__presence.showFullExportCase(1240,"tail")')
    console.log('Checking more than 1000 messages')
    await openMenu(); await chooseExport(); await ready(1238)
    const sequences = await b.evaluate('[...document.querySelectorAll(".message-export-entry")].map(e=>e.dataset.exportMessageId)')
    assert.equal(new Set(sequences).size, 1238)
    assert.equal(sequences.at(-1), 'history-1240')
    assert.equal(await b.evaluate('__presence.controls.exportReads.filter(r=>r.method==="thread.messages.page").length'), 13)
    await button('.message-export-dialog', 'Markdown')
    const longMarkdown = await download('下载 Markdown')
    assert.equal((longMarkdown.match(/^### /gm) ?? []).length, 1238)
    assert.ok(longMarkdown.includes('历史正文 1240'))
    await close()

    // Exporting another sidebar row does not activate it, discard a draft, or replace the current timeline.
    await b.evaluate('__presence.showFullExportCase(8,"tail")')
    const active = await b.evaluate('document.querySelector(".camp-nav-open[aria-current=page]").closest("[data-thread-id]").dataset.threadId')
    await openMenu('more', 'document.querySelector("[data-thread-id=demo-thread-0]")'); await chooseExport(); await ready(6)
    assert.equal(await b.evaluate('document.querySelector(".message-export-title").textContent.trim()'), '其他会话')
    await close()
    assert.equal(await b.evaluate('document.querySelector(".camp-nav-open[aria-current=page]").closest("[data-thread-id]").dataset.threadId'), active)
    assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), draft)

    // Slow path is contained in the existing preview: no extra dialog or visible progress copy.
    await b.evaluate('__presence.showFullExportCase(250,"tail");__presence.controls.exportReadDelay=220')
    await openMenu(); await chooseExport()
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-dialog").length'), 1)
    assert.equal(await b.evaluate('document.querySelector(".message-export-preview").textContent.trim()'), '')
    assert.equal(await b.evaluate('document.querySelector(".message-export-dialog .primary-button").disabled'), true)
    await b.wait('!!document.querySelector(".message-export-read-spinner")')
    await click('.app-dialog-close'); await pause(800)
    assert.equal(await b.evaluate('!!document.querySelector(".message-export-dialog")'), false)
    await b.evaluate('__presence.controls.exportReadDelay=0')
    await openMenu(); await chooseExport(); await ready(248); await close()
    // Preserve format, metadata and manual title across a failed task and its fresh retry.
    await b.evaluate('__presence.controls.failNextExportPage=true;__presence.controls.exportReadDelay=120')
    await openMenu(); await chooseExport()
    await button('.message-export-dialog', 'Markdown')
    await click('.message-export-title'); await b.evaluate('document.querySelector(".message-export-title-row input").select()')
    await b.send('Input.insertText', { text: '自定义完整会话' }); await b.key('Enter')
    await b.wait('!!document.querySelector(".message-export-read-state [role=alert]")')
    await click('.message-export-options input')
    assert.equal(await b.evaluate('document.querySelector(".message-export-dialog .primary-button").disabled'), true)
    await b.evaluate('__presence.controls.exportReadDelay=0;__presence.appendExportMessage()')
    await button('.message-export-dialog', '重试')
    await b.wait('document.querySelector(".message-export-markdown")?.textContent.includes("读取开始后新增的消息")')
    assert.equal(await b.evaluate('document.querySelector(".message-export-title").textContent.trim()'), '自定义完整会话')
    assert.equal(await b.evaluate('document.querySelector(".message-export-options input").checked'), false)
    await close()

    // Invalidate stale body before rereading; a new arrival stays outside the original message bound.
    await b.evaluate('__presence.showFullExportCase(150,"tail");__presence.controls.exportReadDelay=120')
    await openMenu(); await chooseExport()
    await b.wait('__presence.controls.exportReads.length>=2')
    await b.evaluate('__presence.appendExportMessage();__presence.removeExportMessage("history-10")')
    await ready(147)
    assert.equal(await b.evaluate('!!document.querySelector("[data-export-message-id=history-151], [data-export-message-id=history-10]")'), false)
    await b.evaluate('__presence.removeExportMessage("export-user")')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-entry").length'), 0)
    await ready(146)
    assert.ok((await b.evaluate('document.querySelector(".message-export-document").textContent')).includes('引用的消息当前不可用'))
    await close()

    await b.evaluate('__presence.showFullExportCase(250,"tail");__presence.controls.exportReadDelay=200')
    await openMenu(); await chooseExport()
    await b.evaluate('__presence.navigateThread({id:"new-thread",title:"另一会话"})')
    await b.wait('!document.querySelector(".message-export-dialog")'); await pause(700)
    assert.equal(await b.evaluate('!!document.querySelector(".message-export-dialog")'), false)
    await b.evaluate('__presence.navigateThread(null);__presence.showFullExportCase(0,"tail")')
    await openMenu(); await chooseExport()
    await b.wait('document.querySelector(".message-export-read-state")?.textContent.includes("没有可导出的消息")')
    assert.equal(await b.evaluate('document.querySelector(".message-export-dialog .primary-button").disabled'), true)
    await close()

    await b.evaluate('__presence.showFullExportCase(8,"tail")')
    await openMenu(); await chooseExport(); await ready(6)
    const layouts = []
    for (const theme of ['day', 'night', 'ember', 'horizon', 'classic-red']) {
      await b.evaluate(`__presence.setTheme(${JSON.stringify(theme)})`)
      await b.wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`)
      await pause(100)
      const layout = await b.evaluate(`(()=>{const d=document.querySelector('.message-export-dialog'),r=d.getBoundingClientRect();return {theme:document.documentElement.dataset.theme,left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
      assert.equal(layout.overflow, false); layouts.push(layout)
    }
    for (const [width, height] of [[375, 812], [844, 390], [720, 620]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await pause(120)
      const bounds = await b.evaluate('(()=>{const r=document.querySelector(".message-export-dialog").getBoundingClientRect();return {top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()')
      assert.equal(bounds.overflow, false); assert.ok(bounds.top >= 0 && bounds.bottom <= height + 1)
      layouts.push({ width, height, ...bounds })
      await b.capture(join(root, `sidebar-export-${width}.png`))
    }
    await writeFile(join(root, 'results.json'), JSON.stringify({ entryChecks, layouts, complete: 498, htmlBytes, over1000: 1238, errors: b.errors }, null, 2))
    assert.deepEqual(b.errors, [])
  } finally {
    await b.close()
    if (process.env.ROVAI_KEEP_ACCEPTANCE_OUTPUT) console.log(`Retained acceptance output: ${root}`)
    else await rm(root, { recursive: true, force: true })
  }
})
