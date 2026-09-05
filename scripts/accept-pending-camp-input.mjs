// Opt-in real Runtime acceptance. All data, files, Skills and MCP configuration are isolated.
// This owns the Desktop RPC/scheduler integration; deterministic state transitions live in Rust tests.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { assertUserDataIsIsolated, seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'

const { values } = parseArgs({ options: {
  core: { type: 'string' },
  'runtime-config': { type: 'string' }
} })
const repository = resolve(import.meta.dirname, '..')
const executable = resolve(values.core ?? join(repository, 'target/debug/rovai-core'))
const runtimeConfig = values['runtime-config']
  ? JSON.parse(await readFile(resolve(values['runtime-config']), 'utf8'))
  : { adapterKind: 'claude-code-cli' }
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-pending-input-acceptance-')))
const dataDir = assertUserDataIsIsolated(join(fixtureRoot, 'user-data'))
const projectPath = join(fixtureRoot, 'project')
await mkdir(dataDir)
await mkdir(projectPath)
await writeFile(join(projectPath, 'README.md'), '# Pending Camp Input acceptance\nSynthetic queue tests only.\n')
seedCompletedOnboardingForAcceptance(dataDir)
const report = { fixtureRoot, dataDir, projectPath, executable, runtimeKind: runtimeConfig.adapterKind, checks: [] }
let core

