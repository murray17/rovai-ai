import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchAcceptanceBrowser } from './lib/host-web-browser.mjs'

// Owns actual Main legacy import + production Web settings / creation. Only
// Runtime availability is a browser response fixture; no model is launched.
const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-preferences-')))
const userData = join(fixture, 'user-data')
const output = resolve(process.argv[2] ?? join(fixture, 'evidence'))
await mkdir(userData); await mkdir(output, { recursive: true })
const legacy = { schemaVersion: 4, startupLocationMode: 'last_location', lastSettingsSection: 'general', executionConsolePlacement: 'inspector', worldMapEnabled: false, newConversationDefaults: { memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1' }, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: true }
await writeFile(join(userData, 'general-preferences.json'), JSON.stringify(legacy), { mode: 0o600 })
console.log(JSON.stringify({ channel: 'packaged_acceptance', userData, skillLibraryRoot: join(userData, 'managed-skill-library'), mcpConfigPath: join(userData, 'mcp.json'), runtime: false, runtimeAvailability: 'browser-fixture' }))
const env = { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' }; delete env.ELECTRON_RUN_AS_NODE
let app, browser
try {
  app = await launchAcceptanceBrowser({ executable: join(root, 'dist/mac-arm64/Rovai AI.app/Contents/MacOS/Rovai AI'), args: ['--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${userData}`], env })
  console.log('stage: Core readiness')
  await app.send('Page.bringToFront')
  await app.wait(`window.rovai?.supervisor && window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`, 60_000)
  console.log('stage: onboarding welcome')
  await app.wait(`Boolean(document.querySelector('.onboarding-primary'))`)
  await app.click(`document.querySelector('.onboarding-primary')`)
  console.log('stage: onboarding members')
  await app.wait(`Boolean(document.querySelector('#onboarding-member-title'))`)
  await app.click(`document.querySelector('.onboarding-primary')`)
  console.log('stage: onboarding runtime')
  await app.wait(`Boolean(document.querySelector('#onboarding-runtime-title'))`)
  await app.evaluate('window.rovai.onboarding.deferRuntimeSetup()')
  await app.send('Page.reload')
  await app.wait(`Boolean(document.querySelector('.unified-sidebar'))`)
  console.log('stage: legacy import')
  const imported = await app.evaluate('window.rovai.generalPreferences.get()')
  assert.deepEqual(imported.newConversationDefaults, legacy.newConversationDefaults)
  assert.equal(imported.oneClickNewConversationEnabled, true)
  const members = await app.evaluate(`window.rovai.request('members.list')`)
  assert.ok(members.some(m=>m.agentId==='agent_1') && members.some(m=>m.agentId==='agent_2'))
  const web = await app.evaluate(`window.rovai.hostWeb.start({listen:'127.0.0.1:0',allowInsecureLan:false})`)
  browser = await launchAcceptanceBrowser({ executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'browser')}`, 'about:blank'] })
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch.bind(window); window.__createdPreferenceCamps = [];
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (!String(args[0]).endsWith('/api/v1/request')) return response;
      const operation = JSON.parse(args[1]?.body ?? '{}').operation;
      if (operation === 'camps.create') { const reply = await response.clone().json(); if(reply.result?.payload?.threadId) window.__createdPreferenceCamps.push(reply.result.payload.threadId); }
      if(operation !== 'members.list' || !response.ok) return response;
      const body = await response.clone().json();
      body.result = body.result.map(member => ({ ...member, runtimeConfiguration: { adapterKind:'codex-cli', model:{mode:'runtime_default'}, permissions:{adapterKind:'codex-cli',schemaVersion:1,values:{sandbox_mode:'workspace-write',approval_policy:'on-request'}} }, runtimeReadiness:{...member.runtimeReadiness,status:'light_ready'} }));
      return new Response(JSON.stringify(body), {status:response.status,headers:response.headers});
    };
  })()` })
  await browser.send('Page.navigate', { url: web.origin })
  await browser.wait(`Boolean(document.querySelector('.web-login input'))`)
  await browser.click(`document.querySelector('.web-login input')`)
  await browser.send('Input.insertText', { text: web.administratorToken })
  await browser.click(`document.querySelector('.web-login button[type="submit"]')`)
  await browser.wait(`Boolean(document.querySelector('.unified-sidebar') && !document.querySelector('.web-login-overlay'))`)
  const settings = async (surface, section) => {
    // Native windows can be occluded while the browser is active; click waits
    // for a rendered frame, so activate the owned surface before pointer input.
    console.log(`stage: ${surface === app ? 'Desktop' : 'Web'} settings ${section}`)
    console.log(`surface visibility before focus: ${await surface.evaluate('document.visibilityState')}`)
    await surface.send('Page.bringToFront')
    if (!await surface.evaluate(`Boolean(document.querySelector('.settings-sidebar-menu'))`)) await surface.click(`document.querySelector('.sidebar-settings-entry button')`)
    await surface.wait(`Boolean(document.querySelector('.settings-sidebar-menu'))`)
    await surface.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()===${JSON.stringify(section)})`)
  }
  console.log('stage: Web general settings')
  await settings(browser, '通用')
  await browser.wait(`Boolean(document.querySelector('input[aria-label="一键创建新对话"]')?.checked === true)`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('.general-default-member input:checked').length`), 1)
  assert.ok(await browser.evaluate(`document.querySelector('.general-default-member:has(input:checked)').textContent.includes(${JSON.stringify(members.find(m=>m.agentId==='agent_1').displayName)})`))
  await browser.capture(join(output, 'web-defaults-imported.png'))
  await browser.click(`document.querySelector('input[aria-label="一键创建新对话"]')`)
  await browser.wait(`Boolean(document.querySelector('input[aria-label="一键创建新对话"]')?.checked === false)`)
  assert.equal((await app.evaluate('window.rovai.generalPreferences.get()')).oneClickNewConversationEnabled, false)
  const secondName = members.find(m=>m.agentId==='agent_2').displayName
  await browser.click(`[...document.querySelectorAll('.general-default-member')].find(e=>e.textContent.includes(${JSON.stringify(secondName)}))`)
  await browser.click(`document.querySelector('.general-save-row button')`)
  await browser.wait(`Boolean(document.querySelector('.general-save-row button')?.disabled === true && document.querySelector('.general-save-row button')?.textContent.trim() === '保存' && document.querySelector('.general-draft-state')?.textContent.trim() === '已保存')`)
  const saved = await app.evaluate('window.rovai.generalPreferences.get()')
  assert.deepEqual(saved.newConversationDefaults.memberAgentIds, ['agent_1','agent_2'])
  assert.equal(saved.oneClickNewConversationEnabled, false)
  await settings(app, '通用')
  await app.wait(`Boolean(document.querySelectorAll('.general-default-member input:checked').length === 2)`)
  await app.capture(join(output, 'desktop-defaults-updated.png'))
  // Use real theme controls before inspecting each dialog; never change theme DOM directly.
  console.log('stage: creation dialog')
  const dialogColors = []
  for (const theme of ['day', 'night']) {
    await settings(browser, '外观')
    await browser.wait(`Boolean(document.querySelector('input[value="${theme}"]'))`)
    await browser.click(`document.querySelector('input[value="${theme}"]').closest('label')`)
    await browser.wait(`Boolean(document.documentElement.dataset.theme === '${theme}')`)
    await browser.click(`document.querySelector('.settings-sidebar-back')`)
    await browser.wait(`Boolean(document.querySelector('button[aria-label="新对话"]'))`)
    await browser.click(`document.querySelector('button[aria-label="新对话"]')`)
    await browser.wait(`Boolean(document.querySelector('.new-camp-dialog .compact-primary:not(:disabled)'))`)
    const color = await browser.evaluate(`(()=>{const b=document.querySelector('.new-camp-dialog .compact-primary');return {background:getComputedStyle(b).backgroundColor,foreground:getComputedStyle(b).color}})()`)
    const channels = color.background.match(/\d+/g).map(Number)
    assert.ok(Math.max(...channels)-Math.min(...channels)<15)
    assert.ok(theme==='day' ? Math.max(...channels)<70 : Math.min(...channels)>150)
    dialogColors.push({theme,...color})
    await browser.click(`document.querySelector('.new-camp-dialog .member-trigger')`)
    await browser.wait(`Boolean(document.querySelector('.new-camp-member-grid'))`)
    assert.equal(await browser.evaluate(`document.querySelectorAll('.new-camp-member-grid [role="menuitemcheckbox"][data-state="checked"]').length`), 2)
    await browser.key('Escape')
    await browser.capture(join(output, `new-conversation-${theme}.png`))
    if(theme==='day') await browser.click(`document.querySelector('.new-camp-dialog .compact-cancel')`)
  }
  console.log('stage: one-click creation')
  await browser.click(`document.querySelector('.new-camp-quick-label input')`)
  await browser.click(`document.querySelector('.new-camp-dialog .compact-primary')`)
  await browser.wait(`Boolean(window.__createdPreferenceCamps.length===1 && !document.querySelector('.new-camp-dialog') && document.querySelector('#camp-message'))`)
  assert.equal((await app.evaluate('window.rovai.generalPreferences.get()')).oneClickNewConversationEnabled, true)
  await browser.click(`document.querySelector('button[aria-label="新对话"]')`)
  await browser.wait(`Boolean(window.__createdPreferenceCamps.length===2 && !document.querySelector('.new-camp-dialog'))`)
  const created = await browser.evaluate('window.__createdPreferenceCamps')
  const pending = await app.evaluate(`window.rovai.request('camps.open',{traceId:crypto.randomUUID(),threadId:${JSON.stringify(created[1])}})`)
  assert.equal(pending.thread.activationState, 'pending')
  assert.equal(pending.thread.defaultLeadAgentId, 'agent_1')
  await settings(browser, '通用')
  const timeOrigin = await browser.evaluate('performance.timeOrigin')
  await browser.send('Page.reload')
  await browser.wait(`Boolean(performance.timeOrigin!==${timeOrigin} && document.querySelector('input[aria-label="一键创建新对话"]')?.checked === true)`)
  assert.equal(await browser.evaluate(`document.querySelectorAll('.general-default-member input:checked').length`), 2)
  await browser.capture(join(output, 'web-defaults-restored.png'))
  assert.deepEqual(app.errors, []); assert.deepEqual(browser.errors, [])
  await writeFile(join(output, 'validation.json'), JSON.stringify({status:'passed',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),platform:'darwin',architecture:'arm64',packagedApp:true,legacyDesktopImport:true,webGeneralDefaults:true,webChangeVisibleInDesktop:true,newDialogSavedSelection:true,oneClickPendingCreation:true,refreshSettings:true,dialogColors,runtimeAvailability:'browser-fixture',realRuntime:false},null,2)+'\n')
  console.log(JSON.stringify({status:'passed',evidence:output}))
} catch(error) {
  if(browser) await browser.capture(join(output,'failure-web.png')).catch(()=>{})
  if(app) await app.capture(join(output,'failure-desktop.png')).catch(()=>{})
  throw error
} finally {
  if(browser) await browser.close()
  if(app) { try {await app.send('Browser.close')} catch {} await app.close() }
}
