import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const cli = parseArguments(process.argv.slice(2))
const executable = process.env.ROVAI_P1_COPILOT_PATH ?? '/opt/homebrew/bin/copilot'
const experimentRoot = await mkdtemp(join(tmpdir(), 'rovai-copilot-turn-reconciliation-'))
const outputRoot = cli.output
  ? resolve(cli.output)
  : join(root, 'docs', 'versions', 'v0.64', 'evidence', `copilot-native-turn-reconciliation-${timestampStem()}`)
const startedAt = new Date().toISOString()

async function main() {
  let completed = false
  try {
    await assertOutputDoesNotExist(outputRoot)
    await mkdir(outputRoot, { recursive: true })

    const runtime = await captureRuntime(executable)
    const preflight = await runPreflight(runtime)
    await writeJson(join(outputRoot, 'preflight.json'), preflight.publicArtifact)
    await writeJsonl(
      join(outputRoot, 'preflight-ledger.jsonl'),
      sanitizeLedger(preflight.ledger, preflight.secrets)
    )

    if (cli.preflightOnly) {
      const manifest = await writeManifest({
        runtime,
        model: preflight.model,
        cases: [],
        status: 'preflight_passed'
      })
      completed = true
      process.stdout.write(`${JSON.stringify({
        status: manifest.status,
        outputRoot,
        runtime: manifest.runtime,
        model: manifest.model,
        checks: preflight.publicArtifact.checks
      }, null, 2)}\n`)
    } else {
      const cases = cli.cases.length > 0
        ? cli.cases
        : ['control', 'in_flight_kill', 'terminal_before_persist_kill']
      const artifacts = []
      for (const caseName of cases) {
        for (let repetition = 1; repetition <= cli.repetitions; repetition += 1) {
          process.stdout.write(`[P1] ${caseName} repetition ${repetition}/${cli.repetitions}\n`)
          let result = null
          const excludedAttempts = []
          for (let sampleAttempt = 1; sampleAttempt <= 3; sampleAttempt += 1) {
            try {
              result = await runCase({
                runtime,
                model: preflight.model,
                caseName,
                repetition,
                sampleAttempt
              })
              break
            } catch (error) {
              if (!error.retryableWithoutSideEffect || sampleAttempt === 3) throw error
              excludedAttempts.push({
                sampleAttempt,
                reason: error.retryReason,
                evidenceFile: error.evidenceFile,
                workspaceNonceCount: 0
              })
              process.stdout.write(`[P1] excluded zero-side-effect attempt ${sampleAttempt}; retrying with a new Session\n`)
              await delay(3_000)
            }
          }
          assert.ok(result, `${caseName}/${repetition} did not produce a valid sample`)
          result.artifact.excludedAttempts = excludedAttempts
          const stem = `${caseName}-${repetition}`
          await writeJson(join(outputRoot, `${stem}.json`), result.artifact)
          await writeJsonl(join(outputRoot, `${stem}-ledger.jsonl`), result.ledger)
          artifacts.push(result.artifact)
        }
      }
      const status = evaluateMatrix(artifacts, cases, cli.repetitions)
      const manifest = await writeManifest({
        runtime,
        model: preflight.model,
        cases: artifacts,
        status
      })
      completed = true
      process.stdout.write(`${JSON.stringify({
        status: manifest.status,
        outputRoot,
        runtime: manifest.runtime,
        model: manifest.model,
        caseSummary: manifest.caseSummary
      }, null, 2)}\n`)
    }
  } finally {
    if (completed || !cli.keepTemporary) {
      await rm(experimentRoot, { recursive: true, force: true })
    } else {
      process.stderr.write(`[P1] retained temporary root after failure: ${experimentRoot}\n`)
    }
  }
}

