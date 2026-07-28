import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const dataDir = await mkdtemp(join(tmpdir(), 'rovai-member-config-smoke-'))
let first
let reopened

try {
  first = startCore(dataDir)
  const agents = await first.request('agents.list')
  if (agents.length !== 4) throw new Error(`Expected four Starter members: ${JSON.stringify(agents)}`)
  if (agents.some((agent) => agent.runtimeReadiness?.status !== 'runtime_not_configured')) {
    throw new Error(`Starter member unexpectedly has Runtime config: ${JSON.stringify(agents)}`)
  }

  const camps = await first.request('camps.list')
  if (camps.length !== 0) throw new Error(`Fresh member storage created an empty Camp: ${JSON.stringify(camps)}`)
  const leadMemberships = await first.request('agents.memberships.list', {
    agentProfileId: 'agent-luoke'
  })
  if (leadMemberships.length !== 0) {
    throw new Error(`Fresh member unexpectedly belongs to a Camp: ${JSON.stringify(leadMemberships)}`)
  }
  const preflight = await first.request('camps.creationPreflight')
  if (preflight.admissible
      || preflight.blockers[0]?.code !== 'no_runtime_configured_members') {
    throw new Error(`Unconfigured member was not blocked: ${JSON.stringify(preflight)}`)
  }

  const createCommandId = crypto.randomUUID()
  const createResult = await first.request('agents.create', {
    commandId: createCommandId,
    command: {
      displayName: 'Smoke Builder',
      avatarRef: null,
      personaLabel: null,
      accent: null,
      roleTitle: 'Developer',
      roleDescription: 'Validates v0.03 member persistence.',
      instructions: 'Do not execute during this smoke.',
      defaultCapabilities: ['workspace.bind']
    }
  })
  const replay = await first.request('agents.create', {
    commandId: createCommandId,
    command: {
      displayName: 'Smoke Builder',
      avatarRef: null,
      personaLabel: null,
      accent: null,
      roleTitle: 'Developer',
      roleDescription: 'Validates v0.03 member persistence.',
      instructions: 'Do not execute during this smoke.',
      defaultCapabilities: ['workspace.bind']
    }
  })
  if (createResult.code !== 'agent_profile.created'
      || replay.commandId !== createResult.commandId
      || replay.resultEntity?.entityId !== createResult.resultEntity?.entityId) {
    throw new Error(`AgentProfile command did not replay: ${JSON.stringify({ createResult, replay })}`)
  }
  const agentProfileId = createResult.resultEntity.entityId

  const installationResult = await first.request('runtime.installations.create', {
    commandId: crypto.randomUUID(),
    command: {
      adapterKind: 'codex-cli',
      executablePath: '/usr/bin/true',
      source: 'custom',
      authScope: 'smoke'
    }
  })
  if (installationResult.code !== 'adapter_installation.created') {
    throw new Error(`Installation was not created: ${JSON.stringify(installationResult)}`)
  }
  const installationId = installationResult.resultEntity.entityId
  const profile = await first.request('agents.get', { agentProfileId })
  const rejectedRuntime = await first.request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId,
      expectedVersion: profile.version,
      runtime: {
        installationId,
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'codex-cli',
          schemaVersion: 1,
          values: {
            sandbox_mode: 'workspace-write',
            approval_policy: 'on-request'
          }
        }
      }
    }
  })
  if (rejectedRuntime.status !== 'rejected'
      || rejectedRuntime.code !== 'agent_profile.runtime_probe_required') {
    throw new Error(`Unprobed Runtime config was not rejected: ${JSON.stringify(rejectedRuntime)}`)
  }
  await first.stop()
  first = null

  reopened = startCore(dataDir)
  const persistedProfile = await reopened.request('agents.get', { agentProfileId })
  const installations = await reopened.request('runtime.installations.list')
  if (!/^[1-9A-HJ-NP-Za-km-z]{12}$/.test(persistedProfile.handle)
      || persistedProfile.runtimePreference !== null
      || installations[0]?.id !== installationId
      || installations[0]?.referencedProfileCount !== 0) {
    throw new Error(`Member configuration did not survive restart: ${JSON.stringify({
      persistedProfile,
      installations
    })}`)
  }
  await reopened.stop()
  reopened = null

  console.log(JSON.stringify({
    ok: true,
    starterCount: agents.length,
    customAgentProfileId: agentProfileId,
    installationId,
    unconfiguredBlocker: preflight.blockers[0].code,
    invalidRuntimeResult: rejectedRuntime.code,
    noEmptyCampOnStartup: true,
    restartPersistence: true
  }, null, 2))
} finally {
  await first?.stop()
  await reopened?.stop()
  await rm(dataDir, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
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
  child.once('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  })
  return {
    request(method, params = {}) {
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`Timed out waiting for ${method}`))
        }, 30_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.stdin.end()
      await Promise.race([
        new Promise((resolveClose) => child.once('close', resolveClose)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
      ])
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
}
