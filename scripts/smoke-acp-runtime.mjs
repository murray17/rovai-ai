import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-acp-runtime-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# ACP Runtime fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Lumen ACP Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'acp-runtime@lumen.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'lumen-core'), ['--data-dir', dataDir], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  core.stderr.pipe(process.stderr)
  const pending = new Map()
  const events = []
  let nextId = 1
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  core.once('error', rejectPending)
  core.once('close', (code, signal) => {
    if (!shuttingDown) rejectPending(new Error(`lumen-core exited early (code=${code}, signal=${signal})`))
  })
  const lines = createInterface({ input: core.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
      return
    }
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
    core.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const health = await request('health.check', { refreshRuntimeProbe: true })
  const project = await request('projects.open', { path: projectRoot })
  const camps = await request('camps.list')
  const camp = camps.find((candidate) => candidate.projectPath === project.rootPath)
  if (!camp?.defaultLeadAgentId) throw new Error('Project Camp has no Default Lead')

  const specifications = [
    {
      adapterKind: 'opencode-cli',
      permissionValues: { permission: process.env.LUMEN_OPENCODE_PERMISSION ?? 'ask' },
      token: 'LUMEN_OPENCODE_ACP_OK'
    },
    {
      adapterKind: 'copilot-cli',
      permissionValues: { allow_all: process.env.LUMEN_COPILOT_ALLOW_ALL ?? 'off' },
      token: 'LUMEN_COPILOT_ACP_OK'
    }
  ].filter((specification) => !process.env.LUMEN_ACP_SMOKE_ADAPTER || specification.adapterKind === process.env.LUMEN_ACP_SMOKE_ADAPTER)
  const results = []
  for (const specification of specifications) {
    const candidate = health.runtimeCandidates.find((value) => value.runtimeKind === specification.adapterKind)
    if (candidate?.status !== 'ready' || !candidate.executablePath) {
      throw new Error(`${specification.adapterKind} health gate failed: ${JSON.stringify(candidate)}`)
    }
    let installations = await request('runtime.installations.list')
    let installation = installations.find((value) =>
      value.adapterKind === specification.adapterKind
        && value.executablePath === candidate.executablePath
    )
    if (!installation) {
      const created = await request('runtime.installations.create', {
        commandId: crypto.randomUUID(),
        command: {
          adapterKind: specification.adapterKind,
          executablePath: candidate.executablePath,
          source: 'discovered',
          authScope: 'local-user'
        }
      })
      if (created.status !== 'applied') throw new Error(`Installation create failed: ${JSON.stringify(created)}`)
      installation = { id: created.resultEntity.entityId }
    }
    const refreshed = await request('runtime.installations.refresh', {
      commandId: crypto.randomUUID(),
      installationId: installation.id
    })
    if (refreshed.status !== 'applied') throw new Error(`Installation refresh failed: ${JSON.stringify(refreshed)}`)
    installations = await request('runtime.installations.list')
    installation = installations.find((value) => value.id === installation.id)
    if (installation?.snapshot?.probeStatus !== 'ready' || !installation.snapshot.models.length) {
      throw new Error(`Capability snapshot is not ready: ${JSON.stringify(installation)}`)
    }

    const profile = await request('agents.get', { agentProfileId: camp.defaultLeadAgentId })
    const configured = await request('agents.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentProfileId: profile.id,
        expectedVersion: profile.version,
        runtime: {
          installationId: installation.id,
          model: { mode: 'runtime_default' },
          permissions: {
            adapterKind: specification.adapterKind,
            schemaVersion: installation.snapshot.permissionSchemaVersion,
            values: specification.permissionValues
          }
        }
      }
    })
    if (configured.status !== 'applied') throw new Error(`Runtime configuration failed: ${JSON.stringify(configured)}`)
    const preflight = await request('execution.preflight', {
      campId: camp.id,
      address: { mode: 'explicit', agentProfileIds: [profile.id] }
    })
    if (!preflight.admissible || !preflight.workspace) {
      throw new Error(`AgentRun preflight failed: ${JSON.stringify(preflight)}`)
    }
    const sent = await request('camp.messages.send', {
      commandId: crypto.randomUUID(),
      campId: camp.id,
      body: `Do not call tools or inspect files. Reply with exactly ${specification.token} and nothing else.`,
      address: { mode: 'explicit', agentProfileIds: [profile.id] },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: `Verify the ${specification.adapterKind} ACP execution path without tools`,
        expectedOutput: `Exactly ${specification.token}`,
        completionRole: 'required'
      }
    })
    const agentRunId = sent.commandResult?.payload?.agentRunIds?.[0]
    if (sent.commandResult?.status !== 'accepted' || !agentRunId) {
      throw new Error(`AgentRun intake failed: ${JSON.stringify(sent)}`)
    }
    const deadline = Date.now() + 180_000
    let snapshot
    let agentRun
    while (Date.now() < deadline) {
      snapshot = await request('camps.snapshot', { campId: camp.id })
      agentRun = snapshot.agentRuns.find((value) => value.id === agentRunId)
      if (agentRun?.status === 'succeeded') break
      if (agentRun?.status === 'failed' || agentRun?.status === 'cancelled') {
        throw new Error(`${specification.adapterKind} AgentRun entered ${agentRun.status}: ${JSON.stringify(agentRun)}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    const output = snapshot?.messages.find((message) => message.sourceAgentRunId === agentRunId)
    const start = events.find((event) => event.method === 'agent_run.started' && event.params?.agentRunId === agentRunId)
    if (agentRun?.status !== 'succeeded' || !output?.body.includes(specification.token)) {
      throw new Error(`${specification.adapterKind} output failed: ${JSON.stringify({ agentRun, output })}`)
    }
    if (start?.params?.adapterKind !== specification.adapterKind || !start.params.nativeThreadId) {
      throw new Error(`${specification.adapterKind} did not expose its Native Session: ${JSON.stringify(start)}`)
    }
    results.push({
      adapterKind: specification.adapterKind,
      version: installation.snapshot.reportedVersion,
      modelCount: installation.snapshot.models.length,
      model: start.params.modelId,
      nativeSessionId: start.params.nativeThreadId,
      output: output.body
    })

    if (['opencode-cli', 'copilot-cli'].includes(specification.adapterKind)) {
      const writeToken = 'LUMEN_ACP_APPROVED_WRITE'
      const adapterFileStem = specification.adapterKind === 'opencode-cli' ? 'OPENCODE' : 'COPILOT'
      const writePath = join(projectRoot, `ACP_APPROVED_${adapterFileStem}.txt`)
      const writeRequest = await request('camp.messages.send', {
        commandId: crypto.randomUUID(),
        campId: camp.id,
        body: `Use the file editing tool to create ${writePath} with exactly ${writeToken} and a trailing newline. After the edit succeeds, reply exactly ACP_WRITE_OK.`,
        address: { mode: 'explicit', agentProfileIds: [profile.id] },
        replyToCampMessageId: null,
        execution: {
          taskId: null,
          purpose: 'Verify ACP permission mediation and one-time file write authorization',
          expectedOutput: 'Create the approved file and reply ACP_WRITE_OK',
          completionRole: 'required'
        }
      })
      const writeRunId = writeRequest.commandResult?.payload?.agentRunIds?.[0]
      if (!writeRunId) throw new Error(`ACP write AgentRun was not accepted: ${JSON.stringify(writeRequest)}`)
      const resolvedApprovals = new Set()
      const writeDeadline = Date.now() + 180_000
      let writeSnapshot
      let writeRun
      while (Date.now() < writeDeadline) {
        writeSnapshot = await request('camps.snapshot', { campId: camp.id })
        for (const approval of writeSnapshot.approvals.filter((candidate) =>
          candidate.status === 'pending'
            && !resolvedApprovals.has(candidate.id)
            && writeSnapshot.actions.some((action) => action.id === candidate.actionId && action.agentRunId === writeRunId)
        )) {
          const resolution = await request('action.approvals.resolve', {
            commandId: crypto.randomUUID(),
            campId: camp.id,
            approvalId: approval.id,
            expectedVersion: approval.version,
            decision: 'approve',
            reason: 'ACP one-time file write smoke test'
          })
          if (resolution.status === 'rejected') throw new Error(`ACP approval was rejected: ${JSON.stringify(resolution)}`)
          resolvedApprovals.add(approval.id)
        }
        writeRun = writeSnapshot.agentRuns.find((value) => value.id === writeRunId)
        const actions = writeSnapshot.actions.filter((action) => action.agentRunId === writeRunId)
        if (actions.some((action) => ['not_executed', 'unknown'].includes(action.status))) {
          throw new Error(`ACP write Action failed: ${JSON.stringify(actions)}`)
        }
        if (writeRun?.status === 'succeeded') break
        if (writeRun?.status === 'failed' || writeRun?.status === 'cancelled') {
          throw new Error(`ACP write AgentRun entered ${writeRun.status}: ${JSON.stringify({
            writeRun,
            actions,
            approvals: writeSnapshot.approvals.filter((approval) => actions.some((action) => action.id === approval.actionId)),
            events: events.filter((event) => event.params?.agentRunId === writeRunId).slice(-20)
          })}`)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
      const writeActions = writeSnapshot?.actions.filter((action) => action.agentRunId === writeRunId) ?? []
      const writeStart = events.find((event) =>
        event.method === 'agent_run.started' && event.params?.agentRunId === writeRunId
      )
      const written = await readFile(writePath, 'utf8').catch((error) => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      if (writeRun?.status !== 'succeeded'
          || written !== `${writeToken}\n`
          || !writeActions.some((action) => action.status === 'succeeded')
          || writeStart?.params?.nativeThreadId !== results.at(-1).nativeSessionId) {
        throw new Error(`ACP approved write did not converge: ${JSON.stringify({
          writeRun,
          writeActions,
          writeStart,
          written,
          events: events.filter((event) => event.params?.agentRunId === writeRunId).slice(-30)
        })}`)
      }
      results.at(-1).approval = {
        resolved: resolvedApprovals.size,
        actionKinds: writeActions.map((action) => action.actionKind),
        nativeSessionContinued: true,
        written
      }

      const approvalExpected = specification.permissionValues.permission === 'ask'
        || specification.permissionValues.allow_all === 'off'
      if (approvalExpected) {
        const deniedPath = join(projectRoot, `ACP_DENIED_${adapterFileStem}.txt`)
        const deniedRequest = await request('camp.messages.send', {
        commandId: crypto.randomUUID(),
        campId: camp.id,
        body: `Use the file editing tool to create ${deniedPath} with exactly DENIED_WRITE and a trailing newline. After the edit succeeds, reply exactly ACP_DENIED_WRITE_OK.`,
        address: { mode: 'explicit', agentProfileIds: [profile.id] },
        replyToCampMessageId: null,
        execution: {
          taskId: null,
          purpose: 'Create the requested file and report the concrete result',
          expectedOutput: 'Create the requested file and reply ACP_DENIED_WRITE_OK',
          completionRole: 'required'
        }
      })
        const deniedRunId = deniedRequest.commandResult?.payload?.agentRunIds?.[0]
        if (!deniedRunId) throw new Error(`ACP denied AgentRun was not accepted: ${JSON.stringify(deniedRequest)}`)
        const deniedApprovals = new Set()
        const deniedDeadline = Date.now() + 180_000
        let deniedSnapshot
        let deniedRun
        while (Date.now() < deniedDeadline) {
          deniedSnapshot = await request('camps.snapshot', { campId: camp.id })
          for (const approval of deniedSnapshot.approvals.filter((candidate) =>
            candidate.status === 'pending'
              && !deniedApprovals.has(candidate.id)
              && deniedSnapshot.actions.some((action) => action.id === candidate.actionId && action.agentRunId === deniedRunId)
          )) {
            const resolution = await request('action.approvals.resolve', {
              commandId: crypto.randomUUID(),
              campId: camp.id,
              approvalId: approval.id,
              expectedVersion: approval.version,
              decision: 'deny',
              reason: 'ACP denial smoke test'
            })
            if (resolution.status === 'rejected') throw new Error(`ACP denial was rejected: ${JSON.stringify(resolution)}`)
            deniedApprovals.add(approval.id)
          }
          deniedRun = deniedSnapshot.agentRuns.find((value) => value.id === deniedRunId)
          if (['succeeded', 'failed', 'cancelled'].includes(deniedRun?.status)) break
          await new Promise((resolveWait) => setTimeout(resolveWait, 250))
        }
        const deniedActions = deniedSnapshot?.actions.filter((action) => action.agentRunId === deniedRunId) ?? []
        const deniedFileExists = await readFile(deniedPath, 'utf8').then(() => true, (error) => {
          if (error?.code === 'ENOENT') return false
          throw error
        })
        if (!deniedRun
            || !['succeeded', 'failed'].includes(deniedRun.status)
            || deniedApprovals.size === 0
            || deniedFileExists
            || !deniedActions.some((action) => action.status === 'not_executed')) {
          throw new Error(`ACP denial did not fail closed: ${JSON.stringify({ deniedRun, deniedActions, deniedApprovals: deniedApprovals.size, deniedFileExists })}`)
        }
        results.at(-1).denial = {
          resolved: deniedApprovals.size,
          actionStatuses: deniedActions.map((action) => action.status),
          fileCreated: deniedFileExists
        }
      }
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2))
} finally {
  if (core && !core.killed) {
    shuttingDown = true
    core.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => core.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
    ])
    if (core.exitCode === null) core.kill('SIGTERM')
  }
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