function parseArguments(arguments_) {
  const parsed = {
    cases: [],
    keepTemporary: false,
    output: null,
    preflightOnly: false,
    repetitions: 2
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--preflight-only') {
      parsed.preflightOnly = true
    } else if (argument === '--keep-temporary') {
      parsed.keepTemporary = true
    } else if (argument === '--output') {
      parsed.output = arguments_[++index]
      if (!parsed.output) throw new Error('--output requires a path')
    } else if (argument === '--case') {
      const caseName = arguments_[++index]
      if (!['control', 'in_flight_kill', 'terminal_before_persist_kill'].includes(caseName)) {
        throw new Error(`Unsupported --case: ${caseName}`)
      }
      parsed.cases.push(caseName)
    } else if (argument === '--repetitions') {
      parsed.repetitions = Number(arguments_[++index])
      if (!Number.isInteger(parsed.repetitions) || parsed.repetitions < 1) {
        throw new Error('--repetitions must be a positive integer')
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return parsed
}

async function runPreflight(runtime) {
  const fixture = await createFixture('preflight')
  const ledger = []
  const host = new AcpHost({
    executable: runtime.resolvedExecutable,
    fixture,
    label: 'preflight-host',
    role: 'hostA',
    ledger
  })
  let session
  try {
    const initialize = await host.initialize()
    assert.equal(initialize.protocolVersion, 1, 'Copilot did not negotiate ACP v1')
    session = await host.request('session/new', sessionParameters(fixture.workspace))
    assert.ok(session?.sessionId, 'session/new did not return a sessionId')
  } finally {
    await host.stop('SIGTERM')
  }

  const killProbe = new AcpHost({
    executable: runtime.resolvedExecutable,
    fixture,
    label: 'preflight-kill-probe',
    role: 'hostA',
    ledger
  })
  await killProbe.initialize()
  await killProbe.stop('SIGKILL')
  assert.equal(killProbe.exit?.signal, 'SIGKILL', 'Host process-group kill hook did not observe SIGKILL')

  assert.throws(
    () => assertOutboundAllowed('hostB', 'session/prompt'),
    /Host B outbound allowlist rejected session\/prompt/
  )

  const synthetic = [{
    at: new Date().toISOString(),
    host: 'synthetic',
    direction: 'agent_to_client',
    message: {
      params: {
        sessionId: session.sessionId,
        path: join(fixture.workspace, 'p1-nonce.txt'),
        authorization: 'Bearer must-not-survive'
      }
    }
  }]
  const syntheticSanitized = JSON.stringify(sanitizeLedger(synthetic, {
    paths: [experimentRoot, fixture.workspace],
    sessionIds: [session.sessionId]
  }))
  assert.ok(!syntheticSanitized.includes(session.sessionId), 'sanitizer retained the Native Session ID')
  assert.ok(!syntheticSanitized.includes(experimentRoot), 'sanitizer retained the temporary root')
  assert.ok(!syntheticSanitized.includes('must-not-survive'), 'sanitizer retained an authorization value')

  const model = chooseModel(session)
  assert.ok(model, 'Copilot Session did not expose a fixed model candidate')
  const modelOptions = readModelOptions(session)
  const publicArtifact = {
    schemaVersion: 1,
    status: 'passed',
    capturedAt: new Date().toISOString(),
    isolatedPaths: true,
    runtime,
    model,
    availableModels: modelOptions,
    checks: {
      acpV1Negotiated: true,
      hostBPromptRejectedLocally: true,
      processGroupSigkillObserved: true,
      rawLedgerSanitizerPassed: true,
      syntheticCountersPassed: runSyntheticCounterChecks(),
      noPromptSent: countOutbound(ledger, 'session/prompt') === 0
    },
    requestCounts: countOutboundMethods(ledger),
    sessionIdDigest: digestText(session.sessionId)
  }
  assert.equal(publicArtifact.checks.noPromptSent, true, 'preflight sent a prompt')
  return {
    ledger,
    model,
    publicArtifact,
    secrets: {
      paths: [experimentRoot, fixture.workspace, fixture.data],
      sessionIds: [session.sessionId]
    }
  }
}

async function runCase({ runtime, model, caseName, repetition, sampleAttempt }) {
  const caseId = `${caseName}-${repetition}-attempt-${sampleAttempt}-${randomUUID()}`
  const fixture = await createFixture(caseId)
  const token = `ROVAI_P1_${caseName.toUpperCase()}_${repetition}_${randomUUID().replaceAll('-', '')}`
  const noncePath = join(fixture.workspace, 'p1-nonce.txt')
  const sleepSeconds = caseName === 'in_flight_kill' ? 30 : 1
  const expectedCommand = `printf '%s\\n' '${token}' >> p1-nonce.txt && sleep ${sleepSeconds}`
  const allLedger = []
  const beforeHash = await digestFile(noncePath)
  const setupAttempts = []
  const sessionIds = []
  let hostA = null
  let hostAStartedAt = null
  let sessionId
  let promptOutcome
  let trackedPrompt = null
  let livePromptOutcome = null
  let killedAt = null
  let stopSignal = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const candidate = new AcpHost({
      executable: runtime.resolvedExecutable,
      fixture,
      label: `${caseId}-host-a-setup-${attempt}`,
      model,
      permission: { expectedCommand, token },
      role: 'hostA',
      ledger: allLedger
    })
    const startedAt = new Date().toISOString()
    let candidateSessionId = null
    let setupError = null
    let sessionModel = null
    let configuredModel = null
    try {
      await candidate.initialize()
      const session = await candidate.request('session/new', sessionParameters(fixture.workspace))
      candidateSessionId = session?.sessionId ?? null
      assert.ok(candidateSessionId, 'Host A session/new did not return a sessionId')
      sessionIds.push(candidateSessionId)
      sessionModel = readCurrentModel(session)
      const configured = await candidate.request('session/set_config_option', {
        sessionId: candidateSessionId,
        configId: 'model',
        type: 'select',
        value: model
      })
      configuredModel = readCurrentModel(configured)
      if (sessionModel === model && configuredModel === model) {
        hostA = candidate
        hostAStartedAt = startedAt
        sessionId = candidateSessionId
      } else {
        setupError = `fixed model was not confirmed (session=${sessionModel ?? 'missing'}, configured=${configuredModel ?? 'missing'})`
      }
    } catch (error) {
      setupError = error.message
    }
    setupAttempts.push({
      attempt,
      instanceId: candidate.instanceId,
      sessionIdDigest: candidateSessionId ? digestText(candidateSessionId) : null,
      sessionModel,
      configuredModel,
      error: setupError
    })
    if (hostA) break
    await candidate.stop('SIGTERM')
    if (attempt < 3) await delay(3_000)
  }

  if (!hostA || !sessionId) {
    const secrets = {
      paths: [experimentRoot, fixture.workspace, fixture.data],
      sessionIds
    }
    const failureStem = `${caseName}-${repetition}-attempt-${sampleAttempt}-host-a-setup-failure`
    await writeJsonl(join(outputRoot, `${failureStem}-ledger.jsonl`), sanitizeLedger(allLedger, secrets))
    await writeJson(join(outputRoot, `${failureStem}.json`), sanitizeValue({ setupAttempts }, secrets))
    throw new Error(`Host A fixed-model setup failed; see ${join(outputRoot, `${failureStem}.json`)}`)
  }

  try {
    const promptText = [
      'This is an isolated Native Turn recovery experiment.',
      'Do not read, list, inspect, search, browse, or access the network.',
      'Call the bash tool exactly once with exactly this command and no wrapper:',
      expectedCommand,
      `After the command returns, reply with exactly P1_DONE_${token} and nothing else.`,
      'Do not call any other tool.'
    ].join('\n')
    trackedPrompt = hostA
      .request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: promptText }]
      }, 300_000)
      .then(
        (result) => ({ result, status: 'resolved', at: new Date().toISOString() }),
        (error) => ({ error: error.message, status: 'rejected', at: new Date().toISOString() })
      )
      .then((outcome) => {
        livePromptOutcome = outcome
        return outcome
      })

    if (caseName === 'in_flight_kill') {
      await waitUntil(async () => {
        const nonceCount = await countNonce(noncePath, token)
        if (livePromptOutcome && nonceCount === 0) {
          throw new Error(`Host A prompt became terminal before the in-flight nonce was written: ${livePromptOutcome.error ?? JSON.stringify(livePromptOutcome.result)}`)
        }
        return hostA.acceptedObserved && hostA.toolCalls.size === 1 && nonceCount === 1
      }, 180_000, 'Host A accepted evidence + one Tool Call + one nonce')
      assert.equal(hostA.promptResponses.length, 0, 'in-flight kill reached terminal response before kill')
      assert.equal(hostA.agentMessages.some((entry) => {
        const update = entry.message?.params?.update
        return update?.sessionUpdate === 'tool_call_update'
          && ['completed', 'failed'].includes(update.status)
      }), false, 'in-flight kill reached a terminal Tool Call update before kill')
      killedAt = new Date().toISOString()
      stopSignal = 'SIGKILL'
      await hostA.stop(stopSignal)
    } else if (caseName === 'terminal_before_persist_kill') {
      promptOutcome = await trackedPrompt
      assert.equal(promptOutcome.status, 'resolved', `Host A prompt failed: ${promptOutcome.error ?? ''}`)
      killedAt = new Date().toISOString()
      stopSignal = 'SIGKILL'
      await hostA.stop(stopSignal)
    } else {
      promptOutcome = await trackedPrompt
      assert.equal(promptOutcome.status, 'resolved', `Host A prompt failed: ${promptOutcome.error ?? ''}`)
      stopSignal = 'SIGTERM'
      await hostA.stop(stopSignal)
    }
    if (!promptOutcome) promptOutcome = await trackedPrompt
  } catch (error) {
    await hostA.stop('SIGKILL')
    if (trackedPrompt && !promptOutcome) promptOutcome = await trackedPrompt
    const workspaceNonceCount = await countNonce(noncePath, token)
    const secrets = {
      paths: [experimentRoot, fixture.workspace, fixture.data],
      sessionIds
    }
    const failureStem = `${caseName}-${repetition}-attempt-${sampleAttempt}-prompt-failure`
    await writeJsonl(join(outputRoot, `${failureStem}-ledger.jsonl`), sanitizeLedger(allLedger, secrets))
    await writeJson(join(outputRoot, `${failureStem}.json`), sanitizeValue({
      error: error.message,
      approvedCommands: hostA.approvedCommands,
      permissionViolations: hostA.permissionViolations,
      promptOutcome,
      streamedAgentText: hostA.streamedAgentText,
      toolCallIds: [...hostA.toolCalls],
      workspaceNonceCount,
      stderr: hostA.stderrLines,
      setupAttempts
    }, secrets))
    const failure = new Error(`Host A prompt attempt failed; see ${join(outputRoot, `${failureStem}.json`)}`)
    failure.retryableWithoutSideEffect = workspaceNonceCount === 0 && hostA.approvedCommands.length === 0
    failure.retryReason = hostA.permissionViolations.length > 0
      ? 'rejected_command_mismatch_without_side_effect'
      : 'zero_side_effect_prompt_attempt'
    failure.evidenceFile = `${failureStem}.json`
    throw failure
  }

  if (hostA.permissionViolations.length !== 0 || hostA.approvedCommands.length !== 1) {
    const secrets = {
      paths: [experimentRoot, fixture.workspace, fixture.data],
      sessionIds
    }
    const failureStem = `${caseName}-${repetition}-attempt-${sampleAttempt}-host-a-gate-failure`
    await writeJsonl(join(outputRoot, `${failureStem}-ledger.jsonl`), sanitizeLedger(allLedger, secrets))
    await writeJson(join(outputRoot, `${failureStem}.json`), sanitizeValue({
      approvedCommands: hostA.approvedCommands,
      permissionViolations: hostA.permissionViolations,
      promptOutcome,
      streamedAgentText: hostA.streamedAgentText,
      toolCallIds: [...hostA.toolCalls],
      stderr: hostA.stderrLines,
      recentAgentMessages: hostA.agentMessages.slice(-20)
    }, secrets))
    const failure = new Error(`Host A tool gate failed; see ${join(outputRoot, `${failureStem}.json`)}`)
    failure.retryableWithoutSideEffect = await countNonce(noncePath, token) === 0 && hostA.approvedCommands.length === 0
    throw failure
  }

  const hostBAttempts = []
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const hostB = new AcpHost({
      executable: runtime.resolvedExecutable,
      fixture,
      label: `${caseId}-host-b-${attempt}`,
      model,
      role: 'hostB',
      ledger: allLedger
    })
    const started = new Date().toISOString()
    let loadResult
    try {
      await hostB.initialize()
      loadResult = await hostB.request('session/load', {
        sessionId,
        ...sessionParameters(fixture.workspace)
      })
      await hostB.waitForProtocolQuiet(1_000, 6_000)
    } finally {
      await hostB.stop('SIGTERM')
    }
    hostBAttempts.push({
      instanceId: hostB.instanceId,
      startedAt: started,
      exitedAt: hostB.exit?.at ?? null,
      loadResult,
      notifications: hostB.agentMessages.filter((entry) => entry.message?.method).map((entry) => entry.message),
      permissionViolations: hostB.permissionViolations,
      requestCounts: countOutboundMethods(hostB.ledger),
      promptRequestCount: countOutbound(hostB.ledger, 'session/prompt'),
      sessionLoadCount: countOutbound(hostB.ledger, 'session/load'),
      toolCallIds: [...hostB.toolCalls]
    })
  }

  const afterHash = await digestFile(noncePath)
  const nonceCount = await countNonce(noncePath, token)
  const providerTurnIds = findProviderTurnIds(hostBAttempts)
  const replayNotificationCounts = hostBAttempts.map((attempt) => attempt.notifications.filter((message) => message.method === 'session/update').length)
  const providerTurnId = providerTurnIds.length === 1 ? providerTurnIds[0] : null
  const observedState = providerTurnId
    ? findProviderTurnState(hostBAttempts, providerTurnId) ?? 'ambiguous'
    : replayNotificationCounts.some((count) => count > 0) ? 'ambiguous' : 'not_found'
  const terminalResultDigest = findHostBTerminalResultDigest(hostBAttempts, providerTurnId)
  const hostATerminalResultDigest = promptOutcome?.status === 'resolved'
    ? digestJson({ response: promptOutcome.result, streamedText: hostA.streamedAgentText })
    : null
  const hostAUniqueToolCalls = [...hostA.toolCalls]
  const allUniqueToolCalls = [...new Set([
    ...hostAUniqueToolCalls,
    ...hostBAttempts.flatMap((attempt) => attempt.toolCallIds)
  ])]
  const criterionResults = {
    stableProviderTurnId: Boolean(providerTurnId),
    machineReadableTurnState: ['running', 'completed', 'failed', 'not_found'].includes(observedState),
    terminalResultRereadByHostB: Boolean(terminalResultDigest),
    noHostBPrompt: hostBAttempts.every((attempt) => attempt.promptRequestCount === 0),
    noHostBExecutionRequest: hostBAttempts.every((attempt) => attempt.permissionViolations.length === 0),
    idempotentReconcile: providerTurnId !== null && hostBAttempts.length === 2,
    exactlyOneToolCall: allUniqueToolCalls.length === 1,
    exactlyOneWorkspaceSideEffect: nonceCount === 1
  }
  const verdict = Object.values(criterionResults).every(Boolean)
    ? 'capability_proven'
    : 'capability_not_proven'

  const secrets = {
    paths: [experimentRoot, fixture.workspace, fixture.data],
    sessionIds
  }
  const sanitizedLedger = sanitizeLedger(allLedger, secrets)
  const artifact = sanitizeValue({
    schemaVersion: 1,
    case: caseName,
    repetition,
    sampleAttempt,
    caseId,
    capturedAt: new Date().toISOString(),
    providerVersion: runtime.reportedVersion,
    executable: runtime.executable,
    resolvedExecutable: runtime.resolvedExecutable,
    executableDigest: runtime.executableDigest,
    model,
    permissionProfile: {
      availableTools: ['bash'],
      builtinMcpsDisabled: true,
      customInstructionsDisabled: true,
      hostEnvironmentAllowlist: Object.keys(isolatedHostEnvironment()).sort(),
      networkUrlsDenied: true,
      expectedCommandDigest: digestText(expectedCommand),
      approvedCommandCount: hostA.approvedCommands.length,
      unexpectedPermissionRequestCount: hostA.permissionViolations.length
    },
    workspace: {
      beforeHash,
      afterHash,
      nonceCount,
      nonceFile: 'p1-nonce.txt'
    },
    hostA: {
      instanceId: hostA.instanceId,
      setupAttempts,
      startedAt: hostAStartedAt,
      exitedAt: hostA.exit?.at ?? null,
      exitCode: hostA.exit?.code ?? null,
      exitSignal: hostA.exit?.signal ?? null,
      requestedStopSignal: stopSignal,
      killedAt,
      promptRequestCount: countOutbound(hostA.ledger, 'session/prompt'),
      acceptedObserved: hostA.acceptedObserved,
      acceptedAt: hostA.acceptedAt,
      promptTerminalObserved: promptOutcome?.status === 'resolved',
      promptTerminalAt: promptOutcome?.status === 'resolved' ? promptOutcome.at : null,
      promptTerminalError: promptOutcome?.status === 'rejected' ? promptOutcome.error : null,
      terminalResultDigest: hostATerminalResultDigest,
      uniqueToolCallCount: hostAUniqueToolCalls.length
    },
    hostB: {
      attempts: hostBAttempts.map((attempt) => ({
        instanceId: attempt.instanceId,
        startedAt: attempt.startedAt,
        exitedAt: attempt.exitedAt,
        requestCounts: attempt.requestCounts,
        promptRequestCount: attempt.promptRequestCount,
        permissionRequestCount: attempt.permissionViolations.length,
        sessionLoadCount: attempt.sessionLoadCount,
        loadResultDigest: digestJson(attempt.loadResult),
        replayNotificationCount: attempt.notifications.filter((message) => message.method === 'session/update').length
      })),
      promptRequestCount: hostBAttempts.reduce((count, attempt) => count + attempt.promptRequestCount, 0),
      permissionRequestCount: hostBAttempts.reduce((count, attempt) => count + attempt.permissionViolations.length, 0),
      sessionLoadCount: hostBAttempts.reduce((count, attempt) => count + attempt.sessionLoadCount, 0),
      lookupRequestCount: 0
    },
    nativeSessionIdDigest: digestText(sessionId),
    providerTurnId,
    providerTurnIdCandidates: providerTurnIds,
    observedState,
    terminalResultDigest,
    clientPromptRequestCount: countOutbound(hostA.ledger, 'session/prompt'),
    providerModelRequestCount: null,
    providerModelRequestCountReason: 'ACP v1 exposes no Provider model-request identity or counter',
    toolCallCount: allUniqueToolCalls.length,
    workspaceNonceCount: nonceCount,
    replayNotificationCounts,
    criterionResults,
    verdict,
    ledgerDigest: digestJson(sanitizedLedger)
  }, secrets)
  return { artifact, ledger: sanitizedLedger }
}

