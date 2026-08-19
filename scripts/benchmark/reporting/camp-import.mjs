import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dispatchQualificationPrompt } from '../../lib/qualification-common.mjs'
import { findCompetingRovaiProcesses } from '../../lib/qualification-core.mjs'
import { coreDataDirectoryArguments } from '../../lib/runtime-camp-files-root.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

export async function importBenchmarkReviewCamps({
  coreExecutable,
  dataDirectory,
  projectPath,
  review,
  trialReviews = [],
  legacyTrialCamps = false
}) {
  const competing = await findCompetingRovaiProcesses()
  if (competing.length > 0) {
    throw new Error(`Rovai App/Core must be stopped before import: ${competing.map((item) => item.pid).join(',')}`)
  }
  const core = startCore(coreExecutable, dataDirectory)
  try {
    await core.request('health.check', {}, 120_000)
    const workspace = await core.request('workspaces.inspect', { path: projectPath })
    const preflight = await core.request('camps.creationPreflight')
    if (!preflight.admissible || !preflight.initialLeadAgentId || preflight.presentMembers.length === 0) {
      throw new Error(`local Rovai profile cannot create benchmark Review Camp: ${JSON.stringify(preflight)}`)
    }
    const members = preflight.presentMembers.map((member) => member.agentId)
    const defaultLead = preflight.initialLeadAgentId
    const navigationBefore = await core.request('navigation.snapshot')
    const projectBefore = navigationBefore.projects.find((candidate) => candidate.projectPath === workspace.projectPath)
    const trialCamps = []
    if (legacyTrialCamps) {
      for (const trial of trialReviews) {
        trialCamps.push(await createEvidenceCamp({
          core,
          commandPrefix: `${review.id}:${trial.id}`,
          name: trial.title,
          body: trial.body,
          projectPath: workspace.projectPath,
          members,
          defaultLead
        }))
      }
    }
    const reviewCamp = await createEvidenceCamp({
      core,
      commandPrefix: `${review.id}:review`,
      name: review.title,
      body: review.body,
      projectPath: workspace.projectPath,
      members,
      defaultLead
    })
    const navigation = await core.request('navigation.snapshot')
    const project = navigation.projects.find((candidate) => candidate.projectPath === workspace.projectPath)
    const expectedIncrease = trialCamps.length + 1
    if (!project || project.name !== basename(projectPath)
        || project.totalCount < (projectBefore?.totalCount ?? 0) + expectedIncrease) {
      throw new Error('benchmark Project was not visible in navigation after import')
    }
    return {
      projectName: project.name,
      projectPath: project.projectPath,
      projectionMode: legacyTrialCamps ? 'legacy_trial_camps' : 'single_review_camp',
      resultCampCount: trialCamps.length,
      reviewCampId: reviewCamp.campId,
      navigationCampCount: project.totalCount,
      createdAgentRuns: 0,
      createdCampTurns: 0
    }
  } finally {
    await core.stop()
  }
}

export async function createEvidenceCamp({ core, commandPrefix, name, body, projectPath, members, defaultLead }) {
  const created = await core.request('camps.create', {
    commandId: `${commandPrefix}:create`,
    name,
    workspace: { projectPath },
    memberAgentIds: members,
    defaultLeadAgentId: defaultLead,
    collaborationMode: 'peer'
  })
  const campId = created.payload?.campId
  if (created.status === 'rejected' || !campId) {
    throw new Error(`benchmark Camp creation failed: ${JSON.stringify(created)}`)
  }
  const sent = await dispatchQualificationPrompt(core.request, {
    commandId: `${commandPrefix}:message`,
    campId,
    prompt: body,
    execution: null
  })
  if (sent.commandResult?.status === 'rejected') {
    throw new Error(`benchmark evidence message failed: ${JSON.stringify(sent)}`)
  }
  const snapshot = await core.request('camps.snapshot', { campId })
  if (snapshot.messages.length !== 1 || snapshot.turns.length !== 0 || snapshot.agentRuns.length !== 0) {
    throw new Error(`benchmark evidence Camp unexpectedly created execution: ${campId}`)
  }
  return { campId, title: snapshot.camp.title }
}

function startCore(executable, dataDirectory) {
  const child = spawn(executable, [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: repositoryRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let nextId = 1
  let stderrTail = ''
  let stopping = false
  let closeResult = null
  const closePromise = new Promise((resolveClose) => child.once('close', (code, signal) => {
    closeResult = { code, signal }
    resolveClose(closeResult)
    if (!stopping) rejectPending(new Error(`rovai-core exited early: ${stderrTail}`))
  }))
  child.stderr.on('data', (chunk) => { stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-16_384) })
  child.once('error', rejectPending)
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectPending(error)
      return
    }
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
    else request.resolve(message.result)
  })

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  return {
    request(method, params = {}, timeoutMs = 60_000) {
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`timed out waiting for ${method}`))
        }, timeoutMs)
        pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      stopping = true
      if (child.exitCode === null) child.stdin.end()
      await Promise.race([closePromise, delay(5_000)])
      if (child.exitCode === null) child.kill('SIGTERM')
      await Promise.race([closePromise, delay(5_000)])
      if (child.exitCode === null) child.kill('SIGKILL')
      await closePromise
      rejectPending(new Error('rovai-core stopped'))
      if (closeResult?.code !== 0) throw new Error(`rovai-core import shutdown failed: ${stderrTail}`)
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
