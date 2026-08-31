const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createServer } = require('node:http')
const { writeFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, BaseWindow, ipcMain, session } = require('electron')
const [fixture] = process.argv.slice(2)
assert.ok(isAbsolute(fixture), 'The fixture requires an explicit isolated absolute root')
app.setPath('userData', join(fixture, 'user-data'))
app.setPath('sessionData', join(fixture, 'session-data'))
app.setName('Rovai DingTalk Login Acceptance')

// Production Renderer, preload, login view and DOM observer; controlled local
// account/network responses. No Core, Runtime, daily data or real credentials.
const { DingTalkLoginView, DINGTALK_LOGIN_PAGE_OBSERVATION, parseDingTalkLoginPageObservation,
  parseChannelLoginViewBounds } = require(join(fixture, 'login-view.cjs'))
const snapshot = { schemaVersion: 4, channels: [{ kind: 'dingtalk', displayName: '钉钉', hostStatus: 'ready',
  connection: { status: 'connected', account: { accountId: 'fixture-owner', userName: '原账号', tenantName: '测试企业',
    brand: 'dingtalk', connectedAt: '2026-08-31T00:00:00Z', lastVerifiedAt: '2026-08-31T00:00:00Z' } }, memberBots: [] }],
  pendingBindingCount: 0, bindingIssueCount: 0,
  activeQrAttempt: { kind: 'dingtalk', attemptId: 'legacy-attempt', purpose: 'account_login', agentId: null,
    stage: 'awaiting_scan', qrDataUrl: null, expiresAt: null, detail: '旧钉钉登录' }, activeProvisioning: null }
let parent, login, qr, finish, refuse, refreshes = 0, attempt = 0
const sockets = new Set()
const server = createServer((request, response) => {
  if (request.url === '/slow-image') return
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<html><body style="margin:20px;font-family:system-ui"><p>钉钉扫码登录 · 自动验收夹具</p>' +
    '<div style="display:none" class="module-qrcode-code"><canvas width="180" height="180"></canvas></div>' +
    '<div class="module-qrcode-code"><canvas id="qr" width="180" height="180"></canvas></div>' +
    '<script>const c=document.getElementById("qr").getContext("2d");c.fillStyle="white";c.fillRect(0,0,180,180);' +
    'c.fillStyle="black";for(let y=0;y<18;y++)for(let x=0;x<18;x++)if((x+y)%3)c.fillRect(x*10,y*10,8,8)</script>' +
    '<img src="/slow-image"></body></html>')
})
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
const notify = () => parent.webContents.send('rovai:channels-changed', snapshot)
function cancel() {
  snapshot.activeQrAttempt = null
  login?.destroy()
  login = null
  notify()
  finish?.(snapshot)
  finish = refuse = null
}
async function setStage(stage) {
  if (stage === 'fixture_network_error') {
    snapshot.activeQrAttempt = null
    login?.destroy()
    login = null
    notify()
    refuse?.(Object.assign(new Error('dingtalk_open_platform_unavailable'), { name: 'DingTalkConsoleError' }))
    finish = refuse = null
    return
  }
  assert.ok(snapshot.activeQrAttempt)
  assert.ok(['preparing', 'awaiting_scan', 'scan_confirmed', 'expired', 'awaiting_interaction', 'saving_local_session'].includes(stage))
  if (stage === 'awaiting_interaction') {
    await login.webContents.mainFrame.executeJavaScript('document.body.innerHTML="<h2>选择企业</h2><p>钉钉官方交互的本地验收夹具</p><button>测试企业</button>"')
  }
  login.setInteraction(stage === 'awaiting_interaction')
  Object.assign(snapshot.activeQrAttempt, { stage, qrDataUrl: stage === 'awaiting_scan' ? qr : null,
    detail: { preparing: '正在加载钉钉二维码…', awaiting_scan: '请使用钉钉扫码登录开放平台。',
      scan_confirmed: '扫码成功，等待钉钉确认…', expired: '二维码已过期，请刷新后重新扫码。',
      awaiting_interaction: '请在下方完成钉钉确认或选择企业。', saving_local_session: '正在保存开发者会话…' }[stage] })
  notify()
}
function handle(channel, action) {
  ipcMain.handle(channel, (event, ...args) => { assert.equal(event.sender, parent.webContents); return action(...args) })
}
function exit(code) {
  login?.destroy()
  if (parent && !parent.isDestroyed()) parent.destroy()
  for (const socket of sockets) socket.destroy()
  server.close()
  app.exit(code)
}

