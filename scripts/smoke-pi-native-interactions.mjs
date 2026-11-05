import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, copyFile, writeFile, realpath, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-pi-native-interactions-')))
const data = join(fixture, 'data'), agent = join(fixture, 'pi-agent'), workspace = join(fixture, 'workspace')
const questionPlugin = process.env.ROVAI_PI_QUESTION_PLUGIN
const pluginInfo = questionPlugin ? JSON.parse(await readFile(join(dirname(resolve(questionPlugin)), 'package.json'), 'utf8')) : null
const pi = process.env.ROVAI_PI_BIN ?? '/opt/homebrew/bin/pi'
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim()
await mkdir(join(agent, 'extensions'), { recursive: true })
await mkdir(workspace)
await mkdir(join(fixture, 'home'))
if (questionPlugin) {
  await writeFile(join(agent, 'extensions/probe.ts'), `import probe from ${JSON.stringify(join(root, 'scripts/fixtures/pi-native-interactions/probe.ts'))};\nimport plugin from ${JSON.stringify(resolve(questionPlugin))};\nexport default pi => probe(pi, plugin);\n`)
} else await copyFile(join(root, 'scripts/fixtures/pi-native-interactions/probe.ts'), join(agent, 'extensions/probe.ts'))
await writeFile(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'rovai-native-fixture', defaultModel: 'native-dialogs',
  enableSkillCommands: false, packages: [] }))
await writeFile(join(workspace, 'README.md'), 'Isolated native-interaction acceptance.\n')
for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Native Fixture'], ['config', 'user.email', 'fixture@rovai.local'], ['add', '.'], ['commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
console.log(JSON.stringify({ fixture, data, skills: join(data, 'skills'), piAgent: agent, version, externalModelCalls: 0 }))
const child = spawn(join(root, 'target/debug/rovai-core'), [...coreDataDirectoryArguments(data, { homeDirectory: join(fixture, 'home') }), '--skill-library-root', join(data, 'skills'), '--mcp-config-path', join(data, 'mcp.json')], {
  cwd: root, env: { PATH: process.env.PATH, HOME: join(fixture, 'home'), TMPDIR: process.env.TMPDIR, PI_CODING_AGENT_DIR: agent,
    ROVAI_PI_BIN: pi, PI_TELEMETRY: '0', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = new Map(), events = [], stderr = []
let next = 0
child.stderr.on('data', chunk => { stderr.push(String(chunk)); appendFileSync(join(fixture, 'core.stderr.log'), chunk) })
createInterface({ input: child.stdout }).on('line', line => {
  const message = JSON.parse(line)
  appendFileSync(join(fixture, 'core.frames.jsonl'), line + '\n')
  if (!message.id && !message.method) {
    if (['failed', 'blocked'].includes(message.status)) console.error(JSON.stringify(message))
    return
  }
  if (message.method) { events.push(message); return }
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id); clearTimeout(waiter.timer)
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result)
})
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)) }, 60000)
  pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, predicate, label, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await read(); if (predicate(value)) return value; await delay(100) }
  throw new Error(`Timeout waiting for ${label}`)
}
const snapshot = threadId => request('threads.open', { threadId, traceId: crypto.randomUUID() })
const respond = (threadId, interaction, answer) => request('nativeInteractions.respond', { commandId: crypto.randomUUID(), threadId,
  interactionId: interaction.id, agentRunId: interaction.agentRunId, executionEpoch: interaction.executionEpoch, answer })