class AcpHost {
  constructor({ executable, fixture, label, ledger, model = null, permission = null, role }) {
    this.instanceId = randomUUID()
    this.label = label
    this.role = role
    this.ledger = []
    this.sharedLedger = ledger
    this.permission = permission
    this.nextId = 1
    this.pending = new Map()
    this.agentMessages = []
    this.promptResponses = []
    this.toolCalls = new Set()
    this.streamedAgentText = ''
    this.approvedCommands = []
    this.permissionViolations = []
    this.acceptedObserved = false
    this.acceptedAt = null
    this.stderrLines = []
    this.stdoutNonJsonLines = []
    this.lastProtocolAt = Date.now()
    this.exit = null

    const arguments_ = [
      '--acp',
      '--stdio',
      '--no-auto-update',
      '--no-remote',
      '--no-remote-export',
      '--no-color',
      '--log-level', 'error',
      '--log-dir', fixture.logs,
      '--no-custom-instructions',
      '--no-ask-user',
      '--disable-builtin-mcps',
      '--available-tools=bash',
      '--deny-url=*'
    ]
    if (model) arguments_.push('--model', model)
    this.child = spawn(executable, arguments_, {
      cwd: fixture.workspace,
      detached: true,
      // Copilot 1.0.79 exits before ACP initialize when --no-bash-env is used.
      // A positive Host environment allowlist provides the same safety boundary:
      // BASH_ENV, credentials, tokens, proxy URLs, and arbitrary caller state do
      // not reach Copilot or its shell subprocess.
      env: isolatedHostEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.record('host_event', { event: 'spawned', pid: this.child.pid, arguments: arguments_.map(redactArgument) })
    this.exitPromise = new Promise((resolveExit) => {
      this.child.once('close', (code, signal) => {
        this.exit = { at: new Date().toISOString(), code, signal }
        this.record('host_event', { event: 'exited', code, signal })
        const detail = [...this.stderrLines, ...this.stdoutNonJsonLines].slice(-10).join('\n')
        const error = new Error(`${this.label} exited (code=${code}, signal=${signal})${detail ? `: ${detail}` : ''}`)
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(error)
        }
        this.pending.clear()
        resolveExit(this.exit)
      })
    })
    this.child.once('error', (error) => {
      this.record('host_event', { event: 'spawn_error', message: error.message })
    })
    this.child.stdin.on('error', (error) => {
      if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) {
        this.record('host_event', { event: 'stdin_error', message: error.message })
      }
    })
    const stdout = createInterface({ input: this.child.stdout })
    stdout.on('line', (line) => this.handleStdout(line))
    const stderr = createInterface({ input: this.child.stderr })
    stderr.on('line', (line) => {
      this.stderrLines.push(line)
      this.record('agent_stderr', { line })
    })
  }

