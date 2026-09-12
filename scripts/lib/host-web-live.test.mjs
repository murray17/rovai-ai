import assert from 'node:assert/strict'
import { mkdir, writeFile, realpath, mkdtemp, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createServer } from 'node:net'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'
import { DatabaseSync } from 'node:sqlite'
import electron from 'electron'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'
const root = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Owns the real native entry + browser shared-page seam. The component fixture
// cannot detect bootstrap/reauth remounts or IPC/HTTP editor ownership mistakes.
// Records use execution:null. The pending-return case seeds one needs_repair row
// only in the isolated database so no Runtime can launch; execution/approval has a separate smoke.
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
  let stage = 'native startup'
  try {
    desktop = await launchBrowser('desktop', userData)
    await desktop.wait(`Boolean(window.rovai?.request)`)
    await desktop.wait(`window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`)
    const request = (method, params = {}) => desktop.evaluate(`window.rovai.request(${JSON.stringify(method)},${JSON.stringify(params)})`)
    const info = await request('app.info'); assert.ok(info.dataDir.startsWith(userData)); console.log(JSON.stringify({ stage: 'desktop-ready', data: info.dataDir }))
    stage = 'native onboarding'
    await desktop.evaluate(`(async()=>{const api=window.rovai.onboarding;let s=await api.get();if(s.status==='uninitialized')s=await api.showWelcome();if(s.status==='in_progress'&&s.step==='welcome')s=await api.completeWelcome();if(s.status==='in_progress'&&s.step==='member'){await api.selectMember('luoke');s=await api.completeMemberSelection()}if(s.status==='in_progress'&&s.step==='runtime')s=await api.deferRuntimeSetup();return s.status})()`)
    await desktop.evaluate(`window.__beforeAcceptanceReload=true`)
    await desktop.send('Page.reload')
    await desktop.wait(`window.__beforeAcceptanceReload!==true && document.querySelector('.unified-sidebar')!==null`)
    stage = 'seed shared Camp'
    await desktop.evaluate(`window.rovai.appearance.setPreference('day')`)
    const profiles = await request('members.list')
    const projectPath = join(fixture, 'owner-project'); await mkdir(projectPath)
    const projectWorkspace = { projectPath, name: 'owner-project' } // Fixture path; actual browser inspection below uses HTTP/Core.
    const created = await request('camps.create', { commandId: crypto.randomUUID(), name: 'Desktop and Web live parity', workspace: projectWorkspace, memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId, collaborationMode: 'peer' })
    assert.equal(created.status, 'applied', JSON.stringify(created)); const campId = created.payload.campId
    for (let i = 1; i <= 8; i++) {
      const draft = await request('camp.composerDraft.get', { campId })
      const saved = await request('camp.composerDraft.save', { campId, expectedRevision: draft.revision, content: { version: 2, segments: [{ kind: 'text', text: `Controlled Host record ${i}.\n\n**Shared production Camp** preserves message structure and reading position.\n\n\`commandId\` belongs to Rust Host.` }] } })
      await request('camp.messages.send', { commandId: crypto.randomUUID(), campId, draftRevision: saved.revision, execution: null })
    }
    const choose = async browser => {
      console.log(JSON.stringify({ stage: 'show acceptance surface', surface: browser === desktop ? 'desktop' : 'browser', visibility: await browser.evaluate('document.visibilityState') }))
      // macOS occlusion can keep a CDP-controlled native window hidden even
      // after bringToFront. Use the existing acceptance focus emulation so this
      // shared-page test does not depend on other windows' OS focus.
      if (browser === desktop) await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await browser.send('Page.bringToFront')
      await browser.wait(`document.visibilityState==='visible'`)
      await browser.wait(`document.body.innerText.includes('Desktop and Web live parity')`)
      await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Desktop and Web live parity'))`)
      await browser.wait(`document.querySelector('[contenteditable=true]') !== null`)
    }
    await choose(desktop)
    stage = 'start Web and login'
    const portProbe = createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve)); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve))
    await desktop.click(`document.querySelector('.sidebar-settings-main')`)
    await desktop.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()==='远程连接')`)
    await desktop.wait(`document.querySelector('[aria-label="远程访问"]:not(:disabled)')!==null`)
    await desktop.click(`document.querySelector('#remote-port')`); await desktop.evaluate(`document.querySelector('#remote-port').select()`); await desktop.send('Input.insertText', { text: String(port) })
    await desktop.evaluate(`(()=>{const e=document.querySelector('#remote-access');e.value='lan';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await desktop.click(`document.querySelector('[aria-label="远程访问"]')`)
    await desktop.wait(`document.querySelector('#remote-token')?.value.length===64`)
    const started = { ...await desktop.evaluate(`window.rovai.hostWeb.status()`), ...await desktop.evaluate(`window.rovai.hostWeb.token()`) }
    assert.ok(started.addresses.length > 0)
    await desktop.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='复制地址')`)
    await desktop.wait(`document.body.innerText.includes('连接地址已复制')`)
    await desktop.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='复制令牌')`)
    await desktop.wait(`document.body.innerText.includes('管理令牌已复制')`)
    await desktop.capture(join(output, 'desktop-remote-enabled.png'))
    await desktop.click(`document.querySelector('.settings-sidebar-back')`)
    await choose(desktop)
    const login = async (browser, token) => { await browser.wait(`document.querySelector('#administrator-token') !== null`); await browser.click(`document.querySelector('#administrator-token')`); await browser.send('Input.insertText', { text: token }); await browser.click(`document.querySelector('.web-login button[type=submit]')`); await browser.wait(`document.querySelector('.web-login-overlay') === null`) }
    web = await launchBrowser('web', join(fixture, 'chrome-a')); await web.send('Page.navigate', { url: started.origin }); await login(web, started.administratorToken)
    stage = 'Owner opens a Host directory without preauthorization'
    await web.wait(`document.querySelector('[aria-label="选择工作目录"]:not(:disabled)')!==null`)
    await web.click(`document.querySelector('[aria-label="选择工作目录"]')`)
    await web.wait(`document.querySelector('#host-workspace-path')!==null && !document.querySelector('.web-workspace-list[aria-busy=true]')`)
    await web.click(`document.querySelector('#host-workspace-path')`); await web.evaluate(`document.querySelector('#host-workspace-path').select()`); await web.send('Input.insertText', { text: projectPath })
    await web.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='前往')`)
    await web.wait(`document.querySelector('[role=dialog] .primary-button:not(:disabled)')!==null`)
    await web.capture(join(output, 'web-host-directory-picker.png'))
    await web.click(`document.querySelector('[role=dialog] .primary-button')`)
    await web.wait(`document.querySelector('#host-workspace-path')===null`)
    await choose(web)
    stage = 'shared geometry and settings'
    await pause(1200)
    const geometry = async browser => browser.evaluate(`({viewport:[innerWidth,innerHeight],sidebar:document.querySelector('.unified-sidebar').getBoundingClientRect().width,header:document.querySelector('.camp-topbar')?.getBoundingClientRect().height,composer:document.querySelector('[contenteditable=true]').getBoundingClientRect().width})`)
    assert.deepEqual(await geometry(desktop), await geometry(web)); assert.equal((await geometry(web)).sidebar, 270); assert.equal((await geometry(web)).header, 38)
    await desktop.capture(join(output, 'desktop-day.png')); await web.capture(join(output, 'web-day.png'))
    await desktop.evaluate(`window.rovai.appearance.setPreference('night')`); await web.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await pause(400)
    await desktop.capture(join(output, 'desktop-night.png')); await web.capture(join(output, 'web-night.png'))
    // The main merge must reach the actual browser, including native capability
    // differences. This path catches accidental window.rovai access in settings.
    await web.click(`document.querySelector('.sidebar-settings-main')`)
    await web.wait(`document.querySelector('[aria-label="启用世界地图"]:not(:disabled)') !== null`)
    assert.equal(await web.evaluate(`document.querySelector('#general-window-heading') === null`), true)
    assert.equal(await web.evaluate(`document.querySelector('#host-web-heading') === null`), true)
    await web.click(`document.querySelector('[aria-label="启用世界地图"]')`)
    await web.wait(`document.querySelector('[aria-label="启用世界地图"]').checked && !document.querySelector('[aria-label="启用世界地图"]').disabled`)
    assert.equal(await desktop.evaluate(`window.rovai.generalPreferences.get().then(s=>s.worldMapEnabled)`), false, 'browser preference does not modify Desktop')
    await web.capture(join(output, 'web-general-night.png'))
    await web.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()==='外观')`)
    await web.wait(`document.querySelector('.appearance-settings-page') !== null`)
    assert.equal(await web.evaluate(`document.querySelector('#appearance-zoom') === null`), true)
    assert.match(await web.evaluate('document.body.innerText'), /使用浏览器菜单或快捷键/)
    await web.capture(join(output, 'web-appearance-night.png'))
    await web.click(`document.querySelector('.settings-sidebar-back')`)
    await web.wait(`document.querySelector('[contenteditable=true]') !== null`)
    stage = 'Web preview and final-line quote'
    const uploadPath = join(fixture, 'main-sync-preview.md')
    await writeFile(uploadPath, '# Main sync preview\n\nPREVIEW_SELECTION_ONLY\n\nThe last line stays inside the file.\n')
    await web.setFiles('.conversation-controls .composer-file-input', [uploadPath])
    await web.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
    await web.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
    await web.wait(`document.querySelector('.file-preview-markdown')?.innerText.includes('PREVIEW_SELECTION_ONLY')`)
    await web.click(`document.querySelector('.file-preview-markdown')`)
    await web.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 })
    await web.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 })
    const selected = await web.evaluate('getSelection().toString()')
    assert.match(selected, /PREVIEW_SELECTION_ONLY/)
    assert.doesNotMatch(selected, /Controlled Host record|设置与应用更新/)
    await web.capture(join(output, 'web-preview-select-all.png'))
    await web.click(`document.querySelector('[aria-label="收起文件预览"]')`)
    // Native final-line selection can end just outside the message body. Main's
    // clamping fix must survive the shared UI + authenticated quote mutation.
    await web.evaluate(`(()=>{const root=[...document.querySelectorAll('[data-message-quote-body]')].at(-1);root.scrollIntoView({block:'center'});const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node,line;while(node=walker.nextNode())if(node.textContent.includes('commandId'))line=node;const range=document.createRange();range.setStart(line,line.textContent.indexOf('commandId'));range.setEndAfter(root);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'))})()`)
    await web.wait(`document.querySelector('.message-quote-selection-toolbar button') !== null`)
    await web.click(`document.querySelector('.message-quote-selection-toolbar button')`)
    await web.wait(`document.querySelector('.conversation-controls .message-quotes-trigger') !== null`)
    await web.click(`document.querySelector('.conversation-controls .message-quotes-trigger')`)
    await web.wait(`document.querySelector('.message-quote-full-text') !== null`)
    assert.equal(await web.evaluate(`document.querySelector('.message-quote-full-text').textContent.replaceAll('\`','').trim()`), 'commandId belongs to Rust Host.')
    await web.capture(join(output, 'web-last-line-quote.png'))
    await web.key('Escape')
    await web.wait(`document.querySelector('.message-quotes-popover')===null`)
    stage = 'independent drafts and reauthentication'
    const type = async (browser, text) => { stage = `${browser === desktop ? 'Desktop' : browser === web ? 'Web A' : 'Web B'} Composer input`; await browser.click(`document.querySelector('[contenteditable=true]')`); await browser.send('Input.insertText', { text }) }
    await type(desktop, 'Desktop draft remains independent.')
    await type(web, 'Browser A draft survives reauthentication.')
    await web.evaluate(`window.__acceptedComposer=document.querySelector('[contenteditable=true]');true`)
    stage = 'second browser login'
    second = await launchBrowser('web', join(fixture, 'chrome-b')); await second.send('Page.navigate', { url: started.origin }); await login(second, started.administratorToken); await choose(second)
    assert.equal(await second.evaluate(`document.querySelector('[contenteditable=true]').textContent`), '')
    await type(second, 'Browser B independent draft.')
    await pause(1500)
    const db = new DatabaseSync(join(info.dataDir, 'rovai.sqlite'), { readOnly: true })
    const rows = db.prepare('select client_id,structured_content_json,revision from camp_composer_draft where camp_id=?').all(campId); db.close()
    assert.equal(rows.length, 3, JSON.stringify(rows)); assert.equal(new Set(rows.map(r => r.client_id)).size, 3)
    for (const text of ['Desktop draft remains independent.', 'Browser A draft survives reauthentication.', 'Browser B independent draft.']) assert.ok(rows.some(r => r.structured_content_json.includes(text)))
    stage = 'Web pending return to the current client Draft'
    // Seed a canonical repair item without a Run. The production shared page,
    // HTTP authorization, Core transaction and subsequent Draft read are real.
    const pendingId = crypto.randomUUID()
    const returnedText = 'Pending input returned to Browser A.'
    const pendingContent = JSON.stringify({ version: 2, segments: [{ kind: 'text', text: returnedText }] })
    const seed = new DatabaseSync(join(info.dataDir, 'rovai.sqlite'))
    let pendingSource, othersBefore
    try {
      pendingSource = seed.prepare('select * from camp_composer_draft where camp_id=? and client_id<>? and source_attachments_json<>?').get(campId, 'desktop', '[]')
      assert.ok(pendingSource, 'the uploaded browser Draft must exist before withdrawal')
      othersBefore = seed.prepare('select client_id,structured_content_json,source_attachments_json,quotes_json,revision from camp_composer_draft where camp_id=? and client_id<>? order by client_id').all(campId, pendingSource.client_id)
      seed.prepare(`insert into pending_camp_input(id,camp_id,enqueue_sequence,structured_content_json,source_attachments_json,quotes_json,execution_json,user_id,state,last_attempt_error_code,client_id,created_at,updated_at)
        values(?,?,1,?,?,?,'null','local_user','needs_repair','attachment_missing','desktop',?,?)`)
        .run(pendingId, campId, pendingContent, pendingSource.source_attachments_json, pendingSource.quotes_json, new Date().toISOString(), new Date().toISOString())
    } finally { seed.close() }
    await web.evaluate(`window.dispatchEvent(new Event('focus'))`)
    const pendingEdit = `document.querySelector('.pending-input-row .pending-input-edit')`
    await web.wait(`Boolean(${pendingEdit}) && !${pendingEdit}.disabled`)
    await web.click(pendingEdit)
    await web.wait(`document.querySelector('[contenteditable=true]')?.textContent===${JSON.stringify(returnedText)} && document.querySelector('.pending-input-row')===null`)
    assert.equal(await web.evaluate(`window.__acceptedComposer===document.querySelector('[contenteditable=true]')`), true)
    assert.equal(await desktop.evaluate(`document.querySelector('[contenteditable=true]').textContent`), 'Desktop draft remains independent.')
    assert.equal(await second.evaluate(`document.querySelector('[contenteditable=true]').textContent`), 'Browser B independent draft.')
    const afterReturn = new DatabaseSync(join(info.dataDir, 'rovai.sqlite'), { readOnly: true })
    try {
      const restored = afterReturn.prepare('select * from camp_composer_draft where camp_id=? and client_id=?').get(campId, pendingSource.client_id)
      assert.equal(restored.source_attachments_json, pendingSource.source_attachments_json)
      assert.equal(restored.quotes_json, pendingSource.quotes_json)
      assert.ok(restored.revision > pendingSource.revision)
      assert.equal(afterReturn.prepare('select state from pending_camp_input where id=?').get(pendingId).state, 'cancelled')
      assert.deepEqual(afterReturn.prepare('select client_id,structured_content_json,source_attachments_json,quotes_json,revision from camp_composer_draft where camp_id=? and client_id<>? order by client_id').all(campId, pendingSource.client_id), othersBefore)
    } finally { afterReturn.close() }
    const repairUpload = join(fixture, 'pending-repair.txt')
    await writeFile(repairUpload, 'Attached after returning to the ordinary Composer.\n')
    await web.setFiles('.conversation-controls .composer-file-input', [repairUpload])
    await web.wait(`document.querySelectorAll('.composer-attachment-card .attachment-open:not(:disabled)').length===2`)
    await web.capture(join(output, 'web-pending-return.png'))
    stage = 'token rotation and reauthentication'
    const rotated = await desktop.evaluate(`window.rovai.hostWeb.rotate()`); await login(web, rotated.administratorToken)
    assert.equal(await web.evaluate(`window.__acceptedComposer===document.querySelector('[contenteditable=true]')`), true)
    assert.equal(await web.evaluate(`document.querySelector('[contenteditable=true]').textContent`), returnedText)
    assert.equal(await web.evaluate('typeof window.rovai'), 'undefined')
    assert.deepEqual(desktop.errors, []); assert.deepEqual(web.errors, []); assert.deepEqual(second.errors, [])
    await web.capture(join(output, 'web-after-reauth.png'))
    const evidence = { stage: 'managed-desktop-web-passed', simulation: false, realRuntime: false, desktopFocusEmulated: true, campId, geometry: await geometry(web), draftOwners: rows.map(r => r.client_id === 'desktop' ? 'desktop' : 'web'), sameComposerAfterReauth: true, nativeBridgeInBrowser: false,
      ownerModel: { desktopSettingsStart: true, copiedAddressAndToken: true, actualInterfaceAddress: true, nonLoopbackOrigin: !started.origin.includes('127.0.0.1'), directoryPickerWithoutPreauthorization: true, sameMachineBrowsers: true, secondPhysicalDevice: false },
      mainSync: { browserGeneralPreferences: true, nativeWindowControlsAbsent: true, browserZoomExplicit: true, previewSelectAllScoped: true, finalLineQuoteAccepted: true, pendingReturnScopedToCurrentClient: true, pendingAttachmentsAddedInComposer: true, pendingFixture: 'one needs_repair row in isolated database; no Runtime' } }
    await desktop.evaluate(`window.rovai.hostWeb.stop()`)
    assert.ok((await request('app.info')).dataDir)
    await writeFile(join(output, 'desktop-web-live.json'), JSON.stringify({ ...evidence, coreAliveAfterWebStop: true }, null, 2))
    console.log(JSON.stringify({ ...evidence, coreAliveAfterWebStop: true }))
  } catch (error) {
    throw new Error(`Live acceptance at ${stage}: ${error.message}`, { cause: error })
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
