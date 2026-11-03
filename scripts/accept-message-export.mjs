import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, readFile, readdir, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'

// Actual packaged Desktop + production Host + fresh database. No model Runs.
// Do not intercept link.click/createObjectURL: files must complete the native download path.
const repository = resolve(import.meta.dirname, '..')
const root = process.env.ROVAI_EXPORT_ACCEPT_ROOT ?? await mkdtemp('/tmp/rv-export-desktop-')
assert.ok(root.startsWith('/tmp/rv-export-desktop-'), 'Use a dedicated temporary acceptance root')
const data = join(root, 'user-data'), workspace = join(root, 'workspace'), output = join(root, 'evidence'), downloads = join(root, 'downloads')
assert.equal(await access(join(data, 'rovai.sqlite')).then(() => true, () => false), false, 'Never reuse an acceptance database')
for (const path of [data, workspace, output, downloads, join(data, 'managed-skill-library')]) await mkdir(path, { recursive: true })
seedCompletedOnboardingForAcceptance(data)
const executable = join(resolve(process.argv[2] ?? join(repository, 'dist/mac-arm64/Rovai AI.app')), 'Contents/MacOS/Rovai AI')
console.log(JSON.stringify({ channel: 'packaged_acceptance', executable, userData: data, skillLibraryRoot: join(data, 'managed-skill-library'), downloads, runtime: false }))
const desktop = await launchAcceptanceBrowser({ executable, args: ['--remote-debugging-port=0', `--user-data-dir=${data}`],
  env: { ...process.env, TMPDIR: root, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' } })
const request = (method, params = {}) => desktop.evaluate(`window.rovai.request(${JSON.stringify(method)},${JSON.stringify(params)})`)
const button = (label, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`
const report = { channel: 'packaged_acceptance', files: [], runtime: false, root }
try {
  await desktop.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.wait('!!window.rovai && !!document.querySelector(".app-shell")', 45_000)
  await desktop.wait('window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==="ready")', 45_000)
  const health = await request('health.check')
  assert.equal(await realpath(health.database.path), await realpath(join(data, 'rovai.sqlite')))
  const preflight = await request('threads.creationPreflight')
  const inspected = await request('workspaces.inspect', { path: workspace })
  const created = await request('threads.create', { commandId: crypto.randomUUID(), name: '导出落盘验收',
    workspace: { projectPath: inspected.projectPath }, memberAgentIds: preflight.presentMembers.map(m => m.agentId),
    defaultLeadAgentId: preflight.initialLeadAgentId, collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  const threadId = created.payload.threadId
  const db = new DatabaseSync(health.database.path)
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
    const insert = db.prepare(`INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,
      structured_content_json,address_mode,addressed_agent_ids_json,version,created_at,updated_at)
      VALUES(?,?,?,'agent',?,?,?,'default','[]',1,?,?)`)
    for (const [index, body] of [
      '桌面实际保存检查。\n\n- [x] 完成实现\n- [ ] 等待验收',
      '```diff\n-old\n+new\n```\n\n`inline()` 与 [网页](https://example.com)。',
      '最后一条：中文、@文字与完整消息内容。'
    ].entries()) {
      const time = new Date(Date.UTC(2026, 10, 3, 0, index)).toISOString()
      insert.run(`export-desktop-${index}`, threadId, index + 1, preflight.initialLeadAgentId, body,
        JSON.stringify([{ kind: 'text', text: body }]), time, time)
    }
    db.exec('COMMIT')
  } finally { db.close() }
  await desktop.evaluate(`window.rovai.navigationPreferences.registerProjects([${JSON.stringify(inspected.projectPath)}],false)`)
  const beforeReload = await desktop.evaluate('performance.timeOrigin')
  await desktop.send('Page.reload')
  await desktop.wait(`performance.timeOrigin!==${beforeReload}&&!!window.rovai&&!!document.querySelector('.app-shell')`, 45_000)
  await desktop.wait(`(()=>{const open=document.querySelector('[data-thread-id="${threadId}"] .camp-nav-open');return !!open&&!open.closest('[inert]')&&!document.querySelector('.startup-loading-canvas')&&document.querySelector('.section-create-button')?.disabled===false})()`, 45_000)
  await desktop.click(`document.querySelector('[data-thread-id="${threadId}"] .camp-nav-open')`)
  await desktop.wait(`document.querySelector('[data-thread-id="${threadId}"]')?.classList.contains('selected')`)
  await desktop.wait('document.querySelectorAll("[data-message-id^=export-desktop-]").length===3')
  await desktop.wait('!document.querySelector(".startup-loading-canvas")')
  await desktop.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  assert.equal(await desktop.evaluate('!!document.querySelector(".message-export-entry-button")'), false)
  await desktop.click('document.querySelector(".message-select-button")')
  await desktop.click(button('全选已加载'))
  await desktop.click('document.querySelector(".message-selection-actions .primary-button")')
  await desktop.wait('!!document.querySelector(".message-export-document")')
  await desktop.capture(join(output, 'desktop-preview.png'))
  const dialog = 'document.querySelector(".message-export-dialog")'
  for (const [format, label, ext] of [['HTML', '网页 HTML', 'html'], ['PNG', '图片 PNG', 'png'], ['Markdown', 'Markdown', 'md']]) {
    await desktop.click(button(label, dialog))
    await desktop.click(button('下载 ' + format, dialog))
    let file
    for (let attempt = 0; attempt < 150; attempt++) {
      file = (await readdir(downloads)).find(name => name.endsWith('.' + ext))
      if (file) break
      await pause(100)
    }
    assert.ok(file, format + ' must be saved by packaged Desktop to the isolated directory')
    const path = join(downloads, file), bytes = await readFile(path)
    assert.ok(bytes.length > 100)
    if (ext === 'html') {
      const text = bytes.toString('utf8')
      assert.match(text, /message-export-task-marker is-complete/)
      assert.equal((text.match(/message-export-task-marker/g) ?? []).length, 2)
      assert.match(text, /最后一条/)
    } else if (ext === 'png') {
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      assert.equal(bytes.readUInt32BE(16), 1440)
      assert.ok(bytes.readUInt32BE(20) > 500)
    } else { assert.match(bytes.toString('utf8'), /- \[x\] 完成实现/); assert.match(bytes.toString('utf8'), /```diff/) }
    report.files.push({ format, path, bytes: bytes.length })
  }
  assert.deepEqual(desktop.errors, [])
  report.result = 'passed'
  console.log(JSON.stringify(report))
} catch (error) {
  report.result = 'failed'; report.error = error.message
  await desktop.capture(join(output, 'desktop-failure.png'))
  throw error
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2))
  await desktop.close()
}
