import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { claudeSendReceipt } from './lib/claude-send-receipt.mjs'
import { assertDevelopmentUserDataIsIsolated, seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-claude-desktop-')))
const userData = assertDevelopmentUserDataIsIsolated(join(fixture, 'user-data'))
const project = join(fixture, 'project')
const output = resolve(process.env.ROVAI_CLAUDE_DESKTOP_OUTPUT ?? join(fixture, 'evidence'))
const port = await availablePort()
let app, cdp, dataDirectory
const log = []
console.error(`Actual Desktop acceptance: userData=${userData}; skills=${join(userData, 'managed-skill-library')}; MCP=${join(userData, 'mcp.json')}; output=${output}`)
try {
  await mkdir(project)
  await mkdir(output, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Claude native approval Desktop acceptance\n')
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Rovai Acceptance'],
    ['config', 'user.email', 'acceptance@rovai.local'], ['add', 'README.md'], ['commit', '-m', 'fixture']]) {
    await run('git', args, project)
  }
  seedCompletedOnboardingForAcceptance(userData)
  // The repository launcher owns isolated Desktop/Core/Skill/MCP startup.
  app = spawn('pnpm', ['dev'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROVAI_DEV_USER_DATA_DIR: userData, REMOTE_DEBUGGING_PORT: String(port) } })
  for (const stream of [app.stdout, app.stderr]) stream.on('data', value => log.push(String(value)))
  const target = await waitFor(async () => {
    if (app.exitCode !== null) throw new Error('Isolated development Desktop exited before becoming ready')
    try { return (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json())).find(value => value.type === 'page') } catch { return null }
  }, 'Desktop DevTools', 180000)
  cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.bringToFront')
  await waitFor(() => evaluate('Boolean(window.rovai && document.querySelector(".app-shell"))'), 'Desktop shell')
  await evaluate(`window.__claudeApprovalSessions = []; window.rovai.onEvent(event => {
    if (event.method === 'agent_run.native_session_bound') window.__claudeApprovalSessions.push(event.params)
  }); true`)
  const request = (method, params = {}) => evaluate(`window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
  const health = await waitFor(async () => { try { return await request('health.check') } catch { return null } }, 'Desktop Core')
  if (!health.database.path.startsWith(`${userData}/`)) throw new Error('Desktop opened a database outside the isolated userData')
  dataDirectory = dirname(health.database.path)
  await waitFor(() => evaluate('Boolean(document.getElementById("global-navigation"))'), 'Loaded Desktop navigation')
  const installation = await configureProductRuntime(request, 'claude-code-cli', ['agent_1'])
  const member = await request('members.get', { agentId: 'agent_1' })
  const configured = await request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: member.agentId, expectedVersion: member.version, adapterKind: 'claude-code-cli', model: member.runtimeConfiguration.model,
    permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: { permission_mode: 'acceptEdits' } }
  } })
  if (configured.status !== 'applied') throw new Error('Could not freeze acceptEdits for the isolated member')
  const workspace = await request('workspaces.inspect', { path: project })
  const marker = `ROVAI_CLAUDE_DESKTOP_${crypto.randomUUID()}`
  const command = `rovai send --public-only --body "${marker}"`
  const prompt = `Use Bash exactly once to run this exact command: ${command}. If denied, do not retry and finish with DENIED. If it succeeds, finish with DONE.`
  const intake = await createConfiguredCampAndSend(request, { commandId: crypto.randomUUID(), workspace,
    memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', body: prompt, purpose: 'Actual Desktop native approval click acceptance' })
  const threadId = intake.payload?.threadId
  if (intake.status !== 'accepted' || !threadId) throw new Error('Desktop acceptance Camp was not accepted')
  const results = []
  let rememberedRules, rememberedSettings
  for (const decision of ['allow_once', 'deny', 'allow_remember']) {
    if (results.length) {
      const sent = await request('camp.messages.send', { commandId: crypto.randomUUID(), threadId,
        content: { version: 2, segments: [{ kind: 'text', text: prompt }] }, sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
        execution: { taskId: null, purpose: 'Resume same native session and repeat the exact command', completionRole: 'required' } })
      if (sent.commandResult?.status !== 'accepted') throw new Error('Desktop resume input was not accepted')
    }
    const pending = await waitFor(async () => {
      const snapshot = await request('camps.snapshot', { threadId })
      const run = snapshot.agentRuns.find(value => !results.some(result => result.runId === value.id))
      const action = snapshot.actions.find(value => value.agentRunId === run?.id)
      const approval = snapshot.approvals.find(value => value.actionId === action?.id && value.status === 'pending')
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status) && !approval) throw new Error(`Run ended without approval: ${JSON.stringify(run)}`)
      return approval ? { run, action, approval } : null
    }, `${decision} native Approval`, 240000)
    if (JSON.stringify(pending.approval.canonicalInput.argv) !== JSON.stringify([command])) {
      throw new Error('Claude did not request the exact repeated command')
    }
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-sidebar-menu-target="camp:${threadId}"]'))`), 'Camp navigation')
    await click(`document.querySelector('[data-sidebar-menu-target="camp:${threadId}"]')?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')`)
    await waitFor(() => evaluate(`Boolean(document.querySelector('.approval-dock'))`), 'Approval Dock')
    if (await evaluate(`Boolean(document.querySelector('.approval-dock.is-collapsed'))`)) await click(`document.querySelector('.approval-dock-collapse')`)
    const option = decision === 'allow_remember'
      ? pending.approval.options.find(value => value.optionId.startsWith('claude.allow_remember.')
        && value.consequence.endsWith('localSettings · .claude/settings.local.json'))
      : pending.approval.options.find(value => value.optionId === `claude.${decision}`)
    if (!option) throw new Error(`Claude did not offer the native ${decision} option`)
    const button = `document.querySelector('[data-approval-id="${pending.approval.id}"] [data-option-id="${option.optionId}"]')`
    await waitFor(() => evaluate(`Boolean(${button})`), 'Exact native decision button')
    const expectedLabel = decision === 'deny' ? 'No' : decision === 'allow_once' ? 'Yes' : option.label
    if (await evaluate(`${button}.textContent`) !== expectedLabel) throw new Error('Desktop did not retain the native English button label')
    if (decision === 'allow_remember') {
      if (await evaluate(`${button}.getAttribute('aria-label')`) !== expectedLabel) throw new Error('The full native remember label was not accessible')
      if (await evaluate(`Boolean(document.querySelector('.approval-remember-scope'))`)) throw new Error('Remember configuration details must not be shown below the choices')
      rememberedRules = option.consequence.split('\n').slice(0, -1)
    }
    await screenshot(`${decision}-pending.png`)
    await click(button)
    const settled = await waitFor(async () => {
      const snapshot = await request('camps.snapshot', { threadId })
      const run = snapshot.agentRuns.find(value => value.id === pending.run.id)
      return run && ['succeeded', 'failed', 'cancelled'].includes(run.status) ? { snapshot, run } : null
    }, `${decision} tool and Run settlement`, 240000)
    const action = settled.snapshot.actions.find(value => value.id === pending.action.id)
    const nativeSessionId = await evaluate(`window.__claudeApprovalSessions.find(value => value.agentRunId === ${JSON.stringify(pending.run.id)})?.nativeThreadId`)
    if (typeof nativeSessionId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(nativeSessionId)) {
      throw new Error('Actual Desktop Run had no reliable native Session binding event')
    }
    const receipt = await claudeSendReceipt(request, threadId, pending.run.id, marker, settled.snapshot)
    const published = settled.snapshot.messages.some(value => value.body === marker && value.sourceAgentRunId === pending.run.id)
    if (settled.run.status !== 'succeeded' || (decision !== 'deny'
      ? action?.status !== 'succeeded' || !receipt || !published
      : action?.status !== 'not_executed' || receipt || published)) {
      throw new Error(`Actual Desktop ${decision} click did not settle correctly: ${JSON.stringify({ action, run: settled.run, receipt, published })}`)
    }
    results.push({ decision, runId: pending.run.id, conversationId: settled.run.conversationId, nativeSessionId,
      actionId: action.id, actionDigest: action.actionDigest, requestDigest: pending.approval.requestDigest, actionStatus: action.status,
      approvalId: pending.approval.id, optionId: option.optionId, nativeResponseDigest: option.nativeResponseDigest,
      label: expectedLabel, scope: decision === 'allow_remember' ? option.consequence : null, receipt, published, clicked: true })
    if (decision === 'allow_remember') {
      rememberedSettings = JSON.parse(await readFile(join(project, '.claude/settings.local.json'), 'utf8'))
      if (JSON.stringify(rememberedSettings.permissions?.allow?.toSorted()) !== JSON.stringify(rememberedRules.toSorted())
          || rememberedSettings.permissions?.defaultMode === 'bypassPermissions') {
        throw new Error(`Claude did not save exactly the selected native rules: ${JSON.stringify(rememberedSettings)}`)
      }
    }
    await screenshot(`${decision}-settled.png`)
    console.error(`Desktop ${decision} click passed; action=${action.status}; Core receipt=${Boolean(receipt)}`)
  }
  if (results[0].conversationId !== results[1].conversationId) throw new Error('Desktop repeat did not resume the same conversation')
  if (results[0].nativeSessionId !== results[1].nativeSessionId) throw new Error('Desktop repeat did not resume the same native Session')
  if (results[0].actionDigest !== results[1].actionDigest || results[0].actionId === results[1].actionId
      || !results[0].requestDigest || !results[1].requestDigest || results[0].requestDigest === results[1].requestDigest) {
    throw new Error('Identical Desktop commands did not bind independent native requests')
  }
  const repeated = await request('camp.messages.send', { commandId: crypto.randomUUID(), threadId,
    content: { version: 2, segments: [{ kind: 'text', text: prompt }] }, sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Verify the saved native rule skips approval on a subsequent Run', completionRole: 'required' } })
  if (repeated.commandResult?.status !== 'accepted') throw new Error('Remembered-rule repeat was not accepted')
  const automatic = await waitFor(async () => {
    const snapshot = await request('camps.snapshot', { threadId })
    const run = snapshot.agentRuns.find(value => !results.some(result => result.runId === value.id))
    if (snapshot.approvals.some(value => value.agentRunId === run?.id)) throw new Error('Remembered command unexpectedly requested another approval')
    return run && ['succeeded', 'failed', 'cancelled'].includes(run.status) ? { snapshot, run } : null
  }, 'Remembered native command without another approval', 240000)
  const automaticReceipt = await claudeSendReceipt(request, threadId, automatic.run.id, marker, automatic.snapshot)
  const automaticPublished = automatic.snapshot.messages.some(value => value.body === marker && value.sourceAgentRunId === automatic.run.id)
  const automaticSession = await evaluate(`window.__claudeApprovalSessions.find(value => value.agentRunId === ${JSON.stringify(automatic.run.id)})?.nativeThreadId`)
  if (automatic.run.status !== 'succeeded' || !automaticReceipt || !automaticPublished || automaticSession !== results[0].nativeSessionId) {
    throw new Error(`Remembered native command did not really execute: ${JSON.stringify({run: automatic.run, automaticReceipt, automaticPublished, automaticSession})}`)
  }
  await screenshot('remembered-repeat-settled.png')
  const result = { ok: true, runtime: installation.snapshot.reportedVersion, permissionMode: 'acceptEdits', sameCommandRepeated: true,
    nativeSessionResumed: true, results, rememberedSettings,
    automaticRepeat: { runId: automatic.run.id, nativeSessionId: automaticSession, receipt: automaticReceipt, published: automaticPublished, approvals: 0 } }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  cdp?.close()
  if (app && app.exitCode === null) {
    process.kill(-app.pid, 'SIGTERM')
    await Promise.race([new Promise(done => app.once('exit', done)), new Promise(done => setTimeout(done, 5000))])
    try { process.kill(-app.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  await writeFile(join(output, 'desktop-launch.log'), log.join(''), { mode: 0o600 })
  if (dataDirectory) await removeEphemeralRuntimeCampFilesRoot(dataDirectory)
  if (process.env.ROVAI_KEEP_CLAUDE_DESKTOP_FIXTURE !== '1' && !output.startsWith(`${fixture}/`)) await rm(fixture, { recursive: true, force: true })
  else console.error(`Retained isolated Desktop fixture: ${fixture}`)
}

async function click(expression) {
  const point = await evaluate(`(() => { const element = ${expression}; if (!element || element.disabled) return null;
    element.scrollIntoView({block:'center'}); const rect = element.getBoundingClientRect();
    return rect.width && rect.height ? {x:rect.x + rect.width/2,y:rect.y + rect.height/2} : null })()`)
  if (!point) throw new Error('Desktop target button is unavailable')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
}
async function screenshot(name) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(output, name), Buffer.from(image.result.data, 'base64'))
}
async function evaluate(expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  return response.result.result.value
}
async function waitFor(probe, label, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await probe(); if (value) return value; await new Promise(done => setTimeout(done, 100)) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: 'ignore' })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done) })
  if (code !== 0) throw new Error(`${command} failed: ${code}`)
}
async function availablePort() {
  const server = createServer()
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map()
  let id = 0
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data)), request = pending.get(value.id)
    if (!request) return
    pending.delete(value.id)
    value.error ? request.reject(new Error(value.error.message)) : request.resolve(value)
  })
  socket.addEventListener('close', () => { for (const request of pending.values()) request.reject(new Error('Desktop connection closed')); pending.clear() })
  return { send(method, params = {}) { return new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })) }) }, close() { socket.close() } }
}