app.whenReady().then(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  parent = new BrowserWindow({ show: process.platform === 'linux', width: 1040, height: 800, useContentSize: true,
    title: 'Rovai 钉钉登录 · 自动验收（无需扫码）',
    webPreferences: { preload: join(fixture, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false } })
  const createLogin = async () => {
    const jar = session.fromPartition('qr-fixture-' + (++attempt), { cache: false })
    login = new DingTalkLoginView(jar, parent)
    login.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const ready = once(login.webContents, 'dom-ready')
    void login.loadURL('http://127.0.0.1:' + server.address().port + '/qr').catch(() => undefined)
    await ready
    const observation = parseDingTalkLoginPageObservation(await login.webContents.mainFrame.executeJavaScript(DINGTALK_LOGIN_PAGE_OBSERVATION))
    assert.equal(observation.kind, 'qr')
    assert.equal(login.webContents.isLoading(), true, 'The intentionally slow resource is still loading')
    qr = observation.dataUrl
  }
  handle('rovai:channels-get', () => snapshot)
  handle('rovai:channels-connect', async kind => {
    assert.equal(kind, 'dingtalk')
    await createLogin()
    snapshot.activeQrAttempt = { kind: 'dingtalk', attemptId: 'attempt-' + attempt, purpose: 'account_login', agentId: null,
      stage: 'preparing', qrDataUrl: null, expiresAt: null, detail: '正在加载钉钉二维码…' }
    const pending = new Promise((resolve, reject) => { finish = resolve; refuse = reject })
    notify()
    return pending
  })
  handle('rovai:channels-cancel-qr', id => { if (id === snapshot.activeQrAttempt?.attemptId) cancel(); return snapshot })
  handle('rovai:channels-refresh-login-qr', id => {
    assert.equal(id, snapshot.activeQrAttempt?.attemptId)
    refreshes++
    return setStage('preparing')
  })
  handle('rovai:channels-login-view-bounds', (id, value) => {
    const bounds = parseChannelLoginViewBounds(value)
    if (id === snapshot.activeQrAttempt?.attemptId) login?.setBounds(bounds)
  })
  handle('fixture:stage', setStage)
  handle('fixture:facts', () => {
    const child = parent.contentView.children.find(view => view.webContents === login?.webContents)
    return { refreshes, attached: Boolean(child), bounds: child?.getBounds() ?? null }
  })
  await parent.loadFile(join(fixture, 'renderer/index.html'))
  const cases = await parent.webContents.executeJavaScript('window.dingtalkLoginTest.run()', true)
  cases.push('QR is readable before slow page resources finish')
  // Native child surfaces need an actual compositor frame on macOS. Showing the
  // isolated fixture without activating it does not touch the daily App.
  parent.showInactive()
  for (const theme of ['day', 'night']) {
    for (const stage of ['awaiting_scan', 'expired', 'awaiting_interaction']) {
      await parent.webContents.executeJavaScript('window.dingtalkLoginTest.capture(' + JSON.stringify(theme) + ',' + JSON.stringify(stage) + ')', true)
      writeFileSync(join(fixture, theme + '-' + stage + '.png'), (await parent.capturePage()).toPNG())
      if (stage === 'awaiting_interaction') {
        const child = parent.contentView.children.find(view => view.webContents === login.webContents)
        const { width, height } = child.getBounds()
        // BrowserWindow.capturePage contains the Renderer surface, not native
        // child contents. Inspect the isolated page separately as well.
        writeFileSync(join(fixture, theme + '-native-page.png'), (await login.webContents.capturePage(
          { x: 0, y: 0, width, height }, { stayHidden: true }
        )).toPNG())
      }
    }
  }
  assert.deepEqual(await login.webContents.mainFrame.executeJavaScript('({ bridge:typeof window.rovai, node:typeof require, fixture:typeof window.loginFixture })'),
    { bridge: 'undefined', node: 'undefined', fixture: 'undefined' })
  const prefs = login.webContents.getLastWebPreferences()
  assert.equal(prefs.sandbox, true)
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.nodeIntegration, false)
  cases.push('native page has no Rovai bridge or Node')
  parent.webContents.setZoomFactor(2)
  await parent.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 250))')
  await parent.webContents.executeJavaScript('window.dingtalkLoginTest.checkNativeClip(2)', true)
  writeFileSync(join(fixture, 'night-interaction-200-percent.png'), (await parent.capturePage()).toPNG())
  cases.push('200% zoom clips the native view inside the dialog')
  const nativeContents = login.webContents
  nativeContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(nativeContents.isDestroyed(), true)
  assert.equal(BaseWindow.getAllWindows().length, 1, 'Escape must destroy the hidden host too')
  cases.push('Escape from the native page destroys its hidden host')
  console.log(JSON.stringify({ ok: true, cases }))
  exit(0)
}).catch(error => { console.error(error); exit(1) })
