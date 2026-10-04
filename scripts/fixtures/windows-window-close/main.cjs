const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const [fixture] = process.argv.slice(2)
assert.ok(isAbsolute(fixture))
const userData = join(fixture, 'user-data')
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
const { WindowsWindowClose, WindowClosePreferences, createWindowCloseRequestHandler, createWindowsTray, AppQuitCoordinator } = require(join(fixture, 'owner/index.cjs'))
let window, owner, coordinator, prepares = 0, drains = 0, failSave = false, failTray = false, failQuit = true, updatePending = false
app.on('before-quit', event => { owner.beginQuit(); coordinator.handleQuitRequest(event) })
app.on('window-all-closed', () => {})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const file = join(userData, 'window-close.json')
  const store = new WindowClosePreferences(file)
  window = new BrowserWindow({ width: 1040, height: 700, useContentSize: true, show: false,
    webPreferences: { preload: join(fixture, 'preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  owner = new WindowsWindowClose({
    preferences: { get: () => store.get(), loadFailed: store.loadFailed, set: async value => { if (failSave) throw Error('fixture disk full'); await store.set(value) } },
    window: () => window,
    createTray: (open, quit) => {
      if (failTray) throw Error('fixture tray creation failure')
      if (process.platform === 'win32') {
        try { return createWindowsTray(open, quit, false) } catch (error) { console.error('Native tray creation failed:', error); throw error }
      }
      let destroyed = false
      return { destroy: () => { destroyed = true }, isDestroyed: () => destroyed }
    },
    quit: () => app.quit(),
    publish: value => window.webContents.send('rovai:window-close-changed', value)
  })
  coordinator = new AppQuitCoordinator({ updateInstallPending: () => updatePending, beforeDrain: () => {},
    prepareRenderer: async () => { await owner.settlePending(); prepares++; if (failQuit) throw Error('fixture draft write failed') },
    drain: async () => { drains++ }, reportFailure: error => { throw error },
    reportPreparationFailure: () => owner.quitPreparationFailed(),
    finish: reason => {
      try {
        assert.equal(reason, 'update_install')
        assert.equal(owner.get().promptId, null)
        assert.equal(drains, 1)
        owner.dispose()
        const report = { ok: true, prepares, drains, nativeWindowsTray: process.platform === 'win32', simulatedWindowsControlFlow: process.platform !== 'win32' }
        writeFileSync(join(fixture, 'verification.json'), JSON.stringify(report, null, 2))
        console.log(JSON.stringify(report)); app.exit(0)
      } catch (error) { console.error(error); app.exit(1) }
    }
  })
  ipcMain.handle('rovai:window-close', createWindowCloseRequestHandler('win32', () => owner, () => window))
  window.on('close', event => owner.handleClose(event))
  const run = expression => window.webContents.executeJavaScript(expression, true)
  const wait = async expression => {
    for (let n = 0; n < 80; n++) { if (await run(`Boolean(${expression})`)) return; await pause(40) }
    console.error('UI timeout evidence:', JSON.stringify({ owner: owner.get(), visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), renderer: await run(`({text:document.querySelector('.window-close-dialog')?.textContent,focus:document.activeElement?.outerHTML,ratio:devicePixelRatio})`) }))
    throw Error('UI did not settle: ' + expression)
  }
  const click = async selector => {
    const position = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('Missing ${selector}'); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
    const zoom = window.webContents.getZoomFactor()
    position.x = Math.round(position.x * zoom); position.y = Math.round(position.y * zoom)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position })
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position })
    await pause(90)
  }
  const key = async keyCode => { window.webContents.sendInputEvent({type:'keyDown',keyCode}); window.webContents.sendInputEvent({type:'keyUp',keyCode}); await pause(100) }
  const change = async value => {
    await run(`(() => {const e=document.querySelector('#window-close-behavior');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('#window-close-behavior').value===${JSON.stringify(value)} && !document.querySelector('#window-close-behavior').disabled`)
  }
  const prompt = async () => { window.close(); await wait(`document.querySelector('.window-close-dialog[data-state="open"]')`); await pause(220) }
  const cancel = async () => { await key('Escape'); await wait(`!document.querySelector('.window-close-dialog')`) }
  const capture = async name => writeFileSync(join(fixture, name + '.png'), (await window.webContents.capturePage()).toPNG())
  await window.loadFile(join(fixture, 'renderer/index.html'))
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true})
  await wait(`document.querySelector('#window-close-behavior') && !document.querySelector('#window-close-behavior').disabled`)
  assert.equal(owner.get().behavior, 'ask')
  owner.initialize()
  window.show()
  await run(`document.querySelector('#general-window-heading').scrollIntoView({block:'start'}); window.originalDraft=document.querySelector('#preserved-draft'); window.originalDraft.value='unsaved selection'; window.originalScroll=document.querySelector('.settings-panel').scrollTop`)
  await prompt()
  assert.equal(await run(`document.querySelector('.window-close-remember input').checked`), false)
  assert.equal(await run(`document.activeElement.textContent`), '取消')
  await key('Tab')
  assert.equal(await run(`Boolean(document.activeElement.closest('.window-close-dialog'))`), true)
  await click('.window-close-remember input')
  await cancel()
  assert.equal(owner.get().behavior, 'ask')
  await prompt()
  assert.equal(await run(`document.querySelector('.window-close-remember input').checked`), false)
  let heartbeat = 0
  const timer = setInterval(() => heartbeat++, 10)
  await click('.window-close-dialog .primary-button')
  await wait(`!document.querySelector('.window-close-dialog')`)
  assert.equal(window.isVisible(), false)
  const before = heartbeat; await pause(100); assert.ok(heartbeat > before)
  assert.equal(window.isDestroyed(), false)
  owner.restore(); await pause(100)
  assert.equal(window.isVisible(), true)
  assert.equal(await run(`document.querySelector('#preserved-draft') === window.originalDraft && window.originalDraft.value === 'unsaved selection'`), true)
  assert.equal(await run(`document.querySelector('.settings-panel').scrollTop`), await run('window.originalScroll'))
  await prompt(); await click('.window-close-remember input'); await click('.window-close-dialog .primary-button')
  await wait(`!document.querySelector('.window-close-dialog')`)
  assert.equal(new WindowClosePreferences(file).get(), 'tray')
  owner.restore(); await pause(50)
  assert.equal(await run(`document.querySelector('#window-close-behavior').value`), 'tray')
  window.close(); assert.equal(window.isVisible(), false); assert.equal(owner.get().promptId, null)
  await owner.setBehavior('ask'); assert.equal(window.isVisible(), true)
  await change('exit'); await change('ask')
  failSave = true
  await prompt(); await click('.window-close-remember input'); await click('.window-close-dialog .primary-button')
  await wait(`document.querySelector('.window-close-dialog [role="alert"]')`)
  assert.equal(window.isVisible(), true)
  assert.equal(await run(`document.querySelector('.window-close-remember input').checked`), true)
  assert.equal(owner.get().behavior, 'ask')
  failSave = false; await cancel()
  failTray = true
  await prompt(); await click('.window-close-dialog .primary-button')
  await wait(`document.querySelector('.window-close-dialog [role="alert"]')`)
  assert.equal(owner.get().error, 'tray_unavailable')
  assert.equal(window.isVisible(), true)
  failTray = false; await cancel()
  for (const theme of ['day','night']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    for (const [width,height] of [[1040,700],[1440,920]]) {
      window.setContentSize(width,height); await pause(100)
      await run(`document.querySelector('#general-window-heading').scrollIntoView({block:'start'})`)
      await capture(`settings-${theme}-${width}`)
      await prompt(); await capture(`dialog-${theme}-${width}`)
      assert.equal(await run(`(() => {const s=getComputedStyle(document.querySelector('.window-close-dialog .primary-button'));return s.color===s.backgroundColor})()`), false)
      assert.equal(await run(`(() => {const r=document.querySelector('.window-close-dialog').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`), true)
      await cancel()
    }
  }
  await run(`window.closeFixture.language('en')`)
  window.setContentSize(1040, 700); window.webContents.setZoomFactor(2)
  await prompt(); assert.equal(await run(`document.querySelector('.app-dialog-title').textContent`), 'Close window')
  assert.equal(await run(`(() => {const r=document.querySelector('.window-close-dialog').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`), true)
  await capture('dialog-english-200pct'); await cancel()
  window.webContents.setZoomFactor(1)
  window.minimize(); await pause(120)
  assert.equal(owner.get().promptId, null)
  owner.restore(); assert.equal(window.isMinimized(), false)
  await prompt()
  await click('.window-close-dialog .dialog-actions .quiet-button')
  await wait(`document.querySelector('.window-close-dialog [role="alert"]')`)
  assert.equal(prepares, 1); assert.equal(drains, 0); assert.equal(window.isVisible(), true)
  await cancel()
  clearInterval(timer)
  failQuit = false; updatePending = true
  app.quit()
}).catch(error => { console.error(error); owner?.dispose(); app.exit(1) })