const start = async (body, agentIds = ['agent_2']) => {
  const accepted = await createConfiguredCampAndSend(request, { commandId: crypto.randomUUID(), workspace: { projectPath: workspace },
    memberAgentIds: agentIds, defaultLeadAgentId: agentIds[0], address: { mode: 'explicit', agentIds }, body, purpose: 'Native interaction acceptance' })
  assert.ok(['accepted', 'applied'].includes(accepted.status), JSON.stringify(accepted)); return accepted.payload.threadId
}
const nextQuestion = async (threadId, title) => {
  const matches = item => item.questions[0]?.title.includes(title)
  const current = await until(() => snapshot(threadId), snapshot => snapshot.nativeInteractions?.some(matches), title)
  return current.nativeInteractions.find(matches)
}
async function nativeToolResults(directory) {
  const results = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await nativeToolResults(path))
    else if (entry.name.endsWith('.jsonl')) for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
      const record = JSON.parse(line), message = record.message
      if (message?.role === 'toolResult' && message.toolName === 'native_interaction_probe') {
        results.push(JSON.parse(message.content[0].text))
      }
    }
  }
  return results
}
const reports = []
try {
  await until(async () => events, list => list.some(event => event.method === 'runtime.discovery.completed'), 'runtime discovery')
  console.log('Runtime discovery completed')
  await request('runtime.product.check', { runtimeKind: 'pi' })
  const installation = (await request('runtime.installations.list')).find(item => item.adapterKind === 'pi' && item.installationClass === 'managed_default')
  assert.equal(installation?.snapshot?.probeStatus, 'ready', JSON.stringify(installation?.snapshot))
  for (const agentId of ['agent_2', 'agent_3']) {
    const profile = await request('members.get', { agentId })
    const result = await request('members.runtime.set', { commandId: crypto.randomUUID(), command: { agentId,
      expectedVersion: profile.version, adapterKind: 'pi', model: installation.memberRuntimeDefaults.model,
      permissions: installation.memberRuntimeDefaults.permissions } })
    assert.equal(result.status, 'applied')
  }
  console.log('Pi fixture configured')
  const threadId = await start('NATIVE_FLOW: run the controlled native-dialog fixture.')
  let item = await nextQuestion(threadId, 'Confirm yes')
  await delay(300)
  assert.equal((await snapshot(threadId)).nativeInteractions[0].id, item.id, 'unanswered questions do not auto-approve or cancel')
  const stale = { ...item, executionEpoch: item.executionEpoch + 1 }
  assert.equal((await respond(threadId, stale, { kind: 'confirm', confirmed: true })).status, 'unavailable')
  const once = await Promise.all([respond(threadId, item, { kind: 'confirm', confirmed: true }), respond(threadId, item, { kind: 'confirm', confirmed: true })])
  assert.ok(once.every(result => result.status === 'sent'))
  item = await nextQuestion(threadId, 'Confirm no'); assert.equal((await respond(threadId, item, { kind: 'confirm', confirmed: false })).status, 'sent')
  item = await nextQuestion(threadId, 'Skip confirmation'); assert.equal((await respond(threadId, item, { kind: 'skip' })).status, 'skipped')
  item = await nextQuestion(threadId, 'Select original value'); assert.deepEqual(item.questions[0].options.map(option => option.label), [' Windows ', 'Linux', 'Type something.'])
  assert.equal((await respond(threadId, item, { kind: 'select', optionId: '2' })).status, 'sent')
  const input = await nextQuestion(threadId, 'Your own answer'); assert.notEqual(input.id, item.id)
  const custom = '  自行填写\n保留空格  '
  assert.equal((await respond(threadId, input, { kind: 'input', value: custom })).status, 'sent')
  item = await nextQuestion(threadId, 'Empty input'); assert.equal((await respond(threadId, item, { kind: 'input', value: '' })).status, 'sent')
  item = await nextQuestion(threadId, 'Multiline editor'); assert.equal(item.questions[0].multiline, true); assert.equal(item.questions[0].prefill, '  预填\n第二行  '); assert.equal(item.expiresAt, null)
  assert.equal((await respond(threadId, item, { kind: 'input', value: '  第一行\n第二行  ' })).status, 'sent')
  item = await nextQuestion(threadId, 'Multiple selections as text'); assert.equal((await respond(threadId, item, { kind: 'input', value: '1,3; custom answer' })).status, 'sent')
  if (questionPlugin) {
    item = await nextQuestion(threadId, 'Plugin single question')
    assert.equal(item.questions[0].kind, 'select')
    assert.equal(item.questions[0].options.length, 4)
    await respond(threadId, item, { kind: 'select', optionId: '3' })
    const follow = await nextQuestion(threadId, 'Type your answer:')
    assert.notEqual(item.id, follow.id)
    await respond(threadId, follow, { kind: 'input', value: 'FreeBSD custom' })
    item = await nextQuestion(threadId, 'Plugin multi question')
    assert.equal(item.questions[0].kind, 'input')
    await respond(threadId, item, { kind: 'input', value: '1,3; custom plugin answer' })
    reports.push({ name: 'installed ask_user_question: single/custom and multi text via actual native RPC', passed: true })
  }
  const ended = await until(() => snapshot(threadId), s => s.agentRuns.some(run => run.status === 'succeeded'), 'same run success')
  assert.equal(ended.agentRuns.length, 1)
  assert.equal(ended.nativeInteractions.length, 0)
  const actualAnswers = (await nativeToolResults(join(agent, 'sessions'))).find(answers => answers.length >= 8)
  assert.deepEqual(actualAnswers.slice(0, 8), [true, false, false, 'Type something.', custom, '', '  第一行\n第二行  ', '1,3; custom answer'], 'The real Pi extension receives exact values, including cancellation semantics and whitespace')
  reports.push({ name: 'four methods, native continuation, exact text, blank, skip, duplicate and epoch fencing', passed: true })
  const parallelThread = await start('NATIVE_PARALLEL')
  const parallel = await until(() => snapshot(parallelThread), s => s.nativeInteractions.length === 2, 'two requests from one member')
  assert.equal(new Set(parallel.nativeInteractions.map(item => item.agentRunId)).size, 1)
  assert.notEqual(parallel.nativeInteractions[0].id, parallel.nativeInteractions[1].id)
  for (const question of parallel.nativeInteractions) await respond(parallelThread, question,
    question.questions[0].kind === 'confirm' ? { kind: 'confirm', confirmed: false } : { kind: 'input', value: 'independent input' })
  await until(() => snapshot(parallelThread), s => s.agentRuns.some(run => run.status === 'succeeded'), 'parallel requests continue one run')
  reports.push({ name: 'same member concurrent native requests', passed: true })
  const opened = await request('singleChat.open', { commandId: crypto.randomUUID(), command: { threadId, agentId: 'agent_2' } })
  const conversationId = opened.payload.conversationId
  assert.ok(conversationId, JSON.stringify(opened))
  const privateSnapshot = () => request('singleChat.get', { conversationId })
  const initialPrivate = await privateSnapshot()
  const queuedPrivate = await request('singleChat.send', { commandId: crypto.randomUUID(), command: { threadId, conversationId, body: 'NATIVE_PARALLEL', draftRevision: initialPrivate.draft.revision } })
  assert.notEqual(queuedPrivate.status, 'rejected', JSON.stringify(queuedPrivate))
  const privateQuestions = await until(privateSnapshot, s => s.nativeInteractions?.length === 2, 'private native requests')
  assert.equal((await snapshot(threadId)).nativeInteractions.length, 0, 'Private questions never enter the public projection')
  for (const question of privateQuestions.nativeInteractions) assert.equal((await respond(threadId, question,
    question.questions[0].kind === 'confirm' ? { kind: 'confirm', confirmed: false } : { kind: 'input', value: 'private input' })).status, 'sent')
  await until(privateSnapshot, s => s.agentRuns.some(run => run.status === 'succeeded'), 'private run success')
  reports.push({ name: 'private questions isolated from the public queue', passed: true })
  const timedThread = await start('NATIVE_TIMEOUT')
  item = await nextQuestion(timedThread, 'Native timeout'); const deadline = item.expiresAt
  assert.ok(deadline > item.createdAt)
  assert.equal((await nextQuestion(timedThread, 'Native timeout')).expiresAt, deadline)
  await delay(Math.max(0, deadline - Date.now()) + 150)
  assert.ok(['expired', 'unavailable'].includes((await respond(timedThread, item, { kind: 'input', value: 'late' })).status))
  await until(() => snapshot(timedThread), s => s.agentRuns.some(run => run.status === 'succeeded') && s.nativeInteractions.length === 0, 'native timeout completion')
  reports.push({ name: 'native timeout and late answer', passed: true })
  const concurrent = await start('NATIVE_STOP', ['agent_2', 'agent_3'])
  const both = await until(() => snapshot(concurrent), s => s.nativeInteractions.length === 2, 'two members waiting')
  assert.notEqual(both.nativeInteractions[0].id, both.nativeInteractions[1].id)
  for (const run of both.agentRuns) await request('agentRuns.cancel', { commandId: crypto.randomUUID(), command: { threadId: concurrent, agentRunId: run.id, expectedVersion: run.version } })
  const cancelled = await until(() => snapshot(concurrent), s => s.agentRuns.every(run => run.status === 'cancelled') && s.nativeInteractions.length === 0, 'stop while waiting', 10000)
  for (const question of both.nativeInteractions) assert.equal((await respond(concurrent, question, { kind: 'confirm', confirmed: true })).status, 'unavailable')
  reports.push({ name: 'two members, stop releases native waits, late answers fenced', passed: true, runs: cancelled.agentRuns.map(run => run.id) })
  await writeFile(join(fixture, 'verification.json'), JSON.stringify({ ok: true, version, plugin: pluginInfo && { name: pluginInfo.name, version: pluginInfo.version }, fixture, externalModelCalls: 0, reports }, null, 2))
  console.log(JSON.stringify({ ok: true, fixture, version, plugin: pluginInfo && { name: pluginInfo.name, version: pluginInfo.version }, externalModelCalls: 0, reports }, null, 2))
} catch (error) {
  await writeFile(join(fixture, 'failure.log'), stderr.join(''))
  console.error(JSON.stringify({ fixture, error: String(error), stderr: stderr.slice(-15) }, null, 2)); process.exitCode = 1
} finally {
  child.stdin.end()
  const closed = new Promise(resolve => child.once('close', resolve))
  await Promise.race([closed, delay(10000).then(() => { child.kill('SIGTERM') })])
  for (const waiter of pending.values()) clearTimeout(waiter.timer)
}
