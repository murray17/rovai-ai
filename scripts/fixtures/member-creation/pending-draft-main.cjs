const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
let stage = 'startup', window
const makeWindow = () => new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
  webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
app.whenReady().then(async () => {
  window = makeWindow()
  const run = expression => window.webContents.executeJavaScript(expression, true)
  const wait = async expression => {
    const until = Date.now() + 10_000
    while (Date.now() < until) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)) }
    throw new Error(`Timed out at ${stage}: ${expression}`)
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 180))
  const click = async selector => {
    const point = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('Missing '+${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
    for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({type,...point,button:'left',clickCount:1})
    await settle()
  }
  const type = async text => {
    await wait('document.querySelector(".structured-mention-editor")?.getAttribute("contenteditable") === "true"')
    await click('.structured-mention-editor')
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({type,keyCode:'a',modifiers:[process.platform === 'darwin' ? 'meta' : 'control']})
    await settle()
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({type,keyCode:'Backspace'})
    await settle()
    if (text) await window.webContents.insertText(text)
    await settle()
  }
  const open = id => click(`[data-thread-id="${id}"] .camp-nav-open`)
  const input = 'document.querySelector(".structured-mention-editor")?.innerText.trim()'
  await window.loadFile(renderer, { query: { flow: 'pending' } })
  await wait('!!document.querySelector(".rail-button[aria-label=新对话]")')
  stage = 'empty one-click stays hidden'
  await click('.rail-button[aria-label="新对话"]')
  await wait('!!document.querySelector(".structured-mention-editor")')
  assert.equal(await run('document.querySelectorAll(".camp-draft-badge").length'), 0)
  const first = await run('[...window.memberCreationQA.threads.keys()].at(-1)')
  await type('第一份未发送草稿')
  await wait('document.querySelectorAll(".camp-draft-badge").length === 1')
  stage = 'independent drafts in the same group'
  await click('.rail-button[aria-label="新对话"]')
  await wait(`${input} === ''`)
  const second = await run('[...window.memberCreationQA.threads.keys()].at(-1)')
  assert.notEqual(first, second)
  await type('第二份未发送草稿')
  await wait('document.querySelectorAll(".camp-draft-badge").length === 2')
  await open(first)
  await wait(`${input} === '第一份未发送草稿'`)
  stage = 'Renderer refresh restores drafts'
  await run('window.memberCreationQA.checkpoint()')
  await window.loadFile(renderer, { query: { flow: 'pending' } })
  await wait('document.querySelectorAll(".camp-draft-badge").length === 2')
  await open(first)
  await wait(`${input} === '第一份未发送草稿'`)
  stage = 'rejected first send retains input'
  await run('window.memberCreationQA.rejectSend()')
  await click('.composer-primary-action.is-send')
  await wait('!!document.querySelector(".app-toast")')
  await click('.app-toast .icon-button')
  await wait('!document.querySelector(".composer-primary-action.is-send").disabled')
  assert.equal(await run(input), '第一份未发送草稿')
  assert.equal(await run('document.querySelectorAll(".camp-draft-badge").length'), 2)
  stage = 'accepted first send clears sent snapshot'
  await click('.composer-primary-action.is-send')
  await wait('document.querySelectorAll(".camp-draft-badge").length === 1')
  await wait(`${input} === ''`)
  await open(second)
  await wait(`${input} === '第二份未发送草稿'`)
  await run('window.memberCreationQA.checkpoint()')
  stage = 'window recreation preserves remaining draft'
  const previous = window
  window = makeWindow()
  await window.loadFile(renderer, { query: { flow: 'pending' } })
  previous.destroy()
  await wait('document.querySelectorAll(".camp-draft-badge").length === 1')
  await open(second)
  await wait(`${input} === '第二份未发送草稿'`)
  writeFileSync(join(dirname(userData), 'pending-draft-day.png'), (await window.webContents.capturePage()).toPNG())
  window.setContentSize(1040, 700)
  await run('window.memberCreationQA.theme("night")')
  await settle()
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
  writeFileSync(join(dirname(userData), 'pending-draft-night.png'), (await window.webContents.capturePage()).toPNG())
  stage = 'clearing input removes draft entry'
  await type('')
  await wait('document.querySelectorAll(".camp-draft-badge").length === 0')
  await click('.rail-button[aria-label="队员"]')
  await wait(`!window.memberCreationQA.threads.has(${JSON.stringify(second)})`)
  await open(first)
  await wait(`${input} === ''`)
  assert.deepEqual(await run('window.memberCreationQA.errors'), [])
  console.log(JSON.stringify({ok:true,cases:['empty hidden','multiple same-group drafts','switch restore','Renderer refresh','rejected first send','accepted first send','window recreation','clear and discard','day/night minimum width']}))
  app.exit(0)
}).catch(async error => { console.error(stage, error); if (window && !window.isDestroyed()) console.error(await window.webContents.executeJavaScript('JSON.stringify({calls:window.memberCreationQA.calls.slice(-20), presence:[...window.memberCreationQA.pendingPresence], errors:window.memberCreationQA.errors, input:document.querySelector(".structured-mention-editor")?.innerText, rows:document.querySelectorAll(".camp-nav-row").length, alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.innerText)})')); app.exit(1) })