try {
  console.log(JSON.stringify({ channel: 'isolated-packaged-core-acceptance', dataDir, skillLibraryRoot: join(dataDir, 'managed-skill-library') }))
  core = startCore()
  await core.request('health.check')
  await configureProductRuntime(core.request, runtimeConfig.adapterKind, ['agent_1', 'agent_2'])
  for (const agentId of ['agent_1', 'agent_2']) {
    const profile = await core.request('members.get', { agentId })
    if (!runtimeConfig.model && !runtimeConfig.permissions) continue
    const configured = await core.request('members.runtime.set', {
      commandId: crypto.randomUUID(), command: {
        agentId, expectedVersion: profile.version, adapterKind: runtimeConfig.adapterKind,
        model: runtimeConfig.model ?? profile.runtimeConfiguration.model,
        permissions: runtimeConfig.permissions ?? profile.runtimeConfiguration.permissions
      }
    })
    assert.equal(configured.status, 'applied')
  }
  const profiles = await Promise.all(['agent_1', 'agent_2'].map((agentId) => core.request('members.get', { agentId })))
  assert.deepEqual(profiles[0].runtimeConfiguration, profiles[1].runtimeConfiguration)
  report.runtimeConfiguration = profiles[0].runtimeConfiguration
  check('两位队员使用相同的 Runtime、模型、推理强度与权限配置')
  const workspace = await core.request('workspaces.inspect', { path: projectPath })
  const bodies = ['QUEUE_A_OK', 'QUEUE_B_OK', 'QUEUE_C_OK', 'QUEUE_D_OK'].map((marker) => `请只回复 ${marker}，不要使用工具。`)
  const first = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(), workspace, name: 'Pending Input · 定向续发与附件验收',
    memberAgentIds: ['agent_1', 'agent_2'], defaultLeadAgentId: 'agent_1',
    address: { mode: 'explicit', agentIds: ['agent_2'] }, body: bodies[0], purpose: 'Queue FIFO acceptance'
  })
  assert.equal(first.status, 'accepted')
  const campId = first.payload.campId
  report.campId = campId
  const second = await send(campId, bodies[1])
  const third = await send(campId, bodies[2])
  const fourth = await send(campId, bodies[3])
  assert.equal(second.code, 'pending_input.queued')
  assert.equal(third.code, 'pending_input.queued')
  assert.equal(fourth.code, 'pending_input.queued')
  const queuedIds = [second.payload.pendingInputId, third.payload.pendingInputId, fourth.payload.pendingInputId]
  const initialQueue = await queue(campId)
  assert.deepEqual(initialQueue.items.map((item) => item.id), queuedIds)
  for (const item of initialQueue.items) {
    assert.deepEqual(item.content.filter((segment) => segment.kind === 'member_mention'), [{ kind: 'member_mention', agentId: 'agent_2' }])
  }
  assert.equal((await snapshot(campId)).messages.filter((message) => message.authorType === 'user').length, 1)
  check('继续发给芝士的 B、C、D 依次私有入队，目标没有变成默认队长叮叮')

  const heldHead = initialQueue.items[0]
  const headEdit = await edit(heldHead, { type: 'begin' })
  assert.equal(headEdit.status, 'applied')
  await waitFor(async () => {
    const value = await snapshot(campId)
    assertNoFailedRuns(value)
    return value.agentRuns[0]?.status === 'succeeded' ? value : null
  }, 'first Runtime completion while editing B')
  await new Promise((done) => setTimeout(done, 1100))
  assert.equal((await snapshot(campId)).messages.filter((message) => message.authorType === 'user').length, 1)
  assert.deepEqual((await queue(campId)).items.map((item) => item.id), queuedIds)
  assert.equal((await queue(campId)).executionActive, false)
  check('A 自然完成时，编辑中的 B 保持三条队列不动，没有启动下一轮')

  const attachmentToken = `ATTACHMENT_${crypto.randomUUID()}`
  const attachmentPath = join(fixtureRoot, '附件验收.txt')
  await writeFile(attachmentPath, `附件验收数据\n校验值：${attachmentToken}\n`, { mode: 0o600 })
  const attachmentBody = '读取本条消息附带的“附件验收.txt”，只回复文件中的校验值。不要修改文件。'
  const attachmentDraft = await saveDraft(campId, attachmentBody)
  const referencedDraft = await core.request('camp.sourceAttachments.addFromPath', {
    campId, expectedRevision: attachmentDraft.revision, sourcePath: attachmentPath, displayName: '附件验收.txt'
  })
  assert.equal(referencedDraft.attachments.length, 1)
  assert.equal(referencedDraft.attachments[0].availability, 'unknown')
  assert.equal(referencedDraft.continuationIntent?.recipient.agentId, 'agent_2')
  const queuedAttachment = await sendDraft(referencedDraft)
  assert.equal(queuedAttachment.code, 'pending_input.queued')
  queuedIds.push(queuedAttachment.payload.pendingInputId)
  const queueWithAttachment = await queue(campId)
  assert.deepEqual(queueWithAttachment.items.map((item) => item.id), queuedIds)
  const pendingAttachment = queueWithAttachment.items.at(-1)
  assert.equal(pendingAttachment.attachments.length, 1)
  assert.equal(pendingAttachment.attachments[0].displayName, '附件验收.txt')
  assert.equal(pendingAttachment.attachments[0].availability, 'unknown')
  assert.ok(!JSON.stringify(pendingAttachment).includes(attachmentPath))
  assert.equal((await core.request('camp.composerDraft.get', { campId })).attachments.length, 0)
  check('队列非空时正文与 source attachment 一起进入 Pending；队列 View 不暴露绝对路径')
  assert.equal((await edit(heldHead, { type: 'cancel' }, headEdit.payload.editToken)).status, 'applied')

  const completed = await waitFor(async () => {
    const value = await snapshot(campId)
    assertNoFailedRuns(value)
    return value.agentRuns.length === 5 && value.agentRuns.every((run) => run.status === 'succeeded') ? value : null
  }, 'five FIFO Runtime executions including the attachment input')
  const publicInputs = completed.messages.filter((message) => message.authorType === 'user').sort((a, b) => a.sequence - b.sequence)
  assert.equal(publicInputs.length, 5)
  publicInputs.slice(0, 4).forEach((message, index) => {
    assert.ok(message.body.includes(bodies[index]))
  })
  assert.ok(publicInputs[4].body.includes(attachmentBody))
  publicInputs.forEach((message) => assert.deepEqual(message.addressedAgentIds, ['agent_2']))
  const runs = publicInputs.map((message) => completed.agentRuns.find((run) => run.campTurnId === message.campTurnId))
  assert.ok(runs.every((run) => run.agentId === 'agent_2'))
  for (let index = 1; index < runs.length; index += 1) {
    assert.ok(runs[index - 1].endedAt && runs[index].startedAt)
    assert.ok(Date.parse(runs[index - 1].endedAt) <= Date.parse(runs[index].startedAt))
  }
  assert.equal((await queue(campId)).items.length, 0)
  report.fifo = runs.map(({ id, status, startedAt, endedAt, runtimeModel }) => ({ id, status, startedAt, endedAt, runtimeModel }))
  check('取消队首编辑后，芝士按 B → C → D → 附件消息各执行一次；后条等待前条结束')

  const publishedAttachment = publicInputs[4]
  assert.equal(publishedAttachment.attachments.length, 1)
  assert.equal(publishedAttachment.attachments[0].displayName, '附件验收.txt')
  assert.equal(publishedAttachment.attachments[0].availability, 'unknown')
  assert.ok(!JSON.stringify(publishedAttachment).includes(attachmentPath))
  assert.deepEqual(publishedAttachment.addressedAgentIds, ['agent_2'])
  assert.ok(completed.messages.some((message) => message.authorType === 'agent'
    && message.campTurnId === publishedAttachment.campTurnId && message.body.includes(attachmentToken)))
  assert.equal((await core.request('camp.composerDraft.get', { campId })).attachments.length, 0)
  report.attachment = { campMessageId: publishedAttachment.id, campTurnId: publishedAttachment.campTurnId, receivedBy: 'agent_2', contentVerified: true }
  check('Pending 附件发布为 Message source ref；Runtime resolver 让芝士实际读到文件内的随机校验值')

  // One Stop lets Core advance after cancellation settles; there is no queue mode to resume.
  const stopFirst = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(), workspace, name: 'Pending Input · 停止验收',
    memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1',
    body: '从 1 数到 300，每行一个数字，不要调用工具。', purpose: 'Queue Stop acceptance'
  })
  assert.equal(stopFirst.status, 'accepted')
  const stopCampId = stopFirst.payload.campId
  report.stopCampId = stopCampId
  const afterStop = await send(stopCampId, '请只回复 QUEUE_AFTER_STOP_OK，不要使用工具。')
  assert.equal(afterStop.code, 'pending_input.queued')
  const afterNext = await send(stopCampId, '请只回复 QUEUE_AFTER_NEXT_OK，不要使用工具。')
  assert.equal(afterNext.code, 'pending_input.queued')
  const active = await waitFor(async () => {
    const value = await snapshot(stopCampId)
    assertNoFailedRuns(value)
    return value.agentRuns[0]?.status === 'running' ? value : null
  }, 'active Runtime before Stop')
  const turn = active.turns.find((candidate) => candidate.id === stopFirst.payload.campTurnId)
  const stopped = await core.request('campTurns.cancel', {
    commandId: crypto.randomUUID(), command: { campId: stopCampId, campTurnId: turn.id, expectedVersion: turn.version }
  })
  assert.notEqual(stopped.status, 'rejected')
  const advanced = await waitFor(async () => {
    const value = await snapshot(stopCampId)
    assertNoFailedRuns(value)
    return value.agentRuns.length === 2 && value.agentRuns.some((run) => run.status === 'running'
      && run.campTurnId !== turn.id) ? value : null
  }, 'next input automatically starts after Stop')
  const stoppedRun = advanced.agentRuns.find((run) => run.campTurnId === turn.id)
  const nextRun = advanced.agentRuns.find((run) => run.campTurnId !== turn.id)
  assert.equal(stoppedRun.status, 'cancelled')
  assert.ok(stoppedRun.endedAt && nextRun.startedAt)
  assert.ok(Date.parse(stoppedRun.endedAt) <= Date.parse(nextRun.startedAt))
  assert.equal('mode' in await queue(stopCampId), false)
  assert.deepEqual((await queue(stopCampId)).items.map((item) => item.id), [afterNext.payload.pendingInputId])
  assert.equal(advanced.messages.filter((message) => message.authorType === 'user').length, 2)
  report.stop = [stoppedRun, nextRun].map(({ id, status, startedAt, endedAt }) => ({ id, status, startedAt, endedAt }))
  check('一次停止后，Core 等 A 完全停止才自动发送 B，无需再点继续发送')
  check('停止只推进一个队首：B 执行期间 C 仍在私有队列，没有同时发出')
  await waitFor(async () => {
    const value = await snapshot(stopCampId)
    assertNoFailedRuns(value)
    return value.agentRuns.length === 3 && value.agentRuns.every((run) => ['succeeded', 'cancelled'].includes(run.status))
      && (await queue(stopCampId)).items.length === 0 ? value : null
  }, 'normal FIFO resumes after the successor finishes')

  // Keep three inputs queued until the first Runtime finishes, then save the edited head.
  const editFirst = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(), workspace, name: 'Pending Input · 编辑验收',
    memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1',
    body: '请只回复 QUEUE_EDIT_A_OK，不要使用工具。', purpose: 'Queue edit acceptance'
  })
  assert.equal(editFirst.status, 'accepted')
  const editCampId = editFirst.payload.campId
  report.editCampId = editCampId
  assert.equal((await send(editCampId, '请只回复 QUEUE_EDIT_B_OK，不要使用工具。')).code, 'pending_input.queued')
  assert.equal((await send(editCampId, '请只回复 QUEUE_EDIT_C_OK，不要使用工具。')).code, 'pending_input.queued')
  assert.equal((await send(editCampId, '请只回复 QUEUE_EDIT_D_OK，不要使用工具。')).code, 'pending_input.queued')
  const ordinary = await saveDraft(editCampId, 'E · 这是一条未提交的普通草稿，编辑队列时应保留。')
  const beforeEdit = await queue(editCampId)
  const item = beforeEdit.items[0]
  const unfinished = await edit(item, { type: 'begin' })
  assert.equal(unfinished.status, 'applied')
  await waitFor(async () => {
    const value = await snapshot(editCampId)
    assertNoFailedRuns(value)
    return value.agentRuns[0]?.status === 'succeeded' && !(await queue(editCampId)).executionActive ? value : null
  }, 'natural Runtime completion with three inputs behind the edited head')
  await new Promise((done) => setTimeout(done, 1100))
  assert.deepEqual((await queue(editCampId)).items.map((entry) => entry.id), beforeEdit.items.map((entry) => entry.id))
  assert.equal((await snapshot(editCampId)).agentRuns.length, 1)
  check('保存路径：当前轮自然结束后，三条队列仍等待队首编辑，没有空隙抢发')

  // Also preserve the existing restart/fencing acceptance at this idle edit boundary.
  await core.stop()
  core = startCore()
  await core.request('health.check')
  assert.equal((await queue(editCampId)).editSession.recoveryRequired, true)
  const staleSave = await edit(item, {
    type: 'save', content: [{ kind: 'text', text: '旧窗口不应覆盖这条消息' }],
    replyToCampMessageId: null, recipientSelectionRequired: false
  }, unfinished.payload.editToken)
  assert.equal(staleSave.code, 'pending_input.edit_fenced')
  const reopened = await edit(item, { type: 'takeover' }, unfinished.payload.editToken)
  assert.notEqual(reopened.payload.editToken, unfinished.payload.editToken)
  const staleCancel = await edit(item, { type: 'cancel' }, unfinished.payload.editToken)
  assert.equal(staleCancel.code, 'pending_input.edit_fenced')
  check('重启保留编辑占用；重新编辑后，旧保存与旧取消均不能生效')
  const savedBody = '请只回复 QUEUE_EDIT_B_SAVED_OK，不要使用工具。'
  assert.equal((await edit(item, {
    type: 'save', content: [{ kind: 'text', text: savedBody }],
    replyToCampMessageId: null, recipientSelectionRequired: false
  }, reopened.payload.editToken)).status, 'applied')
  const savedCompleted = await waitFor(async () => {
    const value = await snapshot(editCampId)
    assertNoFailedRuns(value)
    return value.agentRuns.length === 4 && value.agentRuns.every((run) => run.status === 'succeeded')
      && (await queue(editCampId)).items.length === 0 ? value : null
  }, 'automatic FIFO after saving the edited head')
  const savedInputs = savedCompleted.messages.filter((message) => message.authorType === 'user').sort((a, b) => a.sequence - b.sequence)
  assert.equal(savedInputs.length, 4)
  assert.ok(savedInputs[1].body.includes(savedBody))
  assert.ok(savedInputs[2].body.includes('QUEUE_EDIT_C_OK'))
  assert.ok(savedInputs[3].body.includes('QUEUE_EDIT_D_OK'))
  const savedRuns = savedInputs.map((message) => savedCompleted.agentRuns.find((run) => run.campTurnId === message.campTurnId))
  for (let index = 1; index < savedRuns.length; index += 1) {
    assert.ok(Date.parse(savedRuns[index - 1].endedAt) <= Date.parse(savedRuns[index].startedAt))
  }
  assert.equal((await queue(editCampId)).editSession, null)
  assert.deepEqual(await core.request('camp.composerDraft.get', { campId: editCampId }), ordinary)
  check('保存队首后按修改后的 B → C → D 发送，位置不变，普通草稿不被覆盖')
  report.savedHead = savedRuns.map(({ id, status, startedAt, endedAt }) => ({ id, status, startedAt, endedAt }))
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error.message
  process.exitCode = 1
} finally {
  await core?.stop()
  await writeFile(join(fixtureRoot, 'acceptance.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}

function check(message) { report.checks.push(message); console.log(`PASS ${message}`) }
function queue(campId) { return core.request('camp.pendingInputs.get', { campId }) }
function snapshot(campId) { return core.request('camps.snapshot', { campId }) }
async function saveDraft(campId, body) {
  const draft = await core.request('camp.composerDraft.get', { campId })
  return core.request('camp.composerDraft.save', {
    campId, expectedRevision: draft.revision, content: [{ kind: 'text', text: body }],
    continuationSourceMessageId: draft.continuationIntent?.sourceCampMessageId ?? null
  })
}
async function send(campId, body) {
  return sendDraft(await saveDraft(campId, body))
}
async function sendDraft(saved) {
  return (await core.request('camp.messages.send', {
    commandId: crypto.randomUUID(), campId: saved.campId, draftRevision: saved.revision,
    execution: { taskId: null, purpose: 'Pending input acceptance', completionRole: 'required' }
  })).commandResult
}
function edit(item, action, editToken = null) {
  return core.request('camp.pendingInputs.edit', { commandId: crypto.randomUUID(), command: {
    campId: item.campId, pendingInputId: item.id, expectedRevision: item.revision, editToken, action
  } })
}
function assertNoFailedRuns(value) {
  const failed = value.agentRuns.find((run) => run.status === 'failed' || run.waitReason === 'recovery_blocked')
  assert.ok(!failed, `Runtime failed: ${failed?.failure?.code ?? failed?.waitReason ?? failed?.id}`)
}
async function waitFor(probe, label) {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
function startCore() {
  const child = spawn(executable, [
    ...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'managed-skill-library'),
    '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository, stdio: ['pipe', 'pipe', 'pipe'] })
  const stderr = createWriteStream(join(fixtureRoot, 'core.stderr.log'), { flags: 'a', mode: 0o600 })
  child.stderr.pipe(stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
    else request.resolve(message.result)
  })
  const rejectOutstanding = (error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
  }
  child.once('error', rejectOutstanding)
  child.once('close', (code) => rejectOutstanding(new Error(`Acceptance Core exited (${code})`)))
  return {
    request: (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
      const id = nextId++
      const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error(`Timed out waiting for ${method}`)) }, 60_000)
      pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    }),
    stop: async () => {
      if (child.exitCode !== null) return
      child.stdin.end()
      await Promise.race([
        new Promise((done) => child.once('close', done)),
        new Promise((done) => setTimeout(done, 3000))
      ])
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise((done) => child.once('close', done))
      }
    }
  }
}
