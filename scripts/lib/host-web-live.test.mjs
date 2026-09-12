import assert from 'node:assert/strict'
import { mkdir, writeFile, realpath, mkdtemp, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'
import { DatabaseSync } from 'node:sqlite'
import electron from 'electron'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'
const root = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Owns the real native entry + browser shared-page seam. The component fixture
// cannot detect bootstrap/reauth remounts or IPC/HTTP editor ownership mistakes.
// Core records use execution:null; real model/approval evidence is a separate smoke.
test('actual Desktop and browser share Camp geometry while three drafts and reauthentication stay independent', { timeout: 240_000 }, async t => {
  if (process.platform !== 'darwin') { t.skip('This native Desktop acceptance currently requires macOS; no other platform qualification claimed.'); return }
  try { await access(chrome) } catch { t.skip('A local Chrome binary is required for actual browser acceptance.'); return }
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-real-desktop-web-')))
  const output = process.env.ROVAI_HOST_WEB_LIVE_OUTPUT ?? fixture
  await mkdir(output, { recursive: true })
  const userData = join(fixture, 'user-data'); await mkdir(userData, { mode: 0o700 })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', fixture, userData, skills: join(userData, 'managed-skill-library') }))
  let desktop, web, second
  try {
    desktop = await launchBrowser('desktop', userData)
    await desktop.wait(`Boolean(window.rovai?.request)`)
    await desktop.wait(`window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`)
    const request = (method, params = {}) => desktop.evaluate(`window.rovai.request(${JSON.stringify(method)},${JSON.stringify(params)})`)
    const info = await request('app.info'); assert.ok(info.dataDir.startsWith(userData)); console.log(JSON.stringify({ stage: 'desktop-ready', data: info.dataDir }))
    await desktop.evaluate(`(async()=>{const api=window.rovai.onboarding;let s=await api.get();if(s.status==='uninitialized')s=await api.showWelcome();if(s.status==='in_progress'&&s.step==='welcome')s=await api.completeWelcome();if(s.status==='in_progress'&&s.step==='member'){await api.selectMember('luoke');s=await api.completeMemberSelection()}if(s.status==='in_progress'&&s.step==='runtime')s=await api.deferRuntimeSetup();return s.status})()`)
    await desktop.send('Page.reload'); await desktop.wait(`document.querySelector('.unified-sidebar')!==null`)
    await desktop.evaluate(`window.rovai.appearance.setPreference('day')`)
    const profiles = await request('members.list')
    const created = await request('camps.create', { commandId: crypto.randomUUID(), name: 'Desktop and Web live parity', workspace: null, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
    assert.equal(created.status, 'applied', JSON.stringify(created)); const campId = created.payload.campId
    for (let i = 1; i <= 8; i++) {
      const draft = await request('camp.composerDraft.get', { campId })
      const saved = await request('camp.composerDraft.save', { campId, expectedRevision: draft.revision, content: { version: 2, segments: [{ kind: 'text', text: `Controlled Host record ${i}.\n\n**Shared production Camp** preserves message structure and reading position.\n\n\`commandId\` belongs to Rust Host.` }] } })
      await request('camp.messages.send', { commandId: crypto.randomUUID(), campId, draftRevision: saved.revision, execution: null })
    }
    const choose = async browser => { await browser.wait(`document.body.innerText.includes('Desktop and Web live parity')`); await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Desktop and Web live parity'))`); await browser.wait(`document.querySelector('[contenteditable=true]') !== null`) }
    await choose(desktop)
    const started = await desktop.evaluate(`window.rovai.hostWeb.start({listen:'127.0.0.1:0',allowInsecureLan:false})`)
    const login = async (browser, token) => { await browser.wait(`document.querySelector('#administrator-token') !== null`); await browser.click(`document.querySelector('#administrator-token')`); await browser.send('Input.insertText', { text: token }); await browser.click(`document.querySelector('.web-login button[type=submit]')`); await browser.wait(`document.querySelector('.web-login-overlay') === null`) }
    web = await launchBrowser('web', join(fixture, 'chrome-a')); await web.send('Page.navigate', { url: started.origin }); await login(web, started.administratorToken); await choose(web)
    await pause(1200)
    const geometry = async browser => browser.evaluate(`({viewport:[innerWidth,innerHeight],sidebar:document.querySelector('.unified-sidebar').getBoundingClientRect().width,header:document.querySelector('.camp-topbar')?.getBoundingClientRect().height,composer:document.querySelector('[contenteditable=true]').getBoundingClientRect().width})`)
    assert.deepEqual(await geometry(desktop), await geometry(web)); assert.equal((await geometry(web)).sidebar, 270); assert.equal((await geometry(web)).header, 38)
    await desktop.capture(join(output, 'desktop-day.png')); await web.capture(join(output, 'web-day.png'))
    await desktop.evaluate(`window.rovai.appearance.setPreference('night')`); await web.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await pause(400)
    await desktop.capture(join(output, 'desktop-night.png')); await web.capture(join(output, 'web-night.png'))
    const type = async (browser, text) => { await browser.click(`document.querySelector('[contenteditable=true]')`); await browser.send('Input.insertText', { text }) }
    await type(desktop, 'Desktop draft remains independent.')
    await type(web, 'Browser A draft survives reauthentication.')
    await web.evaluate(`window.__acceptedComposer=document.querySelector('[contenteditable=true]');true`)
    second = await launchBrowser('web', join(fixture, 'chrome-b')); await second.send('Page.navigate', { url: started.origin }); await login(second, started.administratorToken); await choose(second)
    assert.equal(await second.evaluate(`document.querySelector('[contenteditable=true]').textContent`), '')
    await type(second, 'Browser B independent draft.')
    await pause(1500)
    const db = new DatabaseSync(join(info.dataDir, 'rovai.sqlite'), { readOnly: true })
    const rows = db.prepare('select client_id,structured_content_json,revision from camp_composer_draft where camp_id=?').all(campId); db.close()
    assert.equal(rows.length, 3, JSON.stringify(rows)); assert.equal(new Set(rows.map(r => r.client_id)).size, 3)
    for (const text of ['Desktop draft remains independent.', 'Browser A draft survives reauthentication.', 'Browser B independent draft.']) assert.ok(rows.some(r => r.structured_content_json.includes(text)))
    const rotated = await desktop.evaluate(`window.rovai.hostWeb.rotate()`); await login(web, rotated.administratorToken)
    assert.equal(await web.evaluate(`window.__acceptedComposer===document.querySelector('[contenteditable=true]')`), true)
    assert.equal(await web.evaluate(`document.querySelector('[contenteditable=true]').textContent`), 'Browser A draft survives reauthentication.')
    assert.equal(await web.evaluate('typeof window.rovai'), 'undefined')
    assert.deepEqual(desktop.errors, []); assert.deepEqual(web.errors, []); assert.deepEqual(second.errors, [])
    await web.capture(join(output, 'web-after-reauth.png'))
    const evidence = { stage: 'managed-desktop-web-passed', simulation: false, realRuntime: false, campId, geometry: await geometry(web), draftOwners: rows.map(r => r.client_id === 'desktop' ? 'desktop' : 'web'), sameComposerAfterReauth: true, nativeBridgeInBrowser: false }
    await desktop.evaluate(`window.rovai.hostWeb.stop()`)
    assert.ok((await request('app.info')).dataDir)
    await writeFile(join(output, 'desktop-web-live.json'), JSON.stringify({ ...evidence, coreAliveAfterWebStop: true }, null, 2))
    console.log(JSON.stringify({ ...evidence, coreAliveAfterWebStop: true }))
  } finally {
    if (second) await second.close(); if (web) await web.close(); if (desktop) await desktop.close()
    if (process.env.ROVAI_KEEP_HOST_WEB_LIVE_FIXTURE !== '1') {
      await removeEphemeralRuntimeCampFilesRoot(userData, { temporaryDirectory: fixture })
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
async function launchBrowser(surface, profile) {
  const env = { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_HOST_BIN: join(root, 'target/debug/rovai-host') }
  delete env.ELECTRON_RUN_AS_NODE
  const args = surface === 'web'
    ? ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']
    : [root, `--user-data-dir=${profile}`, '--remote-debugging-port=0']
  return launchAcceptanceBrowser({ executable: surface === 'web' ? chrome : electron, args, env })
}