  record(direction, message) {
    const entry = { at: new Date().toISOString(), host: this.label, direction, message }
    this.ledger.push(entry)
    this.sharedLedger.push(entry)
    this.lastProtocolAt = Date.now()
  }

  async initialize() {
    return this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: {
        name: 'rovai_p1_experiment',
        title: 'Rovai P1 Native Turn Reconciliation Experiment',
        version: '0.0.1'
      }
    })
  }

  request(method, params = {}, timeoutMs = 90_000) {
    assertOutboundAllowed(this.role, method)
    const id = this.nextId++
    const message = { jsonrpc: '2.0', id, method, params }
    this.record('client_to_agent', message)
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectRequest(new Error(`${this.label} timed out waiting for ${method}`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer })
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    })
  }

  handleStdout(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this.stdoutNonJsonLines.push(line)
      this.record('agent_stdout_non_json', { line })
      return
    }
    this.record('agent_to_client', message)
    if (message.method) {
      this.agentMessages.push({ at: new Date().toISOString(), message })
      if (message.id !== undefined) {
        void this.handleAgentRequest(message)
      } else {
        this.handleNotification(message)
      }
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (pending.method === 'session/prompt') this.promptResponses.push(message)
    if (message.error) {
      pending.reject(new Error(`${pending.method}: ${message.error.message ?? JSON.stringify(message.error)}`))
    } else {
      pending.resolve(message.result)
    }
  }

  handleNotification(message) {
    if (message.method !== 'session/update') return
    const update = message.params?.update ?? {}
    const kind = update.sessionUpdate ?? update.type
    if (['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(kind)) {
      this.markAccepted()
    }
    const toolCallId = update.toolCallId ?? update.tool_call_id
    if (toolCallId && ['tool_call', 'tool_call_update'].includes(kind)) {
      this.toolCalls.add(toolCallId)
    }
    if (kind === 'agent_message_chunk') {
      this.streamedAgentText += update.content?.text ?? update.text ?? ''
    }
  }

  async handleAgentRequest(message) {
    if (message.method !== 'session/request_permission') {
      this.permissionViolations.push({ method: message.method, reason: 'unexpected Agent request' })
      this.respondError(message.id, -32601, `Unsupported Agent request: ${message.method}`)
      return
    }
    this.markAccepted()
    const options = message.params?.options ?? []
    const command = findCommand(message.params)
    const expected = this.permission?.expectedCommand
    const allow = this.role === 'hostA' && expected && command === expected && this.approvedCommands.length === 0
    const option = allow
      ? options.find((candidate) => candidate.kind === 'allow_once')
        ?? options.find((candidate) => candidate.kind?.startsWith('allow') && !candidate.kind.includes('always'))
      : options.find((candidate) => candidate.kind === 'reject_once')
        ?? options.find((candidate) => candidate.kind?.startsWith('reject') || candidate.kind?.startsWith('deny'))
    if (!option?.optionId) {
      this.permissionViolations.push({ method: message.method, command, reason: 'no safe response option' })
      this.respondError(message.id, -32603, 'Permission request has no safe one-shot option')
      return
    }
    if (allow) {
      this.approvedCommands.push(command)
    } else {
      this.permissionViolations.push({ method: message.method, command, reason: 'command did not match the one-shot allowlist' })
    }
    this.respondResult(message.id, {
      outcome: { outcome: 'selected', optionId: option.optionId }
    })
  }

  respondResult(id, result) {
    const message = { jsonrpc: '2.0', id, result }
    this.record('client_to_agent_response', message)
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  respondError(id, code, messageText) {
    const message = { jsonrpc: '2.0', id, error: { code, message: messageText } }
    this.record('client_to_agent_response', message)
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  markAccepted() {
    if (this.acceptedObserved) return
    this.acceptedObserved = true
    this.acceptedAt = new Date().toISOString()
  }

  async waitForProtocolQuiet(quietMs, maxMs) {
    const started = Date.now()
    while (Date.now() - started < maxMs) {
      if (Date.now() - this.lastProtocolAt >= quietMs) return
      await delay(50)
    }
  }

  async stop(signal) {
    if (this.exit) return this.exit
    if (!this.child.pid) throw new Error(`${this.label} has no process id`)
    try {
      process.kill(-this.child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    const exited = await Promise.race([
      this.exitPromise.then(() => true),
      delay(signal === 'SIGKILL' ? 10_000 : 5_000).then(() => false)
    ])
    if (!exited && signal !== 'SIGKILL') {
      try {
        process.kill(-this.child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
      await this.exitPromise
    } else if (!exited) {
      throw new Error(`${this.label} did not exit after SIGKILL`)
    }
    return this.exit
  }
}

function assertOutboundAllowed(role, method) {
  const allowlist = role === 'hostB'
    ? new Set(['initialize', 'session/load'])
    : new Set(['initialize', 'session/new', 'session/prompt', 'session/set_config_option'])
  if (!allowlist.has(method)) {
    throw new Error(`${role === 'hostB' ? 'Host B' : 'Host A'} outbound allowlist rejected ${method}`)
  }
}

function sessionParameters(workspace) {
  return {
    cwd: workspace,
    mcpServers: [],
    additionalDirectories: []
  }
}

async function createFixture(name) {
  const fixtureRoot = join(experimentRoot, name)
  const workspace = join(fixtureRoot, 'workspace')
  const data = join(fixtureRoot, 'data')
  const logs = join(data, 'copilot-logs')
  await mkdir(workspace, { recursive: true })
  await mkdir(logs, { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# Rovai P1 isolated Native Turn experiment\n')
  await runCommand('git', ['init', '-b', 'main'], workspace)
  await runCommand('git', ['config', 'user.name', 'Rovai P1 Experiment'], workspace)
  await runCommand('git', ['config', 'user.email', 'p1-experiment@rovai.local'], workspace)
  await runCommand('git', ['add', 'README.md'], workspace)
  await runCommand('git', ['commit', '-m', 'isolated fixture'], workspace)
  return { root: fixtureRoot, workspace, data, logs }
}

async function captureRuntime(path) {
  const resolvedExecutable = await realpath(path)
  const version = await runCommand(path, ['--version'], root)
  const versionLines = version.stdout.trim().split(/\r?\n/).filter(Boolean)
  return {
    executable: path,
    resolvedExecutable,
    reportedVersion: versionLines[0],
    versionOutputDigest: digestText(version.stdout.trim()),
    executableDigest: `sha256:${await digestFileRaw(resolvedExecutable)}`
  }
}

function readModelOptions(session) {
  const option = session?.configOptions?.find((candidate) => candidate.id === 'model')
  const values = option?.options ?? option?.values ?? []
  return values
    .map((candidate) => typeof candidate === 'string' ? candidate : candidate.value ?? candidate.id)
    .filter(Boolean)
}

function chooseModel(session) {
  const requested = process.env.ROVAI_P1_COPILOT_MODEL
  const option = session?.configOptions?.find((candidate) => candidate.id === 'model')
  const available = readModelOptions(session)
  if (requested) {
    if (available.length > 0 && !available.includes(requested)) {
      throw new Error(`ROVAI_P1_COPILOT_MODEL=${requested} is not advertised by Copilot`)
    }
    return requested
  }
  const current = option?.currentValue
  return available.find((value) => value === 'gpt-5.4')
    ?? (current && current !== 'auto' ? current : null)
    ?? available.find((value) => value !== 'auto')
    ?? null
}

function readCurrentModel(value) {
  return value?.models?.currentModelId
    ?? value?.configOptions?.find((candidate) => candidate.id === 'model')?.currentValue
    ?? null
}

function findCommand(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.command === 'string') return value.command
  for (const nested of Object.values(value)) {
    const found = findCommand(nested)
    if (found) return found
  }
  return null
}

function findProviderTurnIds(attempts) {
  const ids = new Set()
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (/^(providerTurnId|nativeTurnId|turnId|turn_id)$/i.test(key) && typeof nested === 'string') {
        ids.add(nested)
      } else {
        visit(nested)
      }
    }
  }
  visit(attempts)
  return [...ids].sort()
}

function findProviderTurnState(attempts, turnId) {
  const states = new Set()
  const visit = (value, containsTurn = false) => {
    if (!value || typeof value !== 'object') return
    const hasTurn = containsTurn || Object.values(value).includes(turnId)
    for (const [key, nested] of Object.entries(value)) {
      if (hasTurn && /^(state|status)$/i.test(key) && typeof nested === 'string'
          && ['running', 'completed', 'failed', 'not_found', 'ambiguous'].includes(nested)) {
        states.add(nested)
      } else {
        visit(nested, hasTurn)
      }
    }
  }
  visit(attempts)
  return states.size === 1 ? [...states][0] : null
}

function findHostBTerminalResultDigest(attempts, providerTurnId) {
  if (!providerTurnId) return null
  const explicitResults = []
  const visit = (value, containsTurn = false) => {
    if (!value || typeof value !== 'object') return
    const hasTurn = containsTurn || Object.values(value).includes(providerTurnId)
    for (const [key, nested] of Object.entries(value)) {
      if (hasTurn && /^(terminalResult|result)$/i.test(key) && nested !== null) {
        explicitResults.push(nested)
      } else {
        visit(nested, hasTurn)
      }
    }
  }
  visit(attempts)
  return explicitResults.length > 0 ? digestJson(explicitResults) : null
}

function runSyntheticCounterChecks() {
  const synthetic = [
    { direction: 'client_to_agent', message: { method: 'session/prompt' } },
    { direction: 'agent_to_client', message: { method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'one' } } } },
    { direction: 'agent_to_client', message: { method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'one' } } } }
  ]
  const tools = new Set()
  for (const entry of synthetic) {
    const update = entry.message?.params?.update
    if (update?.toolCallId) tools.add(update.toolCallId)
  }
  return countOutbound(synthetic, 'session/prompt') === 1 && tools.size === 1
}

function sanitizeLedger(ledger, secrets) {
  return ledger.map((entry) => sanitizeValue(entry, secrets))
}

function sanitizeValue(value, secrets, key = '') {
  if (/authorization|cookie|secret|password|credential|api[-_]?key|access[-_]?token/i.test(key)) {
    return '[REDACTED]'
  }
  if (typeof value === 'string') {
    let sanitized = value
    for (const sessionId of secrets.sessionIds ?? []) {
      if (sessionId) sanitized = sanitized.replaceAll(sessionId, `session-${digestText(sessionId).slice(7, 23)}`)
    }
    const sortedPaths = [...(secrets.paths ?? [])].filter(Boolean).sort((left, right) => right.length - left.length)
    for (const path of sortedPaths) sanitized = sanitized.replaceAll(path, '__ISOLATED_PATH__')
    sanitized = sanitized
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    return sanitized
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, secrets, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [
      nestedKey,
      sanitizeValue(nested, secrets, nestedKey)
    ]))
  }
  return value
}

