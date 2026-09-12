const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const [fixture] = process.argv.slice(2)
assert.ok(isAbsolute(fixture))
app.setPath('userData', join(fixture, 'user-data'))
app.setPath('sessionData', join(fixture, 'session-data'))
app.setName('Rovai Feishu Login Acceptance')
const { ElectronFeishuDeveloperSessionService, FeishuLoginProtocol, FeishuSessionHttp, requestInFeishuSession } = require(join(fixture, 'service.cjs'))
const calls = []
const jars = []
const portalOrigin = 'https://open.larkoffice.com'
const user = { user_id: 'fixture-user', displayName: { value: '张三' }, tenant_id: 'fixture-tenant', tenantDisplayName: { value: '示例团队' } }
const json = (value, headers = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } })
let parent
app.on('session-created', jar => {
  jars.push(jar)
  const index = jars.length
  jar.protocol.handle('https', async request => {
    const url = new URL(request.url)
    calls.push({ session: index, path: url.pathname, host: url.hostname })
    if (url.pathname === '/body-timeout') {
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('unfinished')) } }))
    }
    if (url.pathname.endsWith('/qrlogin/init')) {
      assert.equal(request.headers.get('x-app-id'), '7')
      assert.deepEqual(await request.json(), { biz_type: null, redirect_uri: 'https://open.feishu.cn/app?lang=zh-CN' })
      await jar.cookies.set({ url: 'https://accounts.feishu.cn', name: 'passport-fixture', value: 'fixture-cookie', secure: true, httpOnly: true })
      return json({ code: 0, data: { step_info: { token: 'non-secret-fixture-token' } } }, { 'x-flow-key': 'fixture-flow-' + index })
    }
    if (url.pathname.endsWith('/qrlogin/polling')) {
      assert.equal(request.headers.get('x-flow-key'), 'fixture-flow-' + index)
      assert.ok((await jar.cookies.get({ url: url.href })).some(cookie => cookie.name === 'passport-fixture'))
      return json({ code: 0, data: { next_step: 'enter_app', step_info: { cross_login_uri: 'https://accounts.feishu.cn/cross?ticket=fixture' } } })
    }
    assert.equal(request.headers.get('x-flow-key'), null)
    assert.equal(request.headers.get('x-app-id'), null)
    if (url.pathname === '/cross') {
      await jar.cookies.set({ url: portalOrigin, name: 'portal-fixture', value: 'fixture-portal-cookie', secure: true, httpOnly: true })
      return new Response(null, { status: 302, headers: { location: portalOrigin + '/app' } })
    }
    if (url.hostname === 'open.feishu.cn') return new Response(null, { status: 302, headers: { location: portalOrigin + '/app' } })
    assert.equal(url.origin, portalOrigin)
    assert.ok((await jar.cookies.get({ url: url.href })).some(cookie => cookie.name === 'portal-fixture'))
    assert.ok(!request.headers.get('cookie')?.includes('passport-fixture'))
    if (url.pathname.startsWith('/developers/')) {
      assert.equal(request.headers.get('x-csrf-token'), 'fixture-csrf')
      assert.equal(request.headers.get('referer'), portalOrigin + '/app')
      return json({ code: 0, data: {} })
    }
    return new Response('<script>(()=>{window.user=' + JSON.stringify(user) + ';window.csrfToken="fixture-csrf";window.outDomain={larkOpen:"' + portalOrigin + '"};})()</script>')
  })
})
const store = {
  record: null,
  async read() { return this.record },
  async replace(input) {
    this.record = { ...input, revision: this.record.revision + 1 }
    return this.record.revision
  }
}
app.whenReady().then(async () => {
  let qr
  const stages = []
  const service = new ElectronFeishuDeveloperSessionService(store, undefined, {
    profile: { pollIntervalMs: 20 }, diagnostic() {}
  })
  await service.beginLogin({ onQrReady: value => { qr = value.payload }, onStatus: value => stages.push(value) })
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'Production login must not create a BrowserWindow')
  assert.deepEqual(stages, ['loading_local_session', 'preparing', 'awaiting_scan', 'completing_login', 'inspecting_identity'])
  assert.equal(new Set(calls.map(call => call.session)).size, 1, 'All login requests must use the same Electron Session')
  assert.equal(store.record, null, 'Remote success is only a pending local session')
  const pending = service.pendingConnection()
  store.record = { ...pending, provider: 'feishu', accountId: 'fixture-account', revision: 1 }
  await service.activatePendingLogin(1)
  const restored = new ElectronFeishuDeveloperSessionService(store, undefined, { diagnostic() {} })
  assert.equal((await restored.inspect()).status, 'valid')
  const platform = await restored.openPlatformSession({ expectedIdentity: { userId: 'fixture-user', tenantId: 'fixture-tenant' } })
  assert.equal(platform.apiOrigin, portalOrigin)
  assert.equal(platform.brand, 'feishu')
  assert.equal((await platform.fetch(portalOrigin + '/developers/v1/fixture', { method: 'POST' })).status, 200)
  const nativeJar = jars.at(-1)
  const bounded = new FeishuSessionHttp({ fetch: (url, init) => requestInFeishuSession(nativeJar, url, init) }, 60)
  await assert.rejects(bounded.request(portalOrigin + '/body-timeout', { kind: 'navigation' }), /feishu_request_timeout/)
  await service.disconnect()
  await restored.disconnect()
  let liveProbe = null
  if (process.env.ROVAI_FEISHU_LIVE_PROBE === '1') {
    const jar = session.fromPartition('feishu-anonymous-live-probe', { cache: false })
    jar.protocol.unhandle('https')
    try {
      const protocol = new FeishuLoginProtocol()
      const http = new FeishuSessionHttp({ fetch: (url, init) => requestInFeishuSession(jar, url, init) })
      const signal = AbortSignal.timeout(30_000)
      const initialized = await protocol.initialize(http, signal)
      const poll = await protocol.poll(http, initialized.flowKey, signal)
      assert.equal(poll.kind, 'waiting')
      liveProbe = { init: 'valid', polling: poll.kind, serverExpiry: initialized.expiresAt }
    } finally { await jar.clearStorageData() }
  }
  parent = new BrowserWindow({ show: false, width: 1040, height: 700, useContentSize: true,
    title: 'Rovai 飞书登录 · 自动验收（无需扫码）',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await parent.loadFile(join(fixture, 'renderer/index.html'))
  const cases = await parent.webContents.executeJavaScript('window.feishuLoginTest.run(' + JSON.stringify(qr) + ')')
  cases.push('real Electron Session HTTP login, trusted redirects, passive HTML, Cookie restoration and management without login windows')
  parent.showInactive()
  for (const theme of ['day', 'night']) {
    for (const stage of ['awaiting_scan', 'completing_login', 'saving_local_session', 'failed']) {
      await parent.webContents.executeJavaScript('window.feishuLoginTest.capture(' + JSON.stringify(theme) + ',' + JSON.stringify(stage) + ',' + JSON.stringify(qr) + ')')
      writeFileSync(join(fixture, theme + '-' + stage + '.png'), (await parent.capturePage()).toPNG())
    }
  }
  parent.webContents.setZoomFactor(2)
  await parent.webContents.executeJavaScript('window.feishuLoginTest.capture("night","saving_local_session",' + JSON.stringify(qr) + ')')
  writeFileSync(join(fixture, 'night-200-percent.png'), (await parent.capturePage()).toPNG())
  cases.push('day/night layouts at 1040x700 and 200 percent zoom')
  process.stdout.write(JSON.stringify({ ok: true, cases, liveProbe }) + '\n')
  parent.destroy()
  app.exit(0)
}).catch(error => {
  process.stderr.write(String(error.stack || error) + '\n')
  parent?.destroy()
  app.exit(1)
})
