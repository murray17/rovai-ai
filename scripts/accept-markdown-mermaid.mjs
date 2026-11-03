import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { launchAcceptanceBrowser } from './lib/host-web-browser.mjs'
import { document as reviewDocument, samples, fence } from './fixtures/markdown-mermaid/samples.mjs'

// Real packaged Desktop and its bundled Web UI, with fresh Core/profile/skills.
// No model Runtime is started, and the installed daily application is untouched.
const repository = resolve(import.meta.dirname, '..')
const root = process.env.ROVAI_MERMAID_ACCEPT_ROOT ?? await mkdtemp('/tmp/rv-mermaid-')
assert.ok(root.startsWith('/tmp/rv-mermaid-'), 'Use a dedicated temporary acceptance root')
const data = join(root, 'user-data'), workspace = join(root, 'workspace')
const output = process.env.ROVAI_MERMAID_OUTPUT ?? join(root, 'evidence')
for (const path of [data, workspace, output, join(data, 'managed-skill-library')]) await mkdir(path, { recursive: true })
seedCompletedOnboardingForAcceptance(data)
await writeFile(join(workspace, 'review.md'), reviewDocument)
console.log(JSON.stringify({ channel: 'packaged_acceptance', userData: data, skillLibraryRoot: join(data, 'managed-skill-library'), runtime: false }))
const executable = join(resolve(process.argv[2] ?? join(repository, 'dist/mac-arm64/Rovai AI.app')), 'Contents/MacOS/Rovai AI')
let desktop, web, threadId
const request = (method, params = {}) => desktop.evaluate(`window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
const count = status => `document.querySelectorAll('.file-preview-markdown [data-mermaid-state="${status}"]').length`
const ready = `${count('ready')}===8 && ${count('error')}===1`
const button = (label, root = 'document') => `[...${root}.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)})`
const first = `document.querySelector('.file-preview-markdown .markdown-mermaid')`
async function openDocument(page) {
  await page.wait(`Boolean(document.querySelector('.camp-nav-open')) && !document.querySelector('.camp-nav-open').closest('[inert]') && document.querySelector('.section-create-button')?.disabled===false`)
  // Select the prepared thread before exercising the document's native controls.
  const row = `document.querySelector('[data-thread-id="${threadId}"]')`
  await page.evaluate(`${row}.querySelector('.camp-nav-open').click()`)
  await page.wait(`${row}?.classList.contains('selected')`)
  await page.wait(`Boolean(document.querySelector('.project-files-toggle'))`)
  if (await page.evaluate(`document.querySelector('.project-files-toggle').getAttribute('aria-expanded')!=='true'`))
    await page.click(`document.querySelector('.project-files-toggle')`)
  await page.wait(`Boolean(document.querySelector('.project-files-row[title="review.md"]'))`)
  await page.click(`document.querySelector('.project-files-row[title="review.md"]')`)
  await page.wait(ready, 45_000)
}
async function inspect(page, name) {
  assert.equal(await page.evaluate(`window.mermaid===undefined && window.DOMPurify===undefined`), true)
  assert.equal(await page.evaluate(`document.querySelector('iframe[title="Mermaid renderer"]').contentDocument===null`), true)
  const resources = await page.evaluate(`(() => {
    const frame=document.querySelector('iframe[title="Mermaid renderer"]');
    return location.protocol==='file:'
      ? window.acceptanceAssetReads
      : [...new DOMParser().parseFromString(frame.srcdoc,'text/html').scripts].map(e=>e.src)
  })()`)
  assert.equal(resources.length, 3)
  if (name === 'packaged-desktop') assert.ok(resources.every(url => url.includes('/Resources/web-ui/assets/')))
  else assert.ok(resources.every(url => new URL(url).pathname.startsWith('/assets/')))
  await writeFile(join(output, `${name}-resources.json`), JSON.stringify(resources, null, 2))
  await page.capture(join(output, `${name}-document.png`))
  if (name === 'packaged-desktop') {
    const snapshot = await page.evaluate(`(async () => {
      const clone=document.body.cloneNode(true);
      for(const node of clone.querySelectorAll('script,iframe,.page-zoom-feedback')) node.remove();
      for(const img of clone.querySelectorAll('img')) {
        const response=await fetch(img.src);const blob=await response.blob();
        img.src=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});
      }
      const css=await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map(link=>fetch(link.href).then(r=>r.text())));
      return {html:clone.innerHTML,css:css.join('\\n')+'\\n'+[...document.querySelectorAll('style')].map(s=>s.textContent).join('\\n')};
    })()`)
    await writeFile(join(output, 'production-ui-snapshot.json'), JSON.stringify(snapshot))
  }
  await page.click(button('查看源码', first))
  await page.wait(`${first}.dataset.mermaidView==='source'`)
  await page.click(button('查看图形', first))
  const wide = `document.querySelectorAll('.file-preview-markdown .markdown-mermaid')[6]`
  await page.click(button('查看大图', wide))
  await page.wait(`document.querySelector('.markdown-mermaid-dialog img')?.naturalWidth>0`)
  await page.click(button('100%', `document.querySelector('.markdown-mermaid-dialog')`))
  assert.equal(await page.evaluate(`(()=>{const e=document.querySelector('.file-preview-image-scroll');return e.scrollWidth>e.clientWidth})()`), true)
  await page.evaluate('document.querySelector(".file-preview-image-scroll").scrollLeft=350')
  const imageUrl = await page.evaluate('document.querySelector(".markdown-mermaid-dialog img").src')
  await page.click(button('查看源码', `document.querySelector('.markdown-mermaid-dialog')`))
  await page.wait('!!document.querySelector(".markdown-mermaid-reader-source .cm-content")')
  await page.capture(join(output, `${name}-large-source.png`))
  await page.click(button('查看图形', `document.querySelector('.markdown-mermaid-dialog')`))
  assert.equal(await page.evaluate('document.querySelector(".file-preview-image-scroll").scrollLeft'), 350)
  assert.equal(await page.evaluate('document.querySelector(".markdown-mermaid-dialog img").src'), imageUrl)
  await page.capture(join(output, `${name}-large.png`))
  await page.key('Escape')
  await page.wait(`!document.querySelector('.markdown-mermaid-dialog')`)
  assert.deepEqual(page.errors, [])
}

async function inspectMessages(page, name) {
  const message = '[data-message-id="mermaid-accept-message"]'
  const messageReady = `document.querySelectorAll('${message} [data-mermaid-state="ready"]').length===3 && document.querySelectorAll('${message} [data-mermaid-state="error"]').length===1`
  for (const following of [true, false]) {
    const hook = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.acceptanceDecodes=[];window.originalImageDecode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=function(){if(!this.src.startsWith('blob:'))return originalImageDecode.call(this);
        return new Promise((resolve,reject)=>acceptanceDecodes.push(()=>originalImageDecode.call(this).then(resolve,reject)))};` })
    const beforeReload = await page.evaluate('performance.timeOrigin')
    await page.send('Page.reload')
    await page.wait(`performance.timeOrigin!==${beforeReload} && !!document.querySelector('[data-thread-id="${threadId}"] .camp-nav-open')`, 45_000)
    await page.wait(`Boolean(document.querySelector('.camp-nav-open')) && !document.querySelector('.camp-nav-open').closest('[inert]') && document.querySelector('.section-create-button')?.disabled===false`, 45_000)
    await page.evaluate(`document.querySelector('[data-thread-id="${threadId}"] .camp-nav-open').click()`)
    await page.wait(`document.querySelector('[data-thread-id="${threadId}"]')?.classList.contains('selected')`)
    await page.wait(`document.querySelectorAll('${message} .markdown-mermaid').length===4 && acceptanceDecodes.length>=3`, 30_000)
    await page.evaluate(`window.timeline=document.querySelector('.timeline-scroll.camp-timeline');timeline.scrollTop=${following ? 'timeline.scrollHeight' : '100'};timeline.dispatchEvent(new Event('scroll'))`)
    await page.evaluate('HTMLImageElement.prototype.decode=originalImageDecode;acceptanceDecodes.forEach(release=>release())')
    await page.wait(messageReady, 30_000)
    if (following) await page.wait('timeline.scrollHeight-timeline.clientHeight-timeline.scrollTop<2')
    else assert.ok(Math.abs(await page.evaluate('timeline.scrollTop') - 100) < 2, 'Async public graphs retain history reading position')
    assert.equal(await page.evaluate('timeline.scrollWidth>timeline.clientWidth'), false)
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier })
  }
  const block = `document.querySelector('${message} .markdown-mermaid')`
  await page.evaluate('timeline.scrollTop=timeline.scrollHeight')
  await page.click(button('查看源码', block))
  assert.ok((await page.evaluate(`${block}.textContent`)).includes('中文标签'))
  await page.click(button('查看图形', block))
  await page.click(button('查看大图', block))
  await page.wait('!!document.querySelector(".markdown-mermaid-dialog img")')
  await page.key('Escape')
  await page.capture(join(output, `${name}-messages.png`))
  assert.deepEqual(page.errors, [])
}
try {
  desktop = await launchAcceptanceBrowser({ executable, args: ['--remote-debugging-port=0', `--user-data-dir=${data}`],
    env: { ...process.env, TMPDIR: root, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' } })
  await desktop.send('Page.bringToFront')
  await desktop.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.wait(`Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await desktop.wait(`window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`, 45_000)
  const health = await request('health.check')
  assert.equal(await realpath(health.database.path), await realpath(join(data, 'rovai.sqlite')))
  const preflight = await request('threads.creationPreflight')
  const inspected = await request('workspaces.inspect', { path: workspace })
  const created = await request('threads.create', { commandId: crypto.randomUUID(), name: 'Mermaid 验收',
    workspace: { projectPath: inspected.projectPath }, memberAgentIds: preflight.presentMembers.map(m => m.agentId),
    defaultLeadAgentId: preflight.initialLeadAgentId, collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  threadId = created.payload.threadId
  assert.equal(typeof threadId, 'string')
  // Synthetic published messages in this script's newly created, isolated DB.
  // No agent delivery or model Run is created; all reads use production entries.
  const db = new DatabaseSync(health.database.path)
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
    const insert = db.prepare(`INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,
      structured_content_json,address_mode,addressed_agent_ids_json,version,created_at,updated_at)
      VALUES(?,?,?,'agent',?,?,?,'default','[]',1,?,?)`)
    for (let sequence=1;sequence<=31;sequence++) {
      const body = sequence===31 ? [samples.flow,samples.wide,samples.invalid,samples.tall].map(fence).join('\n\n')
        : `历史正文 ${sequence}。用于核对图形出现时的阅读位置。\n\n这段正文应保持可读。`
      const time = new Date(Date.UTC(2026,10,3,0,sequence)).toISOString()
      insert.run(sequence===31?'mermaid-accept-message':`mermaid-history-${sequence}`,threadId,sequence,
        preflight.initialLeadAgentId,body,JSON.stringify([{kind:'text',text:body}]),time,time)
    }
    db.exec('COMMIT')
  } finally { db.close() }
  await desktop.evaluate(`window.rovai.navigationPreferences.registerProjects([${JSON.stringify(inspected.projectPath)}], false)`)
  console.log('Created isolated review thread')
  // Observe every production file read before the first published graph mounts.
  await desktop.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.acceptanceAssetReads=[];const originalAssetFetch=window.fetch;
    window.fetch=(url,...args)=>{if(/mermaid.min-|purify.min-|mermaid-sandbox-entry-/u.test(String(url)))acceptanceAssetReads.push(String(url));return originalAssetFetch(url,...args)}` })
  const beforeReload = await desktop.evaluate('performance.timeOrigin')
  await desktop.send('Page.reload')
  await desktop.wait(`performance.timeOrigin!==${beforeReload} && Boolean(window.rovai && document.querySelector('.authoritative-workspace'))`, 45_000)
  // Observe local file reads; Chromium does not expose them as ResourceTiming.
  // This forwards every read unchanged and cannot supply or intercept an asset.
  await desktop.evaluate(`window.rovai.appearance.setPreference('day')`)
  await openDocument(desktop)
  await inspect(desktop, 'packaged-desktop')
  await desktop.click(button('查看源码', first))
  await desktop.evaluate(`window.rovai.appearance.setPreference('night')`)
  await desktop.wait(ready, 30_000)
  assert.equal(await desktop.evaluate(`${first}.dataset.mermaidView`), 'source')
  await writeFile(join(workspace, 'review.md'), reviewDocument.replace('入口', '刷新入口'))
  await desktop.wait(`${first}.textContent.includes('刷新入口') && (${ready})`, 30_000)
  assert.equal(await desktop.evaluate(`${first}.dataset.mermaidView`), 'source')
  await desktop.capture(join(output, 'packaged-desktop-night-refresh.png'))
  const service = await desktop.evaluate(`window.rovai.hostWeb.start({listen:'127.0.0.1:0',allowInsecureLan:false})`)
  web = await launchAcceptanceBrowser({ executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(root, 'chrome')}`, service.origin] })
  await web.wait(`Boolean(document.querySelector('#administrator-token'))`)
  await web.click(`document.querySelector('#administrator-token')`)
  await web.send('Input.insertText', { text: service.administratorToken })
  await web.click(`document.querySelector('.web-login button[type=submit]')`)
  await openDocument(web)
  await inspect(web, 'packaged-web')
  await inspectMessages(desktop, 'packaged-desktop')
  await inspectMessages(web, 'packaged-web')
  await writeFile(join(output, 'packaged-result.json'), JSON.stringify({ passed: true, executable, root,
    desktop: 'installed web-ui/desktop.html file entry with Electron preload', web: 'same installed web-ui/index.html via Host HTTP',
    validDiagrams: 8, invalidDiagrams: 1, largeDiagram: true, themeAndFileWatch: true, sourcePreferencePreserved: true,
    messageDiagrams: { valid: 3, invalid: 1, followingLatest: true, historyPosition: true, sourceAndDialog: true }, runtime: false }, null, 2) + '\n')
  console.log('Packaged Desktop and bundled Web Markdown Mermaid acceptance passed')
} catch (error) {
  const diagnostics = await desktop?.evaluate(`Promise.all([
    Promise.resolve({visibility:document.visibilityState,authoritative:!!document.querySelector('.authoritative-workspace'),url:location.href}),
    window.rovai.desktopSession.getStartupSnapshot(), window.rovai.navigationPreferences.get(),
    window.rovai.request('navigation.snapshot',{}), window.rovai.generalPreferences.get()
  ]).then(values=>values, error=>({error:JSON.stringify(error)}))`).catch(() => null)
  await writeFile(join(output, 'packaged-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  await desktop?.capture(join(output, 'packaged-failure.png')).catch(() => {})
  throw error
} finally {
  await web?.close()
  await desktop?.evaluate('window.rovai.hostWeb.stop()').catch(() => {})
  await desktop?.close()
}