function redactArgument(argument) {
  return argument
}

function isolatedHostEnvironment() {
  const allowedNames = [
    'HOME',
    'LANG',
    'LC_ALL',
    'LOGNAME',
    'NODE_EXTRA_CA_CERTS',
    'PATH',
    'SHELL',
    'SSL_CERT_FILE',
    'TMPDIR',
    'USER',
    'XDG_CONFIG_HOME'
  ]
  return Object.fromEntries(allowedNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]))
}

function countOutbound(ledger, method) {
  return ledger.filter((entry) => entry.direction === 'client_to_agent' && entry.message?.method === method).length
}

function countOutboundMethods(ledger) {
  const counts = {}
  for (const entry of ledger) {
    if (entry.direction !== 'client_to_agent' || !entry.message?.method) continue
    counts[entry.message.method] = (counts[entry.message.method] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

async function countNonce(path, token) {
  const contents = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return contents.split(/\r?\n/).filter((line) => line === token).length
}

async function digestFile(path) {
  try {
    return `sha256:${await digestFileRaw(path)}`
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function digestFileRaw(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function digestJson(value) {
  return digestText(JSON.stringify(value))
}

async function runCommand(command, arguments_, cwd) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, arguments_, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectCommand)
    child.once('close', (code, signal) => {
      if (code === 0) resolveCommand({ stdout, stderr })
      else rejectCommand(new Error(`${command} ${arguments_.join(' ')} failed (code=${code}, signal=${signal}): ${stderr}`))
    })
  })
}

async function waitUntil(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function assertOutputDoesNotExist(path) {
  const existing = await stat(path).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing) throw new Error(`Evidence output already exists: ${path}`)
  assert.ok(relative(root, path) !== '', 'Evidence output cannot be the repository root')
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true })
  const text = values.map((value) => JSON.stringify(value)).join('\n')
  await writeFile(path, text ? `${text}\n` : '')
}

