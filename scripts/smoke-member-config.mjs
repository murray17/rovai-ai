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
    agentProfileId: 'agent_1'
  })
  if (leadMemberships.length !== 0) {
    throw new Error(`Fresh member unexpectedly belongs to a Camp: ${JSON.stringify(leadMemberships)}`)
  }
  const preflight = await first.request('camps.creationPreflight')
  if (!preflight.admissible
      || !preflight.initialLeadAgentProfileId
      || preflight.presentMembers.length !== agents.length
      || preflight.presentMembers.some((member) => member.runtimeConfigured)) {
    throw new Error(`Unconfigured members failed structural preflight: ${JSON.stringify(preflight)}`)
  }

  const createCommandId = crypto.randomUUID()
  const createResult = await first.request('agents.create', {
    commandId: createCommandId,
    command: {
      displayName: 'Smoke Builder',
      teamRole: 'Developer',
      professionalResponsibilities: 'Validates v0.27 member identity persistence.',
      personalityTraits: ['Careful', 'careful'],
      workingPrinciples: 'Do not execute during this smoke.',
      growthTopic: ''
    }
  })
  const replay = await first.request('agents.create', {
    commandId: createCommandId,
    command: {
      displayName: 'Smoke Builder',
      teamRole: 'Developer',
      professionalResponsibilities: 'Validates v0.27 member identity persistence.',
      personalityTraits: ['Careful', 'careful'],
      workingPrinciples: 'Do not execute during this smoke.',
      growthTopic: ''
    }
  })
  if (createResult.code !== 'agent_profile.created'
      || replay.commandId !== createResult.commandId
      || replay.resultEntity?.entityId !== createResult.resultEntity?.entityId) {
    throw new Error(`AgentProfile command did not replay: ${JSON.stringify({ createResult, replay })}`)
  }
  const agentProfileId = createResult.resultEntity.entityId

  const profile = await first.request('agents.get', { agentProfileId })
  const selectedRuntime = await first.request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId,
      expectedVersion: profile.version,
      adapterKind: 'qoder-cli'
    }
  })
  if (selectedRuntime.status !== 'applied'
      || selectedRuntime.code !== 'agent_profile.product_runtime_selected') {
    throw new Error(`Product Runtime selection was not saved: ${JSON.stringify(selectedRuntime)}`)
  }
  const unresolvedProfile = await first.request('agents.get', { agentProfileId })
  const unresolvedInstallations = await first.request('runtime.installations.list')
  if (unresolvedProfile.runtimeSelection?.adapterKind !== 'qoder-cli'
      || unresolvedProfile.runtimeReadiness?.status !== 'selected_unresolved'
      || unresolvedProfile.runtimePreference !== null
      || unresolvedInstallations.some((installation) => installation.adapterKind === 'qoder-cli')) {
    throw new Error(`Missing Product Runtime did not remain unresolved without fallback: ${JSON.stringify({
      unresolvedProfile,
      unresolvedInstallations
    })}`)
  }
  await first.stop()
  first = null

  reopened = startCore(dataDir)
  const persistedProfile = await reopened.request('agents.get', { agentProfileId })
  const installations = await reopened.request('runtime.installations.list')
  if (!/^[1-9A-HJ-NP-Za-km-z]{12}$/.test(persistedProfile.handle)
      || persistedProfile.teamRole !== 'Developer'
      || persistedProfile.professionalResponsibilities !== 'Validates v0.27 member identity persistence.'
      || persistedProfile.personalityTraits?.join(',') !== 'Careful'
      || persistedProfile.workingPrinciples !== 'Do not execute during this smoke.'
      || persistedProfile.runtimeSelection?.adapterKind !== 'qoder-cli'
      || persistedProfile.runtimeReadiness?.status !== 'selected_unresolved'
      || persistedProfile.runtimePreference !== null
      || installations.some((installation) => installation.adapterKind === 'qoder-cli')) {
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
    selectedRuntimeKind: persistedProfile.runtimeSelection.adapterKind,
    selectedRuntimeReadiness: persistedProfile.runtimeReadiness.status,
    unconfiguredMemberCount: preflight.presentMembers
      .filter((member) => !member.runtimeConfigured).length,
    noRuntimeFallback: true,
    noEmptyCampOnStartup: true,
    restartPersistence: true
  }, null, 2))
} finally {
  await first?.stop()
  await reopened?.stop()
  await rm(dataDir, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const childEnvironment = {
    ...process.env,
    HOME: dataDirectory,
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/sh',
    PNPM_HOME: ''
  }
  for (const key of [
    'ROVAI_CODEX_BIN',
    'ROVAI_OPENCODE_BIN',
    'ROVAI_COPILOT_BIN',
    'ROVAI_CLAUDE_CODE_BIN',
    'ROVAI_KIRO_BIN',
    'ROVAI_QODER_BIN',
    'ROVAI_CODEBUDDY_BIN',
    'ROVAI_QWEN_BIN',
    'ROVAI_ANTIGRAVITY_BIN'
  ]) {
    delete childEnvironment[key]
  }
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnvironment
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
