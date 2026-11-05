import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('MobileUI exports through the production drawer with a fluid HTML reader and fixed PNG canvas', { timeout: 180_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome is not installed')
  const root = await mkdtemp(join(tmpdir(), 'rovai-export-mobile-'))
  await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
  console.log(JSON.stringify({ channel: 'automatic_acceptance', userData: join(root, 'profile'), core: false, runtime: false, skillLibrary: 'unused' }))
  const b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
  const row = 'document.querySelector(`[data-thread-id="${__presence.getState().snapshot.thread.id}"] .camp-nav-open`)'
  const click = async selector => { await b.click(`document.querySelector(${JSON.stringify(selector)})`); await pause(100) }
  const button = async text => { await b.click(`[...document.querySelectorAll('.message-export-dialog button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`); await pause(100) }
  const menu = async () => {
    const point = await b.evaluate(`(()=>{const e=${row};e.scrollIntoView({block:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] })
    await pause(570)
    await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await b.wait('!!document.querySelector(".sidebar-action-menu")')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".sidebar-action-menu-item")].map(e=>e.textContent.trim())'), ['置顶', '标记未读', '重命名', '复制会话 ID', '导出会话', '删除'])
  }
  const open = async () => {
    await menu()
    await b.click('[...document.querySelectorAll(".sidebar-action-menu-item")].find(e=>e.textContent.trim()==="导出会话")')
    await b.wait('!!document.querySelector(".message-export-dialog")')
  }
  const layouts = []
  const checkLayout = async (width, height) => {
    const layout = await b.evaluate(`(()=>{const dialog=document.querySelector('.message-export-dialog'),r=dialog.getBoundingClientRect(),reader=document.querySelector('.message-export-document'),preview=document.querySelector('.message-export-preview'),buttons=[...dialog.querySelectorAll('.app-dialog-footer button')].map(e=>e.getBoundingClientRect().height);return {width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,rect:[r.left,r.top,r.right,r.bottom],pageOverflow:document.documentElement.scrollWidth>innerWidth,readerWidth:reader.getBoundingClientRect().width,readerOverflow:reader.scrollWidth>preview.clientWidth+1,buttons}})()`)
    assert.deepEqual([layout.width, layout.height], [width, height])
    assert.equal(layout.pageOverflow, false); assert.equal(layout.readerOverflow, false)
    assert.ok(layout.rect[0] >= 0 && layout.rect[1] >= 0 && layout.rect[2] <= width + 1 && layout.rect[3] <= height + 1)
    assert.ok(layout.buttons.every(value => value >= 43.5))
    layouts.push(layout)
  }
  try {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + '?export=1&pure=1&mobile=1' })
    await b.wait('!!window.__presence && document.documentElement.dataset.mobileWeb==="true"')
    await b.evaluate('__presence.showFullExportCase(8,"gapped")')
    await b.evaluate(`window.__downloads=[];const original=URL.createObjectURL.bind(URL),blobs=new Map();URL.createObjectURL=blob=>{const url=original(blob);blobs.set(url,blob);return url};const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){__downloads.push({name:this.download,blob:blobs.get(this.href)});return}click.call(this)}`)
    const draft = await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
    await click('[aria-label="打开主菜单"]')
    await b.wait('!!document.querySelector(".mobile-conversation-drawer")'); await pause(240)
    assert.equal(await b.evaluate('document.querySelector(".mobile-context-trigger").getBoundingClientRect().width<=1'), true)
    await open(); await b.wait('document.querySelectorAll(".message-export-entry").length===6')
    await b.wait('!document.querySelector(".message-export-document [data-export-pending=true],.message-export-document .member-avatar--loading")')
    await pause(180); await checkLayout(390, 844)
    const closeIsOnTop = await b.evaluate(`(()=>{const e=document.querySelector('.message-export-dialog .app-dialog-close'),r=e.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.message-export-dialog')})()`)
    assert.equal(closeIsOnTop, true, 'The export preview is above the still-mounted conversation drawer')
    await b.capture(join(root, 'mobile-preview-day.png'))
    await button('下载 HTML'); await b.wait('__downloads.length===1')
    const exportedHTML = await b.evaluate('(async()=>{const html=await __downloads[0].blob.text(),doc=new DOMParser().parseFromString(html,"text/html");return {entries:doc.querySelectorAll(".message-export-entry").length,images:[...doc.images].filter(img=>img.src.startsWith("data:image/")).length,checked:doc.querySelectorAll(".message-export-task-marker.is-complete").length}})()')
    assert.equal(exportedHTML.entries, 6); assert.ok(exportedHTML.images > 0); assert.equal(exportedHTML.checked, 1)
    await button('图片 PNG')
    assert.equal(await b.evaluate('document.querySelector(".message-export-document").getBoundingClientRect().width'), 720)
    await button('下载 PNG'); await b.wait('__downloads.length===2', 25_000)
    const png = await b.evaluate('(async()=>{const image=await createImageBitmap(__downloads[1].blob);const size=[image.width,image.height];image.close();return size})()')
    assert.equal(png[0], 1440); assert.ok(png[1] > 0)
    await button('Markdown')
    assert.ok((await b.evaluate('document.querySelector(".message-export-markdown").textContent')).includes('报告\\.pdf'))
    await button('网页 HTML')
    for (const theme of ['day', 'night', 'ember', 'horizon', 'classic-red']) {
      await b.evaluate(`__presence.setTheme(${JSON.stringify(theme)})`)
      await b.wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`); await pause(100)
      await checkLayout(390, 844)
      if (theme === 'night') await b.capture(join(root, 'mobile-preview-night.png'))
    }
    for (const [width, height] of [[375, 812], [430, 932]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
      await pause(150); await checkLayout(width, height)
    }
    await click('.message-export-dialog .app-dialog-close')
    await b.wait('!document.querySelector(".message-export-dialog")')
    assert.equal(await b.evaluate('!!document.querySelector(".mobile-conversation-drawer")'), true)
    await b.wait('document.activeElement?.classList.contains("camp-nav-open")')
    assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), draft)
    await b.evaluate('__presence.controls.exportReadDelay=450')
    await open(); await b.wait('!!document.querySelector(".message-export-read-spinner")')
    assert.equal(await b.evaluate('document.querySelector(".message-export-preview").textContent.trim()'), '')
    await click('.message-export-dialog .app-dialog-close'); await pause(1000)
    assert.equal(await b.evaluate('!!document.querySelector(".message-export-dialog")'), false)
    await b.evaluate('__presence.controls.exportReadDelay=0;__presence.showFullExportCase(150,"gapped");__presence.controls.failNextExportPage=true')
    await open(); await b.wait('!!document.querySelector(".message-export-read-state [role=alert]")')
    await button('重试'); await b.wait('document.querySelectorAll(".message-export-entry").length===148')
    await click('.message-export-dialog .app-dialog-close')
    await click('[aria-label="关闭主菜单"]')
    await b.wait('!document.querySelector(".mobile-conversation-drawer")')
    assert.equal(await b.evaluate('document.activeElement?.getAttribute("aria-label")'), '打开主菜单')
    assert.deepEqual(b.errors, [])
    await writeFile(join(root, 'results.json'), JSON.stringify({ layouts, png, exportedHTML, errors: b.errors }, null, 2))
    console.log(JSON.stringify({ result: 'passed', layouts: layouts.length, png }))
  } finally {
    await b.close()
    if (process.env.ROVAI_KEEP_ACCEPTANCE_OUTPUT) console.log(`Retained acceptance output: ${root}`)
    else await rm(root, { recursive: true, force: true })
  }
})