async function writeManifest({ runtime, model, cases, status }) {
  const fileNames = (await readdir(outputRoot)).sort()
  const artifacts = []
  for (const fileName of fileNames) {
    if (fileName === 'manifest.json') continue
    artifacts.push({
      file: fileName,
      digest: `sha256:${await digestFileRaw(join(outputRoot, fileName))}`
    })
  }
  const manifest = {
    schemaVersion: 1,
    experiment: 'copilot-native-turn-reconciliation',
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    runtime,
    model,
    hostBPolicy: {
      outboundAllowlist: ['initialize', 'session/load'],
      promptForbidden: true
    },
    safetyViolations: cases.flatMap((artifact) => [
      artifact.hostB.promptRequestCount === 0 ? null : `${artifact.case}/${artifact.repetition}: Host B sent a prompt`,
      artifact.hostB.permissionRequestCount === 0 ? null : `${artifact.case}/${artifact.repetition}: Host B received an execution permission request`,
      artifact.clientPromptRequestCount === 1 ? null : `${artifact.case}/${artifact.repetition}: Host A prompt count was not one`,
      artifact.toolCallCount === 1 ? null : `${artifact.case}/${artifact.repetition}: unique Tool Call count was not one`,
      artifact.workspaceNonceCount === 1 ? null : `${artifact.case}/${artifact.repetition}: workspace nonce count was not one`
    ].filter(Boolean)),
    caseSummary: cases.map((artifact) => ({
      case: artifact.case,
      repetition: artifact.repetition,
      providerTurnId: artifact.providerTurnId,
      observedState: artifact.observedState,
      terminalResultDigest: artifact.terminalResultDigest,
      hostBPromptRequestCount: artifact.hostB.promptRequestCount,
      hostBPermissionRequestCount: artifact.hostB.permissionRequestCount,
      toolCallCount: artifact.toolCallCount,
      workspaceNonceCount: artifact.workspaceNonceCount,
      verdict: artifact.verdict
    })),
    artifacts
  }
  await writeJson(join(outputRoot, 'manifest.json'), manifest)
  return manifest
}

function evaluateMatrix(artifacts, requestedCases, repetitions) {
  const expected = requestedCases.length * repetitions
  assert.equal(artifacts.length, expected, 'experiment matrix is incomplete')
  const killCases = artifacts.filter((artifact) => artifact.case !== 'control')
  return killCases.length > 0 && killCases.every((artifact) => artifact.verdict === 'capability_proven')
    ? 'capability_proven'
    : 'capability_not_proven'
}

function timestampStem() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
}

await main()
