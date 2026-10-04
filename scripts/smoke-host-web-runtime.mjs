import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'
import { configureBrowserCamp } from './lib/host-web-ui-setup.mjs'
import { admitElectronIntegrationTest } from './lib/electron-sandbox-capability.mjs'

// Opt-in native Runtime acceptance, never part of deterministic pnpm test.
// Setup, sends, upload, approval, file reading and stop use the production Web UI.
// Read-only HTTP observations verify the durable results independently.
const repository = resolve(import.meta.dirname, '..')
const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (process.platform !== 'darwin') throw Error('This local acceptance currently requires macOS; other platform qualification is separate.')
await access(chrome)
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-web-runtime-')))
const data = join(fixture, 'data')
const skills = join(fixture, 'skills')
const workspace = join(fixture, 'workspace')
for (const directory of [data, skills, workspace]) await mkdir(directory, { mode: 0o700 })
console.log(JSON.stringify({ channel: 'automatic_acceptance', fixture, data, skills, workspace, mcp: join(data, 'mcp.json') }))
const hostBinary = resolve(process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug/rovai-host'))
const webUi = resolve(process.env.ROVAI_WEB_UI ?? join(repository, 'out/web'))
const desktopEntry = process.env.ROVAI_HOST_ENTRY === 'desktop'
let administrator = randomBytes(32).toString('hex')
let child, closed, desktop, token, browser, origin
let log = ''
const evidence = {
  verifiedAt: new Date().toISOString(), simulation: false, realRuntime: true,
  setup: `Empty ${desktopEntry ? 'Desktop-managed' : 'standalone'} Host; Runtime check, member configuration and Camp creation use the production browser UI.`,
  entry: desktopEntry ? 'desktop' : 'headless',
  checks: {}, screenshots: {},
  notVerified: ['Second physical device/LAN', 'Other platforms', 'Physical sleep/wake']
}
try {
  if (desktopEntry) {
    admitElectronIntegrationTest({ skip: reason => { throw Error(reason) } })
    const userData = join(fixture, 'desktop-user-data')
    await mkdir(userData, { mode: 0o700 })
    console.log(JSON.stringify({ channel: 'automatic_acceptance', userData, skills: join(userData, 'managed-skill-library'), mcp: join(userData, 'mcp.json') }))
    const env = { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_HOST_BIN: hostBinary }
    delete env.ELECTRON_RUN_AS_NODE
    desktop = await launchAcceptanceBrowser({ executable: (await import('electron')).default,
      args: [repository, `--user-data-dir=${userData}`, '--remote-debugging-port=0'], env })
    await desktop.wait(`Boolean(window.rovai?.request)`)
    await desktop.wait(`window.rovai.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`, 30_000)
    await desktop.evaluate(`(async()=>{const api=window.rovai.onboarding;let s=await api.get();if(s.status==='uninitialized')s=await api.showWelcome();if(s.status==='in_progress'&&s.step==='welcome')s=await api.completeWelcome();if(s.status==='in_progress'&&s.step==='member'){await api.selectMember('luoke');s=await api.completeMemberSelection()}if(s.status==='in_progress'&&s.step==='runtime')s=await api.deferRuntimeSetup();return s.status})()`)
    const started = await desktop.evaluate(`window.rovai.hostWeb.start({listen:'127.0.0.1:0',allowInsecureLan:false})`)
    origin = started.origin; administrator = started.administratorToken
  } else {
    child = spawn(hostBinary, [
      'run', ...coreDataDirectoryArguments(data), '--skill-library-root', skills,
      '--mcp-config-path', join(data, 'mcp.json'), '--initialize', '--web-listen', '127.0.0.1:0',
      '--web-ui', webUi, '--web-token-stdin'
    ], { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.end(administrator + '\n')
    const collect = chunk => { log = (log + chunk).slice(-65_000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  for (let i = 0; i < 200 && !log.includes('Host Core is ready'); i++) {
    if (child.exitCode !== null) throw Error('Host exited before readiness')
    await pause(100)
  }
  assert.ok(log.includes('Host Core is ready'), 'Host readiness timeout')
  origin = log.match(/origin="(http:\/\/127\.0\.0\.1:\d+)"/)?.[1]
  }
  assert.ok(origin)
  const response = await fetch(origin + '/api/v1/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 3, administratorToken: administrator }), redirect: 'error'
  })
  assert.equal(response.status, 200)
  token = (await response.json()).token
  const call = async (operation, params = {}) => {
    const response = await fetch(origin + '/api/v1/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ operation, params }), redirect: 'error', signal: AbortSignal.timeout(125_000)
    })
    const reply = await response.json()
    assert.equal(response.status, 200, JSON.stringify(reply.error))
    assert.equal(reply.error, null, JSON.stringify(reply.error))
    return reply.result
  }
  browser = await launchAcceptanceBrowser({ executable: chrome, args: [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'browser')}`, 'about:blank'
  ] })
  await browser.send('Page.navigate', { url: origin })
  await browser.wait(`document.querySelector('#administrator-token') !== null`)
  await browser.click(`document.querySelector('#administrator-token')`)
  await browser.send('Input.insertText', { text: administrator })
  await browser.click(`document.querySelector('.web-login button[type=submit]')`)
  await browser.wait(`document.querySelector('.web-login-overlay') === null`)
  const name = `真实 ${desktopEntry ? 'Desktop' : '独立'} Host Web 执行验收`
  const { threadId } = await configureBrowserCamp({ browser, workspace, name,
    read: (operation, params) => {
      assert.ok(['members.list', 'runtime.installations.list', 'navigation.snapshot'].includes(operation), 'Setup verification is read-only')
      return call(operation, params)
    }
  })
  evidence.threadId = threadId
  evidence.checks.browserRuntimeMemberAndCampSetup = true
  console.log(JSON.stringify({ stage: 'configured-through-production-ui', threadId }))
  const readCamp = () => call('camps.open', { threadId, traceId: randomUUID() })
  await browser.wait(`document.body.innerText.includes(${JSON.stringify(name)})`)
  await browser.wait(`document.querySelector('[contenteditable=true]') !== null`)
  const type = async text => {
    await browser.click(`document.querySelector('[contenteditable=true]')`)
    await browser.send('Input.insertText', { text })
  }
  const capture = async name => {
    const path = join(fixture, name)
    await browser.capture(path)
    evidence.screenshots[name] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  const upload = join(fixture, 'browser-source.md')
  await writeFile(upload, '# Browser source\n\nSOURCE_UPLOAD_MARKER\n', { mode: 0o600 })
  await browser.wait(`document.querySelector('.conversation-controls .composer-file-input:not(:disabled)') !== null`)
  await browser.setFiles('.conversation-controls .composer-file-input', [upload])
  await browser.wait(`document.querySelector('.composer-attachment-card .attachment-open:not(:disabled)') !== null`)
  await browser.click(`document.querySelector('.composer-attachment-card .attachment-open')`)
  await browser.wait(`[...document.querySelectorAll('.file-preview-content')].some(e => e.getClientRects().length > 0 && e.innerText.includes('SOURCE_UPLOAD_MARKER'))`)
  evidence.checks.browserUploadAndMarkdownRead = true
  await capture('web-source-upload.png')
  assert.ok(browser.responses.some(r => r.path === '/api/v1/uploads' && r.status === 200))
  console.log(JSON.stringify({ stage: 'browser-source-upload-and-read-passed' }))

  const publishCommand = '"$ROVAI_AGENT_CLI" send --public-only --body "CLI-only verification" --file host-web-result.txt'
  const prompt = `This is an isolated real execution acceptance. Write host-web-result.txt in the current workspace using printf with content Unified Rust Host real execution passed. Publish it with exactly ${publishCommand}. The native workspace-write sandbox denies Unix socket access. Request native approval for this exact CLI command before running it, and run it only once after approval. Do not add other commands or shell wrappers to the approval request. Do not change global permissions, contact another member, read other files or print credentials. The acceptance client will select the Host-provided allow_once option.`
  await type(prompt)
  await browser.key('Enter')
  await browser.wait(`document.querySelector('[contenteditable=true]')?.textContent.trim() === ''`)
  evidence.checks.browserSend = true
  const retainedDraft = 'Keep this independent draft while execution and approval update.'
  await type(retainedDraft)
  await browser.evaluate(`window.__liveComposer = document.querySelector('[contenteditable=true]'); true`)
  const approved = new Set()
  let run
  for (let i = 0; i < 240; i++) {
    const camp = await readCamp()
    run = camp.agentRuns[0]
    const approval = camp.approvals.find(a => a.status === 'pending' && !approved.has(a.id))
    if (approval) {
      assertExactPublishApproval(approval.canonicalInput, publishCommand, workspace)
      const option = approval.options.find(o => o.kind === 'allow_once')
      assert.ok(option, 'Host provided no one-time option')
      await browser.wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(option.label)})`)
      await capture('web-native-approval.png')
      await browser.click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(option.label)})`)
      let resolved = false
      for (let j = 0; j < 100; j++) {
        if ((await readCamp()).approvals.find(a => a.id === approval.id)?.status !== 'pending') { resolved = true; break }
        await pause(100)
      }
      assert.ok(resolved, 'Browser approval did not settle')
      const competing = await call('action.approvals.resolve', {
        commandId: randomUUID(), threadId, approvalId: approval.id, expectedVersion: approval.version,
        optionId: option.optionId, reason: 'Second client must not resolve a settled approval again'
      })
      assert.equal(competing.status, 'rejected')
      approved.add(approval.id)
      evidence.approvalId = approval.id
      evidence.checks.browserNativeApproval = true
      evidence.checks.secondApprovalRejected = true
      console.log(JSON.stringify({ stage: 'browser-approval-resolved', approvalId: approval.id }))
    }
    if (run && ['succeeded', 'failed', 'cancelled', 'interrupted', 'rejected'].includes(run.status)) break
    await pause(1000)
  }
  assert.equal(run?.status, 'succeeded', 'Real Runtime did not succeed')
  assert.equal(approved.size, 1, 'Exactly one native publication approval is expected')
  const finalCamp = await readCamp()
  const message = finalCamp.messages.find(m => m.body === 'CLI-only verification' && m.attachments.length === 1)
  assert.ok(message, 'Native CLI did not publish the expected artifact')
  const sent = finalCamp.messages.find(m => m.body === prompt)
  assert.ok(sent?.attachments.some(a => a.displayName === 'browser-source.md'), 'Browser upload was not consumed into the sent message')
  evidence.runId = run.id
  evidence.messageId = message.id
  evidence.attachmentId = message.attachments[0].id
  await browser.wait(`document.body.innerText.includes('CLI-only verification')`)
  assert.equal(await browser.evaluate(`window.__liveComposer === document.querySelector('[contenteditable=true]')`), true)
  assert.equal(await browser.evaluate(`document.querySelector('[contenteditable=true]').textContent`), retainedDraft)
  evidence.checks.composerPreservedDuringExecution = true
  await capture('web-runtime-complete.png')
  await browser.key('Escape')
  await browser.click(`[...document.querySelectorAll('.attachment-card')].find(e => e.textContent.includes('host-web-result'))?.querySelector('.attachment-open')`)
  await browser.wait(`[...document.querySelectorAll('.file-preview-content')].some(e => e.getClientRects().length > 0 && e.innerText.includes('Unified Rust Host real execution passed'))`)
  evidence.checks.browserArtifactRead = true
  await capture('web-runtime-artifact.png')
  console.log(JSON.stringify({ stage: 'browser-artifact-read-passed', runId: run.id }))

  // Replace the unsent editor contents through ordinary selection and typing.
  await browser.click(`document.querySelector('[contenteditable=true]')`)
  await browser.evaluate(`(() => { const selection = getSelection(); const range = document.createRange(); range.selectNodeContents(document.querySelector('[contenteditable=true]')); selection.removeAllRanges(); selection.addRange(range) })()`)
  await browser.send('Input.insertText', { text: 'This is an isolated cancellation acceptance. Run /bin/sleep 120 exactly once in the authorized current workspace. Do not write files, publish messages, or contact anyone. The acceptance client will stop this run while it is active.' })
  await browser.key('Enter')
  await browser.wait(`document.querySelector('[contenteditable=true]')?.textContent.trim() === ''`)
  let stopRun
  for (let i = 0; i < 180; i++) {
    stopRun = (await readCamp()).agentRuns.find(r => !finalCamp.agentRuns.some(old => old.id === r.id))
    if (stopRun?.status === 'running' && await browser.evaluate(`document.querySelector('[data-agent-run-id="${stopRun.id}"]')?.innerText.includes('/bin/sleep 120')`)) break
    await pause(500)
  }
  assert.equal(stopRun?.status, 'running')
  await browser.wait(`document.querySelector('[data-agent-run-id="${stopRun.id}"]')?.innerText.includes('/bin/sleep 120')`)
  await capture('web-stop-active.png')
  if (desktop) {
    await desktop.evaluate(`window.rovai.hostWeb.stop()`)
    const observed = await desktop.evaluate(`window.rovai.request('camps.open',{threadId:${JSON.stringify(threadId)},traceId:${JSON.stringify(randomUUID())}})`)
    assert.equal(observed.agentRuns.find(run=>run.id===stopRun.id)?.status, 'running', 'closing Web must preserve the active native Run')
    const resumed = await desktop.evaluate(`window.rovai.hostWeb.start({listen:${JSON.stringify(new URL(origin).host)},allowInsecureLan:false})`)
    assert.equal(resumed.origin, origin)
    assert.equal(resumed.administratorToken, administrator)
    const relogin = await fetch(origin + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 3, administratorToken: administrator }), redirect: 'error' })
    assert.equal(relogin.status, 200); token = (await relogin.json()).token
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: administrator })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('.web-login-overlay')===null`)
    evidence.checks.webStopPreservesNativeRun = true
  }
  await browser.click(`document.querySelector('[aria-label="停止当前运行"]')`)
  for (let i = 0; i < 100; i++) {
    stopRun = (await readCamp()).agentRuns.find(r => r.id === stopRun.id)
    if (stopRun.status === 'cancelled') break
    await pause(200)
  }
  assert.equal(stopRun.status, 'cancelled', 'Stop must settle before Host shutdown')
  evidence.stopRunId = stopRun.id
  evidence.checks.browserStopBeforeHostShutdown = true
  await browser.wait(`document.body.innerText.includes('已停止') || document.body.innerText.includes('你已在')`)
  assert.equal(await browser.evaluate('typeof window.rovai'), 'undefined')
  assert.deepEqual(browser.errors, [])
  evidence.checks.noElectronBridgeOrRuntimeExceptions = true
  await capture('web-stop-complete.png')
  evidence.hostBinarySha256 = createHash('sha256').update(await readFile(hostBinary)).digest('hex')
  evidence.status = 'passed'
  console.log(JSON.stringify({ stage: 'passed', fixture, ...evidence.checks }))
} catch (error) {
  evidence.status = 'failed'
  if (browser) await browser.capture(join(fixture, 'web-failure.png')).catch(() => undefined)
  throw error
} finally {
  if (browser) await browser.close()
  if (desktop) await desktop.close()
  if (child) {
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
    try { evidence.shutdown = await closed } finally { clearTimeout(timer) }
  }
  await writeFile(join(fixture, 'runtime-browser.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
  await writeFile(join(fixture, 'host.log'), log.replaceAll(administrator, '[administrator]').replaceAll(token ?? 'not-a-token', '[session]'), { mode: 0o600 })
  // Native Runtime evidence is intentionally retained for inspection, never copied
  // wholesale into the repository: it can contain authenticated session material.
  console.log(JSON.stringify({ stage: 'fixture-retained', fixture }))
}

function assertExactPublishApproval(input, command, workspace) {
  const quoted = `/bin/zsh -lc '${command}'`
  const escaped = `/bin/zsh -lc '${command.replaceAll('"', '\\"')}'`
  assert.equal(input?.kind, 'shell_command')
  assert.equal(input.cwd, workspace)
  assert.ok(Array.isArray(input.argv) && input.argv.length === 3)
  assert.ok(['/bin/zsh', '/bin/bash', '/bin/sh'].includes(input.argv[0]))
  assert.ok(['-lc', '-c'].includes(input.argv[1]))
  assert.ok([command, quoted, escaped].includes(input.argv[2]), 'Refusing approval for a command outside the exact fixture publication')
}
