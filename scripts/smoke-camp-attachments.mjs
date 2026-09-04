import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-camp-attachment-smoke-'))
const dataDir = join(fixtureRoot, 'data')
const sourcePath = join(fixtureRoot, 'public-attachment.txt')
const token = `PUBLIC_ATTACHMENT_TOKEN_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`
const firstAgents = ['agent_1', 'agent_2']
const contextFormatterVersion = 14
let core = null

try {
  await writeFile(sourcePath, [
    'Rovai-ai Camp Attachment Runtime acceptance fixture.',
    `TOKEN=${token}`,
    'The correct response is the exact value after TOKEN=.'
  ].join('\n'), { mode: 0o600 })

  core = startCore(dataDir)
  const health = await core.request('health.check')
  const installation = await configureCodexRuntime(
    core.request,
    health,
    firstAgents
  )
  const preflight = await core.request('camps.creationPreflight')
  if (!preflight.admissible) {
    throw new Error(`Camp creation preflight failed: ${JSON.stringify(preflight)}`)
  }
  const created = await core.request('camps.create', {
    commandId: crypto.randomUUID(),
    name: 'Camp Attachment Runtime Smoke',
    workspace: null,
    memberAgentIds: preflight.presentMembers.map((member) => member.agentId),
    defaultLeadAgentId: firstAgents[0],
    collaborationMode: 'peer'
  })
  const campId = created.payload?.campId
  if (created.status !== 'applied' || !campId) {
    throw new Error(`Camp creation failed: ${JSON.stringify(created)}`)
  }

  const initialDraft = await core.request('camp.composerDraft.get', { campId })
  const referencedDraft = await core.request('camp.sourceAttachments.addFromPath', {
    campId,
    expectedRevision: initialDraft.revision,
    sourcePath,
    displayName: 'Runtime 公共附件.txt'
  })
  const attachment = referencedDraft.attachments?.[0]
  if (referencedDraft.attachments?.length !== 1
      || attachment?.availability !== 'unknown'
      || attachment?.previewKind !== 'none') {
    throw new Error(`Source Attachment reference failed: ${JSON.stringify(referencedDraft)}`)
  }

  const firstDraft = await core.request('camp.composerDraft.save', {
    campId,
    expectedRevision: referencedDraft.revision,
    content: [
      { kind: 'member_mention', agentId: firstAgents[0] },
      { kind: 'text', text: ' ' },
      { kind: 'member_mention', agentId: firstAgents[1] },
      { kind: 'text', text: ` ${[
        '读取本条消息携带的本地附件引用，不要猜测内容。',
        '必须使用文件读取工具打开 Current Input 给出的附件路径。',
        '只回复附件中 TOKEN= 后面的完整值，不要添加其他文字。'
      ].join('\n')}` }
    ]
  })
  const firstSent = await core.request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: firstDraft.revision,
    execution: {
      taskId: null,
      purpose: 'Verify two addressed Camp members can read their resolved source attachment path.',
      completionRole: 'required'
    }
  })
  const firstRunIds = firstSent.commandResult?.payload?.agentRunIds ?? []
  if (firstSent.commandResult?.status !== 'accepted' || firstRunIds.length !== 2) {
    throw new Error(`Two-member attachment message was not accepted: ${JSON.stringify(firstSent)}`)
  }

  const snapshot = await waitFor(async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    const runs = candidate.agentRuns.filter((run) => firstRunIds.includes(run.id))
    failOnTerminalError(runs, candidate)
    return runs.length === 2 && runs.every((run) => run.status === 'succeeded')
      ? candidate
      : null
  }, 'two addressed members to read the public attachment', 300_000)
  assertRunRepliesContain(snapshot, firstRunIds, token, 'addressed members')

  const firstMessage = snapshot.messages.find((message) =>
    message.attachments?.some((item) => item.id === attachment.id)
  )
  const firstManifests = snapshot.contextManifests.filter((manifest) =>
    firstRunIds.includes(manifest.agentRunId)
  )
  if (firstMessage?.attachments?.length !== 1
      || firstMessage.attachments[0]?.availability !== 'unknown'
      || JSON.stringify(firstMessage).includes(sourcePath)
      || firstManifests.length !== 2
      || firstManifests.some((manifest) =>
        manifest.formatterVersion !== contextFormatterVersion
        || manifest.attachmentRefs?.length !== 0
      )) {
    throw new Error(`Source attachment public projection is invalid: ${JSON.stringify({
      firstMessage,
      firstManifests
    })}`)
  }
  const dataEntries = await readdir(dataDir)
  if (dataEntries.includes('camp-attachments')) {
    throw new Error(`New source attachment created a persistent camp-attachments directory: ${JSON.stringify(dataEntries)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: installation.snapshot.reportedVersion,
    campId,
    attachmentId: attachment.id,
    addressedMemberRunIds: firstRunIds,
    tokenVerifiedByRunCount: 2,
    runLocalResolutionVerified: true,
    persistentAttachmentDirectoryAbsent: true,
    contextFormatterVersion
  }, null, 2))
} finally {
  if (core) await core.stop()
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  await rm(fixtureRoot, { recursive: true, force: true })
}

function assertRunRepliesContain(snapshot, runIds, expectedToken, label) {
  const replies = snapshot.messages.filter((message) =>
    message.sourceAgentRunId && runIds.includes(message.sourceAgentRunId)
  )
  if (replies.length !== runIds.length
      || replies.some((message) => !message.body.includes(expectedToken))) {
    throw new Error(`${label} did not return the attachment token: ${JSON.stringify({
      runIds,
      replies
    })}`)
  }
}

function failOnTerminalError(runs, snapshot) {
  if (runs.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
    throw new Error(`Attachment Runtime Run failed: ${JSON.stringify({
      runs,
      recentMessages: snapshot.messages.slice(-8),
      recentTimeline: snapshot.timeline.slice(-12)
    })}`)
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  let stopped = false
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopped) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    stopped = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

async function waitFor(probe, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}
