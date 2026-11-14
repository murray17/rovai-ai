import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { launchHost, within } from './lib/host-test-client.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'
import { createServer as createViteServer } from 'vite'

// Actual production Web + Rust Host + production Main operation adapter.
// Platform service responses are controlled fixtures: no account or Bot is changed.
const root = resolve(import.meta.dirname, '..')
// Match the Host integration test: native type stripping cannot resolve the
// production adapter's extensionless imports.
const vite = await createViteServer({ root, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } })
const { createHostChannelHandler, parseHostChannelRequest } = await vite.ssrLoadModule('/apps/desktop/src/main/host-channels.ts')
await vite.close()

if (process.platform !== 'darwin') throw Error('This browser acceptance is macOS-only; native Windows evidence is separate')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-channels-ui-')))
const data = join(fixture, 'data'), skills = join(fixture, 'skills')
await mkdir(skills)
const output = resolve(process.env.ROVAI_CHANNEL_UI_OUTPUT ?? join(fixture, 'evidence')); await mkdir(output, { recursive: true })
console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir: data, skillLibraryRoot: skills, mcpConfigPath: join(data, 'mcp.json'), runtime: false, platformService: 'fixture' }))
const host = launchHost(join(root, 'target/debug/rovai-host'), [...coreDataDirectoryArguments(data), '--skill-library-root', skills, '--mcp-config-path', join(data, 'mcp.json')], { cwd: fixture })
let browser, release, server, serverClosed, stage = 'startup'
let serverOutput = ''
const callbacks = [], operations = []
const snapshot = { schemaVersion: 4, channels: [], pendingBindingCount: 0, bindingIssueCount: 0, activeQrAttempt: null, activeProvisioning: null }
const handler = createHostChannelHandler({
  get: async () => snapshot,
  async publishMemberBot(agentId, kind) {
    operations.push(['publish', agentId, kind])
    snapshot.channels[1].provisioning = { kind, publicationIntentId: 'original-publication', agentId, stage: 'creating_app', detail: '正在创建独立应用…', remoteAppId: 'original-app', failureCode: null }
    // An unrelated provider's legacy aggregate must not hide this dialog.
    snapshot.activeProvisioning = { ...snapshot.channels[1].provisioning, kind: 'feishu', publicationIntentId: 'other-provider', stage: 'completed' }
    await new Promise(resolve => { release = resolve })
    snapshot.channels[1].provisioning = { ...snapshot.channels[1].provisioning, stage: 'failed', detail: '请选择版本审批人。', failureCode: 'dingtalk_approver_selection_required', approvalCandidates: [{ userId: 'owner-choice', displayName: '测试审批人' }] }
    snapshot.channels[1].memberBots = [{ agentId, publicationStatus: 'failed', published: false, connectionStatus: 'unknown', botDisplayName: '测试队员 Bot', appId: 'original-app', managementUrl: null, failureCode: 'dingtalk_approver_selection_required' }]
    return snapshot
  },
  async retryMemberBot(agentId, kind) {
    operations.push(['retry', agentId, kind])
    snapshot.channels[0].provisioning = { kind, publicationIntentId: 'recovery-publication', agentId, stage: 'connecting_bot', detail: 'Bot 已发布，正在重连。', remoteAppId: 'existing-bot', failureCode: null }
    snapshot.channels[0].memberBots[0] = { ...snapshot.channels[0].memberBots[0], connectionStatus: 'reconnecting', connectionFailureCode: 'transport_error', canReconcile: false }
    return snapshot
  },
  async selectPublicationApprover(agentId, userId, kind) {
    operations.push(['selectApprover', agentId, userId, kind])
    assert.equal(userId, 'owner-choice'); assert.equal(snapshot.channels[1].provisioning.remoteAppId, 'original-app')
    snapshot.channels[1].provisioning = { ...snapshot.channels[1].provisioning, stage: 'completed', failureCode: null, detail: '发布完成。', approvalCandidates: [] }
    snapshot.channels[1].memberBots[0] = { ...snapshot.channels[1].memberBots[0], publicationStatus: 'published', published: true, connectionStatus: 'online', failureCode: null }
    return snapshot
  }
})
host.onNotification(message => {
  if (message.method !== 'host.channels.request') return
  callbacks.push((async () => {
    const request = parseHostChannelRequest(message.params.request); assert.ok(request)
    await host.request('host.channels.reply', { requestId: message.params.requestId, reply: await handler(request) })
  })())
})
const selectSection = async label => {
  const button = `[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`
  await browser.wait(`${button}!==undefined`); await browser.click(button)
}
try {
  await within(host.ready)
  const profiles = await host.request('members.list'), member = profiles[0]; assert.ok(member)
  for (const kind of ['feishu', 'dingtalk']) snapshot.channels.push({ kind, displayName: kind === 'feishu' ? '飞书' : '钉钉', hostStatus: 'ready', connection: { status: 'connected', sessionStatus: 'valid', account: { accountId: `${kind}-fixture`, userName: '测试账号', tenantName: '测试企业', brand: kind, connectedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString() } }, memberBots: kind === 'feishu' ? [{ agentId: member.agentId, publicationStatus: 'published', published: true, connectionStatus: 'reconnecting', connectionFailureCode: 'transport_error', connectionNeedsAttention: true, botDisplayName: member.displayName, appId: 'existing-bot', managementUrl: 'https://open.feishu.cn/app/existing-bot/baseinfo', failureCode: null }] : [] })
  const web = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory: join(root, 'out/web') })
  browser = await launchAcceptanceBrowser({ executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'browser')}`, 'about:blank'] })
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.send('Page.navigate', { url: web.origin })
  await browser.wait(`document.querySelector('#administrator-token')!==null`)
  await browser.click(`document.querySelector('#administrator-token')`)
  await browser.send('Input.insertText', { text: web.administratorToken })
  await browser.click(`document.querySelector('.web-login button[type=submit]')`)
  await browser.wait(`document.querySelector('.unified-sidebar')!==null && document.querySelector('.web-login-overlay')===null`)
  stage = 'hosted channels'
  assert.equal(await browser.evaluate('typeof window.rovai'), 'undefined')
  assert.equal(await browser.evaluate(`document.querySelector('.unified-sidebar').innerText.includes('退出登录')`), false)
  await browser.click(`document.querySelector('.sidebar-settings-entry button[aria-label^="设置"]')`)
  await selectSection('渠道')
  await browser.wait(`document.querySelector('.channel-connection-indicator[data-connection-state=reconnecting]')!==null`)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-settings').textContent.includes('运行此服务的 Rovai Desktop')`), true)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-connection-actions')===null`), true)
  assert.equal(await browser.evaluate(`document.querySelector('.execution-web-settings')===null`), true)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-member-bot-row').innerText.includes('正在重连')`), false)
  const signalPoint = await browser.evaluate(`(()=>{const r=document.querySelector('.channel-connection-indicator').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...signalPoint })
  await browser.wait(`document.querySelector('.channel-connection-tooltip')?.textContent==='连接暂不可用，请检查网络或代理'`)
  await browser.capture(join(output, 'desktop-web-signal-tooltip.png'))
  await browser.key('Escape')
  await browser.wait(`document.querySelector('.channel-connection-tooltip')===null`)
  const signal = `document.querySelector('.channel-connection-indicator')`
  const hintOpen = `document.querySelector('.channel-connection-tooltip')!==null`
  const hintClosed = `document.querySelector('.channel-connection-tooltip')===null`
  assert.equal(await browser.evaluate(`${signal}.hasAttribute('aria-describedby')`), false)
  await browser.evaluate(`${signal}.focus()`)
  await browser.wait(hintOpen)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
  await pause(180)
  assert.equal(await browser.evaluate(hintOpen), true)
  await browser.evaluate(`document.querySelector('.channel-member-action a').focus()`)
  await browser.wait(hintClosed)
  await browser.click(signal)
  await pause(180)
  assert.equal(await browser.evaluate(hintOpen), true)
  await browser.key('Escape')
  assert.equal(await browser.evaluate(`document.activeElement===${signal}`), true)
  await browser.wait(hintClosed)
  await browser.evaluate(`${signal}.blur()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...signalPoint })
  await browser.wait(hintOpen)
  await browser.click(`document.querySelector('.channel-section-heading h2')`)
  await browser.wait(hintClosed)
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 600, deviceScaleFactor: 1, mobile: false })
  await browser.click(signal)
  await browser.wait(hintOpen)
  const beforeScroll = await browser.evaluate(`document.querySelector('.settings-panel').scrollTop`)
  await browser.evaluate(`(()=>{const panel=document.querySelector('.settings-panel');panel.scrollTop+=panel.scrollTop>0?-24:24})()`)
  assert.notEqual(await browser.evaluate(`document.querySelector('.settings-panel').scrollTop`), beforeScroll)
  await browser.wait(hintClosed)
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.evaluate(`document.querySelector('.settings-panel').scrollTop=0`)
  await pause(100)
  await browser.evaluate(`${signal}.blur();${signal}.focus()`)
  await browser.wait(hintOpen)
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.wait(hintClosed)
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.capture(join(output, 'desktop-web-channels-day.png'))
  // Change the existing theme preference through its normal DOM token for the
  // same production surface; no alternate layout or mocked page is rendered.
  await browser.evaluate(`document.documentElement.dataset.theme='night'`)
  await browser.capture(join(output, 'desktop-web-channels-night.png'))
  await browser.evaluate(`document.documentElement.dataset.theme='day'`)
  snapshot.channels[0].memberBots[0] = { ...snapshot.channels[0].memberBots[0], connectionStatus: 'offline',
    connectionFailureCode: 'identity_conflict', canReconcile: true }
  await browser.wait(`document.querySelector('.channel-connection-indicator')?.getAttribute('aria-label').includes('Bot 身份与已绑定应用不符')`)
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.channel-member-action button')].some(e=>e.textContent.trim()==='继续核对')`), true)
  await browser.capture(join(output, 'desktop-web-channels-terminal.png'))
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 980, deviceScaleFactor: 1, mobile: false })
  await pause(100)
  assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true)
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.channel-member-bot-row')].every(row=>getComputedStyle(row).gridTemplateColumns.split(' ').length===2 && [...row.children].every(cell=>{const r=cell.getBoundingClientRect(),p=row.getBoundingClientRect();return r.left>=p.left && r.right<=p.right+1}))`), true)
  await browser.click(`document.querySelector('.channel-connection-indicator')`)
  await browser.wait(`document.querySelector('.channel-connection-tooltip')!==null`)
  assert.equal(await browser.evaluate(`(()=>{const tip=document.querySelector('.channel-connection-tooltip'),r=tip.getBoundingClientRect();return tip.parentElement===document.body && r.left>=12 && r.right<=innerWidth-12 && r.top>=0 && r.bottom<=innerHeight})()`), true)
  await browser.capture(join(output, 'desktop-web-channels-narrow-tooltip.png'))
  await browser.key('Escape')
  await browser.capture(join(output, 'desktop-web-channels-narrow.png'))
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  stage = 'background connection recovery'
  await browser.wait(`[...document.querySelectorAll('.channel-member-action button')].some(e=>e.textContent.trim()==='继续核对')`)
  await browser.click(`[...document.querySelectorAll('.channel-member-action button')].find(e=>e.textContent.trim()==='继续核对')`)
  await browser.wait(`document.querySelector('.channel-publish-dialog')?.textContent.includes('Bot 已发布，正在重连。')`)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-publish-dialog [role=alert]')===null`), true)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-publish-dialog .primary-button')===null`), true)
  await browser.capture(join(output, 'desktop-web-publish-recovery.png'))
  await browser.click(`[...document.querySelectorAll('.channel-publish-dialog button')].find(e=>e.textContent.trim()==='关闭')`)
  await browser.wait(`document.querySelector('.channel-publish-dialog')===null && document.querySelector('.channel-connection-indicator[data-connection-state=reconnecting]')!==null`)
  await browser.click(`document.querySelector('.channel-connection-indicator')`)
  await browser.wait(`document.querySelector('.channel-connection-tooltip')!==null`)
  snapshot.channels[0].memberBots[0] = { ...snapshot.channels[0].memberBots[0], connectionStatus: 'online', connectionFailureCode: null, connectionNeedsAttention: false }
  snapshot.channels[0].provisioning = { ...snapshot.channels[0].provisioning, stage: 'completed', detail: '发布完成。' }
  await browser.wait(`document.querySelector('.channel-member-bot-row .channel-publication-label')?.textContent==='已发布' && document.querySelector('.channel-connection-indicator')===null && document.querySelector('.channel-connection-tooltip')===null`)
  assert.equal(await browser.evaluate(`document.querySelector('.channel-member-action').textContent.includes('继续核对')`), false)
  await browser.capture(join(output, 'desktop-web-channels-recovered.png'))

  await browser.wait(`[...document.querySelectorAll('.channel-provider-tab')].some(e=>e.textContent.includes('钉钉'))`)
  await browser.click(`[...document.querySelectorAll('.channel-provider-tab')].find(e=>e.textContent.includes('钉钉'))`)
  const row = `[...document.querySelectorAll('.channel-member-bot-row')].find(e=>e.textContent.includes(${JSON.stringify(member.displayName)}))`
  await browser.click(`${row}.querySelector('button')`)
  await browser.wait(`document.querySelector('.channel-publish-dialog')!==null`)
  await browser.click(`[...document.querySelectorAll('.channel-publish-dialog button')].find(e=>e.textContent.trim()==='确认发布')`)
  await browser.wait(`document.querySelector('.channel-provisioning-state')?.textContent.includes('正在创建独立应用')`)
  assert.ok(release); release()
  stage = 'structured approver'
  await browser.wait(`document.querySelector('.channel-approver-select select')!==null`)
  await browser.capture(join(output, 'desktop-web-approver.png'))
  await browser.evaluate(`(()=>{const e=document.querySelector('.channel-approver-select select');e.value='owner-choice';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await browser.click(`[...document.querySelectorAll('.channel-publish-dialog button')].find(e=>e.textContent.trim()==='提交审批并继续发布')`)
  await browser.wait(`document.querySelector('.channel-publish-dialog')===null && Boolean(${row}) && (${row}).querySelector('.channel-publication-label')?.textContent==='已发布' && (${row}).querySelector('.channel-connection-indicator')===null`)
  assert.deepEqual(operations, [['retry', member.agentId, 'feishu'], ['publish', member.agentId, 'dingtalk'], ['selectApprover', member.agentId, 'owner-choice', 'dingtalk']])
  stage = 'logout'
  await selectSection('远程连接')
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].filter(e=>e.textContent.trim()==='退出登录').length`), 1)
  await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='退出登录')`)
  await browser.wait(`document.querySelector('.web-login-overlay')!==null`)
  assert.equal((await host.request('host.web.status')).enabled, true)
  assert.ok(await host.request('app.info'))
  assert.deepEqual(browser.errors, [])
  await Promise.all(callbacks)
  stage = 'standalone channel boundary'
  const serverData = join(fixture, 'server-data')
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir: serverData, skillLibraryRoot: join(serverData, 'skills'), mcpConfigPath: join(serverData, 'mcp.json'), runtime: false }))
  server = spawn(join(root, 'target/debug/rovai-server'), ['--data-dir', serverData, '--web-ui', join(root, 'out/web'), '--listen', '127.0.0.1:0'], { stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', bytes => { serverOutput += bytes }); server.stderr.on('data', bytes => { serverOutput += bytes })
  serverClosed = new Promise(resolve => server.once('close', resolve))
  await within((async () => { while (!serverOutput.includes('Foreground')) { if (server.exitCode !== null) throw Error('Standalone fixture exited before ready'); await pause(50) } })())
  const serverOrigin = /Address  (http:\/\/127\.0\.0\.1:\d+)/.exec(serverOutput)?.[1]; assert.ok(serverOrigin)
  const serverToken = await readFile(join(serverData, 'server-token'), 'utf8')
  assert.equal(serverOutput.includes(serverToken), false)
  const loginServer = async () => {
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: serverToken })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.unified-sidebar')!==null && document.querySelector('.web-login-overlay')===null`)
  }
  await browser.send('Page.navigate', { url: serverOrigin }); await loginServer()
  await browser.click(`document.querySelector('.sidebar-settings-entry button[aria-label^="设置"]')`)
  await browser.wait(`document.querySelector('.settings-sidebar-menu')!==null`)
  assert.equal(await browser.evaluate(`[...document.querySelectorAll('.settings-sidebar-menu button')].some(e=>e.textContent.trim()==='渠道')`), false)
  await selectSection('远程连接')
  await browser.evaluate(`(()=>{const key=Object.keys(sessionStorage).find(key=>key.startsWith('rovai.web.history.v1:'));const saved=JSON.parse(sessionStorage.getItem(key));const target={kind:'settings',section:'channels'};saved.snapshot.entries[saved.snapshot.index]=target;sessionStorage.setItem(key,JSON.stringify(saved));history.replaceState({rovai:{...history.state.rovai,target}},'')})()`)
  await browser.send('Page.reload')
  await browser.wait(`document.body.innerText.includes('独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。')`)
  await browser.capture(join(output, 'standalone-legacy-channel.png'))
  assert.equal(await browser.evaluate(`document.querySelector('.channel-member-bot-table')===null`), true)
  assert.deepEqual(browser.errors, [])
  await writeFile(join(output, 'validation.json'), JSON.stringify({ status: 'passed', platform: process.platform, realHost: true, productionWeb: true, productionMainAdapter: true, desktopService: 'fixture', realPlatformPublication: false, electronProcess: false, nativeBridgeInBrowser: false, liveProgressReadback: true, connectionRecoveryVisible: true, compactSignalIndicator: true, healthySignalHidden: true, recoveryRemovesOpenTooltip: true, hoverTooltipVerified: true, focusClickTooltipVerified: true, blurOutsideScrollResizeDismissed: true, rightEdgeTooltipVerified: true, singleAccessibleReason: true, backgroundConnectionDialog: true, terminalReconcileVisible: true, narrowNoOverflow: true, narrowCellsContained: true, structuredApproverSubmitted: true, originalPublicationIdentity: true, logoutOnlyInRemoteSettings: true, logoutKeepsHost: true, standaloneChannelNavigationHidden: true, standaloneLegacyRouteExplained: true, screenshots: ['desktop-web-channels-recovered.png', 'desktop-web-signal-tooltip.png', 'desktop-web-channels-narrow-tooltip.png', 'desktop-web-channels-day.png', 'desktop-web-channels-night.png', 'desktop-web-channels-terminal.png', 'desktop-web-channels-narrow.png', 'desktop-web-publish-recovery.png', 'desktop-web-approver.png', 'standalone-legacy-channel.png'] }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', evidence: output }))
} catch (error) {
  console.error('Channel UI acceptance failed at', stage)
  if (browser) await browser.capture(join(output, 'failure.png')).catch(() => {})
  throw error
} finally {
  release?.()
  if (browser) await browser.close()
  if (server) { server.kill('SIGINT'); const timer = setTimeout(() => server.kill('SIGKILL'), 15_000); try { await serverClosed } finally { clearTimeout(timer) } }
  await host.close()
  await removeEphemeralRuntimeCampFilesRoot(data)
  await rm(fixture, { recursive: true, force: true })
}
