import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('message selection exports standalone HTML, PNG and Markdown through production UI', { timeout: 180_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome is not installed')
  const root = await mkdtemp(join(tmpdir(), 'rovai-message-export-'))
  await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
  console.log(JSON.stringify({ channel: 'automatic_acceptance', userData: join(root, 'profile'), core: false, runtime: false, skillLibrary: 'unused' }))
  const b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
  const click = async selector => { await b.click(`document.querySelector(${JSON.stringify(selector)})`); await pause(100) }
  const button = async (scope, text) => { await b.click(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`); await pause(100) }
  const open = async () => { await click('.message-selection-actions .primary-button'); await b.wait('!!document.querySelector(".message-export-document")') }
  const downloaded = async (count, label) => {
    await button('.message-export-dialog', label)
    await b.wait(`window.__downloads.length===${count}`, 25_000)
    return b.evaluate('window.__downloads.at(-1).name')
  }
  try {
    await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + '?export=1&pure=1' })
    await b.wait('!!window.__presence && !!document.querySelector("[data-message-id=export-code]")')
    await b.evaluate(`window.__downloads=[];const originalURL=URL.createObjectURL.bind(URL),blobs=new Map();URL.createObjectURL=blob=>{const url=originalURL(blob);blobs.set(url,blob);return url};const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__downloads.push({name:this.download,blob:blobs.get(this.href)});return}originalClick.call(this)}`)
    const draft = await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
    await click('.message-export-entry-button')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-check").length'), 3)
    await click('[data-message-id=export-user] .message-export-check input')
    await b.evaluate(`document.querySelector('[data-message-id=export-reply] .message-export-check input').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`)
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-check input:checked").length'), 3)
    const dock = await b.evaluate(`(()=>{const d=document.querySelector('.message-selection-dock').getBoundingClientRect(),t=document.querySelector('.timeline-pane').getBoundingClientRect();return {dock:d.top,timeline:t.bottom}})()`)
    assert.ok(dock.dock >= dock.timeline - 1, 'Selection actions must not cover the message list')
    for (const theme of ['day', 'night']) {
      await b.evaluate(`__presence.setTheme('${theme}')`); await pause(120)
      const color = await b.evaluate(`getComputedStyle(document.querySelector('[data-export-selected=true]'),'::before').backgroundColor`)
      const channels = color.match(/\d+/g).map(Number)
      assert.equal(channels[0], channels[1]); assert.equal(channels[1], channels[2])
      await b.capture(join(root, `selection-${theme}.png`))
    }
    await b.evaluate('__presence.setTheme("day")'); await open()
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".message-export-options input")].map(e=>e.checked)'), [true, true, true, true])
    assert.equal(await b.evaluate('document.querySelector(".message-export-dialog").textContent.includes("导出规则")'), false)
    await b.wait('!!document.querySelector(".message-export-image") && !document.querySelector("[data-export-pending=true]")')
    await b.capture(join(root, 'preview.png'))
    for (const [width, height] of [[375, 812], [844, 390]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(120)
      // The 720px reader intentionally scrolls inside the preview. Check the
      // dialog and its controls, not the reader's scrollable content width.
      const geometry = await b.evaluate(`(()=>{const e=document.querySelector('.message-export-dialog'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,controls:[...e.querySelectorAll('.message-export-formats button,.message-export-options label,.app-dialog-footer button,.app-dialog-close')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right})}})()`)
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= height && geometry.controls, 'Dialog controls remain within viewport: ' + JSON.stringify(geometry))
      await b.capture(join(root, `preview-${width}.png`))
    }
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    assert.match(await downloaded(1, '下载 HTML'), /\.html$/)
    const html = await b.evaluate('__downloads[0].blob.text()')
    for (const excluded of ['private-thread-id', 'private-mission-id', '不应导出的撤回内容', 'blob:', 'onerror=', 'window.exportInjected']) assert.ok(!html.includes(excluded), excluded)
    for (const included of ['data:image/png;base64,', '报告.pdf', '缺失.png', '原图不可用', 'https://example.com', '关联讨论', '关联使命', '-old', '+new', '发送给']) assert.ok(html.includes(included), included)
    await writeFile(join(root, 'export.html'), html)
    for (let index = 1; index <= 4; index++) await click(`.message-export-options label:nth-child(${index}) input`)
    assert.equal(await b.evaluate('!!document.querySelector(".message-export-meta strong, .message-export-meta time, .message-export-entry > .member-avatar, .message-export-entry > .local-message-avatar, .message-export-recipients")'), false)
    assert.ok(await b.evaluate('document.querySelector(".message-export-bubble").textContent.includes("爱丽丝")'), 'Metadata toggles never remove mentions from the body')
    await button('.message-export-dialog', '图片 PNG')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".message-export-options input")].map(e=>e.checked)'), [true, true, true, true])
    assert.match(await downloaded(2, '下载 PNG'), /\.png$/)
    const png = await b.evaluate(`(async()=>{const blob=__downloads[1].blob,im=await createImageBitmap(blob),c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const data=x.getImageData(0,0,c.width,c.height).data;let visible=0,green=0;for(let i=0;i<data.length;i+=4){if(data[i+3]&&data[i]<220)visible++;if(data[i+1]>data[i]+15&&data[i+1]>data[i+2]+10)green++}return {width:im.width,height:im.height,visible,green,size:blob.size}})()`)
    assert.equal(png.width, 1440); assert.ok(png.height > 1000); assert.ok(png.visible > 1000); assert.ok(png.green > 1000, 'Embedded image must appear in the PNG, not just its filename')
    await b.evaluate('document.querySelector(".message-export-document").style.minHeight="9000px"')
    await button('.message-export-dialog', '下载 PNG')
    await b.wait('!!document.querySelector(".message-export-error")')
    assert.match(await b.evaluate('document.querySelector(".message-export-error").textContent'), /长图过长/)
    assert.equal(await b.evaluate('__downloads.length'), 2)
    await b.evaluate('document.querySelector(".message-export-document").style.minHeight=""')
    await button('.message-export-dialog', 'Markdown')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".message-export-options label")].map(e=>[e.textContent,e.querySelector("input").checked])'), [['作者', true], ['时间', true], ['发送对象', true]])
    assert.match(await downloaded(3, '下载 Markdown'), /\.md$/)
    const md = await b.evaluate('__downloads[2].blob.text()')
    assert.match(md, /```diff\n-old\n\+new\n```/); assert.match(md, /发送给/); assert.ok(!md.includes('private-thread-id'))
    await button('.message-export-dialog', '返回调整')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-check input:checked").length'), 3)
    await b.key('Escape'); await pause(120)
    assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), draft)
    assert.equal(await b.evaluate('!!document.querySelector(".message-selection-dock")'), false)

    // Native text selection offers export as a sibling to quote; only that text is captured.
    await b.evaluate(`(()=>{const root=document.querySelector('[data-message-id=export-code] .safe-markdown'),walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){if(n.textContent.includes('普通网页。')){const start=n.textContent.indexOf('普通网页。'),r=document.createRange();r.setStart(n,start);r.setEnd(n,start+5);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));break}}})()`)
    await b.wait('!!document.querySelector(".message-selection-export")')
    await click('.message-selection-export')
    await b.wait('!!document.querySelector(".message-export-dialog")')
    await button('.message-export-dialog', '网页 HTML')
    assert.equal(await b.evaluate('document.querySelector(".message-export-excerpt").textContent'), '普通网页。')
    assert.equal(await b.evaluate('document.querySelectorAll(".message-export-attachment").length'), 0)
    await button('.message-export-dialog', '返回调整')

    await click('.message-export-entry-button')
    await button('.message-selection-dock', '全选已加载')
    await open()
    await b.evaluate('__presence.navigateThread({id:"another-thread",title:"其他会话"})')
    await b.wait('!document.querySelector(".message-export-dialog") && !document.querySelector(".message-selection-dock")')
    await b.evaluate('__presence.navigateThread(null)')
    await b.wait('!!document.querySelector("[data-message-id=export-code]")')
    assert.equal(await b.evaluate('!!document.querySelector(".message-export-dialog, .message-selection-dock")'), false, 'Returning to a thread must not resurrect its previous export selection')

    // Open the downloaded document in isolation; links and self-contained image zoom remain useful.
    await b.send('Page.navigate', { url: pathToFileURL(join(root, 'export.html')).href })
    await b.wait('!!document.querySelector("article img")')
    assert.equal(await b.evaluate('!!window.exportInjected'), false)
    assert.equal(await b.evaluate('[...document.querySelectorAll("article a")].every(e=>/^https?:/.test(e.href))'), true)
    assert.equal(await b.evaluate('[...document.querySelectorAll("article img")].every(e=>e.complete&&e.naturalWidth>0)'), true)
    await click('article .message-export-image')
    assert.equal(await b.evaluate('document.querySelector("dialog").open'), true)
    await b.key('Escape')
    assert.equal(await b.evaluate('document.querySelector("dialog").open'), false)
    assert.deepEqual(b.errors, [])
    console.log(JSON.stringify({ result: 'passed', png, evidence: process.env.ROVAI_KEEP_EXPORT_FIXTURE === '1' ? root : undefined }))
  } catch (error) {
    await b.capture(join(root, 'failure.png'))
    console.error(JSON.stringify({ error: error.message, body: await b.evaluate('document.body.innerText.slice(-5000)'), errors: b.errors, evidence: root }))
    throw error
  } finally {
    await b.close()
    if (process.env.ROVAI_KEEP_EXPORT_FIXTURE !== '1') await rm(root, { recursive: true, force: true })
  }
})
