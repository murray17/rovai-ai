const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
// Production UI with an in-memory projection only. No Core, Runtime or channel network.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1040, height: 700, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(renderer)
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = async () => { await run('window.namingTest.settle()'); return run('window.namingTest.state()') }
  const waitFor = async expression => {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (await run(expression)) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`Fixture did not settle: ${expression}`)
  }
  const click = async selector => {
    const point = await run(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing '+${JSON.stringify(selector)}); node.scrollIntoView({block:'nearest'}); const r = node.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 })
    return state()
  }
  const key = async keyCode => {
    // Match accept-sidebar-ui: Chromium input also reaches an unfocused, hidden fixture window.
    const virtualKey = { ArrowDown: 40, Enter: 13 }[keyCode]
    assert.ok(virtualKey)
    const params = { key: keyCode, code: keyCode, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey,
      ...(keyCode === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
    return state()
  }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  try {
    let current = await state()
    for (const label of ['飞书私聊', '飞书群聊', '飞书话题', '钉钉私聊', '钉钉群聊']) {
      assert.equal(current.labels.filter(title => title.startsWith(`【${label}】`)).length, 1)
    }
    assert.ok(current.labels.includes('修复登录态恢复问题'), 'Local Camp has no prefix')
    assert.ok(current.title.startsWith('【飞书话题】'))
    assert.deepEqual(current.long, { clipped: true, ellipsis: 'ellipsis' })
    assert.equal(current.overflow, false)
    await capture('channel-names-day-1040')
    await run('document.querySelector(\'[data-sidebar-menu-target="camp:fixture-camp-1"]\').focus()')
    await key('ArrowDown')
    await waitFor('document.activeElement?.classList.contains("sidebar-action-menu-item")')
    await key('ArrowDown')
    await waitFor('document.activeElement?.textContent.trim() === "重命名"')
    current = await key('Enter')
    await waitFor('Boolean(document.querySelector("#rename-camp-title"))')
    current = await state()
    assert.equal(current.rename, '完善账号自动续期', 'Rename input excludes the display prefix')
    await click('#rename-camp-title')
    await run('document.querySelector("#rename-camp-title").select()')
    await window.webContents.insertText('OAuth 登录问题')
    await click('.camp-action-dialog button[type="submit"]')
    await waitFor('!document.querySelector("#rename-camp-title")')
    current = await state()
    assert.deepEqual(current.saved, [{ id: 'fixture-camp-1', title: 'OAuth 登录问题' }])
    assert.ok(current.labels.includes('【飞书私聊】OAuth 登录问题'))
    assert.equal(current.errors, '')
    await run('document.documentElement.dataset.theme = "night"')
    await capture('channel-names-night-1040')
    window.webContents.setZoomFactor(2)
    current = await state()
    assert.deepEqual(current.long, { clipped: true, ellipsis: 'ellipsis' })
    await capture('channel-names-night-200-percent')
    console.log(JSON.stringify({ ok: true, sourceCount: 5, saved: current.saved }))
    window.webContents.debugger.detach()
    window.destroy()
    app.exit(0)
  } catch (error) {
    await capture('failure')
    console.error(await state())
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
    window.destroy()
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
