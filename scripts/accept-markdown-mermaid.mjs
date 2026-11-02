import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { launchAcceptanceBrowser } from './lib/host-web-browser.mjs'
import { document as reviewDocument } from './fixtures/markdown-mermaid/samples.mjs'

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
const count = status => `document.querySelectorAll('[data-mermaid-state="${status}"]').length`
const ready = `${count('ready')}===8 && ${count('error')}===1`
const button = (label, root = 'document') => `[...${root}.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(label)})`
const first = `document.querySelector('.markdown-mermaid')`
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
  await page.capture(join(output, `${name}-document.png`))
  await page.click(button('查看源码', first))
  await page.wait(`${first}.dataset.mermaidView==='source'`)
  await page.click(button('查看图形', first))
  const wide = `document.querySelectorAll('.markdown-mermaid')[6]`
  await page.click(button('查看大图', wide))
  await page.wait(`document.querySelector('.markdown-mermaid-dialog img')?.naturalWidth>0`)
  await page.click(button('100%', `document.querySelector('.markdown-mermaid-dialog')`))
  assert.equal(await page.evaluate(`(()=>{const e=document.querySelector('.file-preview-image-scroll');return e.scrollWidth>e.clientWidth})()`), true)
  await page.capture(join(output, `${name}-large.png`))
  await page.key('Escape')
  await page.wait(`!document.querySelector('.markdown-mermaid-dialog')`)
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
  await desktop.evaluate(`window.rovai.navigationPreferences.registerProjects([${JSON.stringify(inspected.projectPath)}], false)`)
  console.log('Created isolated review thread')
  const beforeReload = await desktop.evaluate('performance.timeOrigin')
  await desktop.send('Page.reload')
  await desktop.wait(`performance.timeOrigin!==${beforeReload} && Boolean(window.rovai && document.querySelector('.authoritative-workspace'))`, 45_000)
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
  await writeFile(join(output, 'packaged-result.json'), JSON.stringify({ passed: true, executable, root,
    desktop: 'packaged ASAR file entry', web: 'packaged Host web-ui HTTP entry',
    validDiagrams: 8, invalidDiagrams: 1, largeDiagram: true, themeAndFileWatch: true, sourcePreferencePreserved: true, runtime: false }, null, 2) + '\n')
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
