import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

if (process.platform !== 'darwin') {
  throw new Error('The current Pi qualification smoke is implemented for macOS; use the platform-specific Windows acceptance path on Windows')
}

const root = resolve(import.meta.dirname, '..')
const traceEnabled = process.env.ROVAI_PI_SMOKE_TRACE === '1'
const fileOperationMatrix = process.env.ROVAI_PI_FILE_OPERATION_MATRIX === '1'
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-pi-runtime-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const piAgentDir = join(fixtureRoot, 'pi-agent')
const piConfigSource = resolve(process.env.ROVAI_PI_CONFIG_SOURCE ?? join(homedir(), '.pi', 'agent'))
const piBinary = await resolvePiBinary(process.env.ROVAI_PI_BIN)
const piVersion = (await runCapture(piBinary, ['--version'], root)).trim()
if (!piVersionAtLeast(piVersion, [0, 84, 4])) {
  throw new Error(`Pi Runtime smoke requires Pi >= 0.84.4; found ${JSON.stringify(piVersion)}`)
}
const nativeWritePath = join(projectRoot, 'PI_NATIVE_WRITE.txt')
const cancelledPath = join(projectRoot, 'PI_CANCELLED_WRITE.txt')
const bashOutputCases = [
  {
    name: 'stdout',
    command: "printf 'PI_STDOUT_MARKER\\n'",
    terminalStatus: 'completed',
    included: ['PI_STDOUT_MARKER']
  },
  {
    name: 'stderr',
    command: "printf 'PI_STDERR_MARKER\\n' >&2",
    terminalStatus: 'completed',
    included: ['PI_STDERR_MARKER']
  },
  {
    name: 'mixed',
    command: "printf 'PI_MIXED_STDOUT\\n'; printf 'PI_MIXED_STDERR\\n' >&2",
    terminalStatus: 'completed',
    included: ['PI_MIXED_STDOUT', 'PI_MIXED_STDERR']
  },
  {
    name: 'empty',
    command: ':',
    terminalStatus: 'completed',
    included: ['(no output)']
  },
  {
    name: 'nonzero',
    command: "printf 'PI_NONZERO_MARKER\\n' >&2; exit 7",
    terminalStatus: 'failed',
    included: ['PI_NONZERO_MARKER', 'Command exited with code 7']
  },
  {
    name: 'large',
    command: "printf 'PI_LARGE_BEGIN\\n'; yes 'PI_LARGE_FILL_ABCDEFGHIJKLMNOPQRSTUVWXYZ' | head -n 2500; printf 'PI_LARGE_END\\n'",
    terminalStatus: 'completed',
    included: ['PI_LARGE_END', '[Showing lines', 'Full output:'],
    excluded: ['PI_LARGE_BEGIN']
  }
]
let client = null

try {
  await prepareIsolatedPiConfig(piConfigSource, piAgentDir)
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Pi Runtime qualification fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai Pi Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'pi-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  client = startCore(dataDir, piAgentDir, piBinary)
  trace('requesting workspaces.inspect')
  const workspace = await client.request('workspaces.inspect', { path: projectRoot })
  trace('workspaces.inspect completed')
  await waitForEvent(client, 'runtime.discovery.completed', 60_000)
  trace('initial Runtime discovery completed')
  const agentId = 'agent_2'
  const installation = await configureProductRuntime(client.request, 'pi', [agentId])
  trace('Pi product Runtime configured')
  assertCapabilitySnapshot(installation?.snapshot)
  const leakedProbeSessions = await listFiles(join(piAgentDir, 'sessions'))
  if (leakedProbeSessions.length !== 0) {
    throw new Error(`Pi Machine Ready Probe polluted the native Session root: ${JSON.stringify(leakedProbeSessions)}`)
  }

  const profile = await client.request('members.get', { agentId })
  if (profile.runtimeConfiguration?.adapterKind !== 'pi'
      || JSON.stringify(profile.runtimeConfiguration?.permissions?.values) !== '{}') {
    throw new Error(`Pi permission-free Runtime configuration was not frozen: ${JSON.stringify(profile)}`)
  }

  if (fileOperationMatrix) {
    const result = await runPiFileOperationMatrix({
      client,
      workspace,
      agentId,
      projectRoot,
      reportedVersion: installation.snapshot.reportedVersion,
      piVersion
    })
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } else {
  const first = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [
      'Answer this ordinary arithmetic question in one short sentence: what is 17 plus 25?',
      'Do not modify the workspace.'
    ].join(' '),
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Begin an ordinary conversation in the Pi Native Session before Core restart.'
  })
  const firstAccepted = acceptedRun(first)
  const firstResult = await waitForRun(client, firstAccepted.campId, firstAccepted.agentRunId)
  const firstOutput = outputForRun(firstResult.snapshot, firstAccepted.agentRunId)
  const firstStart = startForRun(client.events, firstAccepted.agentRunId)
  if (firstResult.run.status !== 'succeeded'
      || !firstOutput?.body.includes('42')
      || !isUuid(firstStart?.params?.nativeThreadId)
      || !isUuid(firstStart?.params?.hostInstanceId)) {
    throw new Error(`Initial Pi run failed: ${diagnostics(client, firstResult, firstAccepted.agentRunId)}`)
  }

  await client.stop()
  client = startCore(dataDir, piAgentDir, piBinary)
  await client.request('runtime.installations.list')

  const restoredRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    'Continue the immediately preceding arithmetic discussion: which two addends did I ask you to combine? Answer in one short sentence.',
    'Verify Pi exact Session resume after Core and Host restart.'
  )
  const restoredAccepted = acceptedRun(restoredRequest, firstAccepted.campId)
  const restoredResult = await waitForRun(
    client,
    firstAccepted.campId,
    restoredAccepted.agentRunId
  )
  const restoredOutput = outputForRun(restoredResult.snapshot, restoredAccepted.agentRunId)
  const restoredStart = startForRun(client.events, restoredAccepted.agentRunId)
  const restoredActions = actionsForRun(restoredResult.snapshot, restoredAccepted.agentRunId)
  if (restoredResult.run.status !== 'succeeded'
      || !restoredOutput?.body.includes('17')
      || !restoredOutput.body.includes('25')
      || restoredStart?.params?.nativeThreadId !== firstStart.params.nativeThreadId
      || restoredStart?.params?.hostInstanceId === firstStart.params.hostInstanceId
      || restoredResult.run.conversationId !== firstResult.run.conversationId
      || restoredActions.length !== 0
      || client.events.some((event) => event.method === 'runtime.host.log')) {
    throw new Error(`Pi cold exact-resume failed: ${diagnostics(client, restoredResult, restoredAccepted.agentRunId)}`)
  }

  const secondSession = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [
      'Answer this ordinary arithmetic question in one short sentence: what is 9 multiplied by 7?',
      'Do not modify the workspace.'
    ].join(' '),
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Verify a workspace-resident Pi Host can switch to a distinct Native Session.'
  })
  const secondAccepted = acceptedRun(secondSession)
  const secondResult = await waitForRun(client, secondAccepted.campId, secondAccepted.agentRunId)
  const secondOutput = outputForRun(secondResult.snapshot, secondAccepted.agentRunId)
  const secondStart = startForRun(client.events, secondAccepted.agentRunId)
  if (secondResult.run.status !== 'succeeded'
      || !secondOutput?.body.includes('63')
      || secondOutput.body.includes('42')
      || secondStart?.params?.hostInstanceId !== restoredStart.params.hostInstanceId
      || secondStart?.params?.nativeThreadId === restoredStart.params.nativeThreadId) {
    throw new Error(`Pi workspace Host did not switch cleanly to Session B: ${diagnostics(client, secondResult, secondAccepted.agentRunId)}`)
  }

  const switchBackRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    'Return to our earlier arithmetic discussion in this conversation: what sum did you calculate? Answer with the number.',
    'Verify the workspace-resident Pi Host switches exactly from Session B back to Session A.'
  )
  const switchBackAccepted = acceptedRun(switchBackRequest, firstAccepted.campId)
  const switchBackResult = await waitForRun(
    client,
    firstAccepted.campId,
    switchBackAccepted.agentRunId
  )
  const switchBackOutput = outputForRun(switchBackResult.snapshot, switchBackAccepted.agentRunId)
  const switchBackStart = startForRun(client.events, switchBackAccepted.agentRunId)
  if (switchBackResult.run.status !== 'succeeded'
      || !switchBackOutput?.body.includes('42')
      || switchBackOutput.body.includes('63')
      || switchBackStart?.params?.hostInstanceId !== secondStart.params.hostInstanceId
      || switchBackStart?.params?.nativeThreadId !== restoredStart.params.nativeThreadId) {
    throw new Error(`Pi exact Session A→B→A switch failed: ${diagnostics(client, switchBackResult, switchBackAccepted.agentRunId)}`)
  }

  const nativeWriteRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    `Use the write tool exactly once to create ${nativeWritePath} with exactly PI_NATIVE_WRITE_OK and a trailing newline. Do not call another tool. Then reply exactly WRITE_DONE.`,
    'Verify native Pi tool execution after cold resume.'
  )
  const nativeWriteAccepted = acceptedRun(nativeWriteRequest, firstAccepted.campId)
  const nativeWriteResult = await waitForRun(
    client,
    firstAccepted.campId,
    nativeWriteAccepted.agentRunId
  )
  const nativeWriteStart = startForRun(client.events, nativeWriteAccepted.agentRunId)
  const nativeWriteActions = actionsForRun(nativeWriteResult.snapshot, nativeWriteAccepted.agentRunId)
  const nativeWriteBody = await readFile(nativeWritePath, 'utf8').catch(() => null)
  if (nativeWriteResult.run.status !== 'succeeded'
      || nativeWriteBody?.trim() !== 'PI_NATIVE_WRITE_OK'
      || !nativeWriteActions.some((action) => action.status === 'succeeded')
      || nativeWriteStart?.params?.hostInstanceId !== switchBackStart.params.hostInstanceId
      || nativeWriteStart?.params?.nativeThreadId !== switchBackStart.params.nativeThreadId) {
    throw new Error(`Pi warm-LRU/native-write failed: ${diagnostics(client, nativeWriteResult, nativeWriteAccepted.agentRunId)}`)
  }

  const concurrentOne = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: "Use the Bash tool exactly once to run: sleep 2; printf 'PI_CONCURRENT_ONE_OK\\n'. Do not call another tool. Then reply exactly CONCURRENT_ONE_DONE.",
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Hold one Pi Host busy while proving concurrent dispatch acquires another Host.'
  })
  const concurrentOneAccepted = acceptedRun(concurrentOne)
  await waitForRunStarted(client, concurrentOneAccepted.agentRunId)
  const concurrentOneStart = startForRun(client.events, concurrentOneAccepted.agentRunId)

  const concurrentTwo = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: "Use the Bash tool exactly once to run: sleep 2; printf 'PI_CONCURRENT_TWO_OK\\n'. Do not call another tool. Then reply exactly CONCURRENT_TWO_DONE.",
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Prove concurrent Pi work in one Workspace uses a distinct Host.'
  })
  const concurrentTwoAccepted = acceptedRun(concurrentTwo)
  await waitForRunStarted(client, concurrentTwoAccepted.agentRunId)
  const concurrentTwoStart = startForRun(client.events, concurrentTwoAccepted.agentRunId)
  if (!concurrentOneStart || !concurrentTwoStart
      || concurrentOneStart.params.hostInstanceId === concurrentTwoStart.params.hostInstanceId
      || concurrentOneStart.params.nativeThreadId === concurrentTwoStart.params.nativeThreadId) {
    throw new Error(`Concurrent Pi Runs did not acquire distinct Host/Session identities: ${JSON.stringify({
      concurrentOneStart,
      concurrentTwoStart
    })}`)
  }
  const concurrentTwoResult = await waitForRun(
    client,
    concurrentTwoAccepted.campId,
    concurrentTwoAccepted.agentRunId
  )
  const concurrentOneResult = await waitForRun(
    client,
    concurrentOneAccepted.campId,
    concurrentOneAccepted.agentRunId
  )
  if (concurrentOneResult.run.status !== 'succeeded'
      || concurrentTwoResult.run.status !== 'succeeded'
      || !runtimeActionOutput(client.events, concurrentOneAccepted.agentRunId).includes('PI_CONCURRENT_ONE_OK')
      || !runtimeActionOutput(client.events, concurrentTwoAccepted.agentRunId).includes('PI_CONCURRENT_TWO_OK')) {
    throw new Error(`Concurrent Pi Runs did not settle independently: ${JSON.stringify({
      one: diagnostics(client, concurrentOneResult, concurrentOneAccepted.agentRunId),
      two: diagnostics(client, concurrentTwoResult, concurrentTwoAccepted.agentRunId)
    })}`)
  }

  const bashMatrixRequest = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [
      'This is an authorized local Runtime acceptance test. Invoke the Bash tool exactly six times, sequentially, using the following six commands verbatim and as six separate tool calls; never combine commands into one call:',
      ...bashOutputCases.map((testCase, index) => `${index + 1}. ${testCase.command}`),
      'After a command error, do not retry it and continue with the next numbered command. Do not call any other tool. After all six calls, reply exactly BASH_MATRIX_DONE.'
    ].join('\n'),
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Verify Pi Bash stdout, stderr, mixed, empty, nonzero, and bounded large-output lifecycle.'
  })
  const bashMatrixAccepted = acceptedRun(bashMatrixRequest)
  const bashMatrixResult = await waitForRun(
    client,
    bashMatrixAccepted.campId,
    bashMatrixAccepted.agentRunId
  )
  await assertBashOutputMatrix(
    client,
    bashMatrixResult,
    bashMatrixAccepted.campId,
    bashMatrixAccepted.agentRunId,
    bashOutputCases
  )

  const cancelRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    [
      'This is a native Pi tool cancellation test.',
      `You must invoke the Bash tool exactly once to run: sleep 30; printf 'SHOULD_NOT_EXIST\\n' > '${cancelledPath}'.`,
      'Do not simulate the command. Do not call another tool. If the tool returns an error, do not retry.'
    ].join(' '),
    'Verify Pi abort and descendant cleanup.'
  )
  const cancelAccepted = acceptedRun(cancelRequest, firstAccepted.campId)
  const cancelledResult = await cancelRunningTool(
    client,
    firstAccepted.campId,
    cancelAccepted.agentRunId
  )
  await delay(1_500)
  const cancelledBody = await readFile(cancelledPath, 'utf8').catch(() => null)
  if (cancelledResult.run.status !== 'cancelled' || cancelledBody !== null) {
    throw new Error(`Pi cancel did not stop the side effect: ${diagnostics(client, cancelledResult, cancelAccepted.agentRunId)}`)
  }

  const publicTrace = JSON.stringify({ events: client.events, stderr: client.stderr })
  for (const forbidden of ['ROVAI_PI_MINIMAX_API_KEY', 'ANTHROPIC_AUTH_TOKEN', '.claude/settings.json']) {
    if (publicTrace.includes(forbidden)) {
      throw new Error(`Pi public trace exposed private provider configuration: ${forbidden}`)
    }
  }
  for (const forbiddenField of ['"nativeSessionFile":', '"sessionFile":']) {
    if (publicTrace.includes(forbiddenField)) {
      throw new Error(`Pi public trace exposed the private Native Session locator: ${forbiddenField}`)
    }
  }
  if (client.stderr.some((line) => line.includes('interrupt timed out'))) {
    throw new Error(`Pi abort did not acknowledge within the Core interrupt window: ${JSON.stringify(client.stderr)}`)
  }

  const usage = await client.request('monitoring.snapshot', { range: '24h', runtimeKind: 'pi' })
  if (usage?.summary?.promptInputTotalTokens == null
      || usage?.summary?.outputTokens == null
      || !usage?.byRuntime?.some((entry) => entry.runtimeKind === 'pi')) {
    throw new Error(`Pi structured Usage was not persisted: ${JSON.stringify(usage)}`)
  }

  const corePid = client.pid
  const processSnapshot = await readProcessTable()
  const descendants = descendantsOf(processSnapshot, corePid)
  const residentPiProcesses = descendants.filter((process) => {
    const command = process.command.trim()
    return command === 'pi'
      || (command.includes('--mode rpc') && command.includes('--extension'))
  })
  if (residentPiProcesses.length === 0) {
    throw new Error(`No resident Pi RPC Host was observable before planned shutdown: ${JSON.stringify({ corePid, descendants })}`)
  }
  const shutdown = await client.stop()
  client = null
  const remainingProcesses = await waitForProcessesGone(
    [corePid, ...descendants.map((process) => process.pid)],
    10_000
  )
  const remainingHostConfigFiles = await listFiles(join(dataDir, 'runtime', 'pi', 'host-config'))
  if (shutdown.forced || remainingProcesses.length > 0 || remainingHostConfigFiles.length > 0) {
    throw new Error(`Pi planned shutdown did not fully reap private Runtime state: ${JSON.stringify({
      shutdown,
      remainingProcesses,
      remainingHostConfigFiles
    })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    adapterKind: 'pi',
    protocol: 'pi-jsonl-rpc-v1',
    reportedVersion: installation.snapshot.reportedVersion,
    testedPiVersion: piVersion,
    localEvidencePlatform: `${process.platform}-${process.arch}`,
    formalPlatformAdmission: 'qualified',
    probeSessionRootPollution: false,
    nativeSessionCompatibilityKey: installation.snapshot.nativeSessionCompatibilityKey,
    nativeSessionId: firstStart.params.nativeThreadId,
    firstHostInstanceId: firstStart.params.hostInstanceId,
    restoredHostInstanceId: restoredStart.params.hostInstanceId,
    warmHostReused: nativeWriteStart.params.hostInstanceId === restoredStart.params.hostInstanceId,
    coldSessionResumed: restoredStart.params.nativeThreadId === firstStart.params.nativeThreadId,
    workspaceSessionSwitch: {
      hostReusedAcrossCamps: secondStart.params.hostInstanceId === restoredStart.params.hostInstanceId,
      sessionIdsDistinct: secondStart.params.nativeThreadId !== restoredStart.params.nativeThreadId,
      switchedBackExactly: switchBackStart.params.nativeThreadId === restoredStart.params.nativeThreadId
    },
    concurrentHostsDistinct: concurrentOneStart.params.hostInstanceId !== concurrentTwoStart.params.hostInstanceId,
    bashOutputMatrix: bashOutputCases.map((testCase) => testCase.name),
    nativeActionCount: nativeWriteActions.filter((action) => action.status === 'succeeded').length,
    toolApproval: 'unsupported',
    cancelStatus: cancelledResult.run.status,
    cancelledFileCreated: cancelledBody !== null,
    externalMcpProjection: 'unsupported',
    externalMcpSameNamePolicy: null,
    externalMcpApprovalControl: 'unsupported',
    externalMcpStdio: false,
    externalMcpStreamableHttp: false,
    managedSkillDelivery: '.pi/skills',
    structuredUsageObserved: true,
    plannedShutdown: {
      graceful: true,
      observedResidentHostCount: residentPiProcesses.length,
      descendantsReaped: descendants.length,
      privateHostConfigFilesRemaining: 0
    }
  }, null, 2))
  }
} finally {
  await client?.stop()
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function runPiFileOperationMatrix({ client, workspace, agentId, projectRoot, reportedVersion, piVersion }) {
  const directory = join(projectRoot, 'runtime-file-operation-matrix', 'PI')
  const existingPath = join(directory, 'existing.txt')
  const emptyPath = join(directory, 'empty.txt')
  const createdPath = join(directory, 'created.txt')
  const originalText = 'RUNTIME_FILE_PI_ORIGINAL\n'
  const editedText = 'RUNTIME_FILE_PI_EDITED\n'
  const createdText = 'RUNTIME_FILE_PI_CREATED\n'
  const emptyEditedText = 'RUNTIME_FILE_PI_EMPTY_EDITED\n'
  await mkdir(directory, { recursive: true })
  await writeFile(existingPath, originalText)
  await writeFile(emptyPath, '')

  const cases = [
    {
      name: 'read', path: existingPath, expectedText: originalText, operation: 'read',
      prompt: `Use the native read tool exactly once to read ${existingPath}. Do not use Bash, grep, find, ls, or another tool. Then reply exactly FILE_READ_DONE.`
    },
    {
      name: 'add', path: createdPath, expectedText: createdText, operation: 'write',
      prompt: `Use the native write tool exactly once to create ${createdPath} with exactly ${createdText.trimEnd()} and a trailing newline. Do not read or call another tool. Then reply exactly FILE_ADD_DONE.`
    },
    {
      name: 'edit', path: existingPath, expectedText: editedText, operation: 'write',
      prompt: `Use native file tools to edit ${existingPath}; replace the exact text ${originalText.trimEnd()} with ${editedText.trimEnd()}. If the edit tool requires reading first, use the native read tool once before editing. Do not use shell or unrelated tools. Then reply exactly FILE_EDIT_DONE.`
    },
    {
      name: 'edit_empty', path: emptyPath, expectedText: emptyEditedText, operation: 'write',
      prompt: `The file ${emptyPath} already exists and is empty. Use native file tools to set it to exactly ${emptyEditedText.trimEnd()} and a trailing newline. If the write or edit tool requires reading first, use the native read tool once before writing. Do not use shell or unrelated tools. Then reply exactly FILE_EMPTY_EDIT_DONE.`
    }
  ]

  let campId = null
  const results = []
  let nativeSessionId = null
  for (const [index, testCase] of cases.entries()) {
    const eventStart = client.events.length
    const sent = index === 0
      ? await createConfiguredCampAndSend(client.request, {
          commandId: crypto.randomUUID(),
          workspace,
          body: testCase.prompt,
          address: { mode: 'explicit', agentIds: [agentId] },
          purpose: `Verify Pi ${testCase.name} file-operation Evidence`
        })
      : await sendExistingCampMessage(
          client.request,
          campId,
          testCase.prompt,
          `Verify Pi ${testCase.name} file-operation Evidence`
        )
    const accepted = acceptedRun(sent, campId ?? undefined)
    campId ??= accepted.campId
    const result = await waitForRun(client, campId, accepted.agentRunId)
    const start = startForRun(client.events, accepted.agentRunId)
    nativeSessionId ??= start?.params?.nativeThreadId ?? null
    const evidencePage = await client.request('agentRunEvidence.list', {
      campId,
      agentRunId: accepted.agentRunId,
      afterSequence: 0,
      limit: 1_000
    })
    const pathSuffix = testCase.path.slice(projectRoot.length + 1)
    const actualText = await readFile(testCase.path, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    const history = evidencePage.evidence.map((entry) => {
      const operation = entry.payload?.runtimeFileOperation
      const diffEntries = entry.canonical?.diffProjection?.status === 'available'
        ? entry.canonical.diffProjection.entries ?? []
        : []
      return {
        evidenceId: entry.id,
        sequence: entry.sequence,
        eventType: entry.eventType,
        phase: entry.canonical?.phase ?? entry.phase,
        outcome: entry.canonical?.outcome ?? null,
        classifierVersion: entry.canonical?.classifierVersion ?? null,
        activityDomain: entry.canonical?.activityDomain ?? null,
        semanticKind: entry.canonical?.semanticKind ?? null,
        operation: operation?.schemaVersion === 2
          ? {
              schemaVersion: operation.schemaVersion,
              status: operation.status,
              operationKind: operation.operationKind ?? null,
              path: operation.path ?? null,
              safeReasonCode: operation.safeReasonCode ?? null,
              sourceEventKind: operation.sourceMetadata?.sourceEventKind ?? null
            }
          : null,
        diffEntries: diffEntries.map((entry) => ({
          path: entry.path,
          changeKind: entry.changeKind,
          additions: entry.additions,
          deletions: entry.deletions
        }))
      }
    }).filter((entry) => entry.operation || entry.diffEntries.length > 0)
    const matchingOperation = history.find((entry) =>
      entry.operation?.status === 'available'
        && entry.operation.operationKind === testCase.operation
        && entry.operation.path === pathSuffix
    )
    const matchingDiff = history.flatMap((entry) => entry.diffEntries)
      .find((entry) => entry.path === pathSuffix)
    const fileLinkTarget = matchingOperation?.operation?.path ?? matchingDiff?.path ?? null
    const live = client.events.slice(eventStart)
      .filter((event) => event.params?.agentRunId === accepted.agentRunId)
      .map((event) => ({
        id: event.params?.evidenceId ?? null,
        method: event.method,
        classifierVersion: event.params?.canonical?.classifierVersion ?? null,
        semanticKind: event.params?.canonical?.semanticKind ?? null,
        phase: event.params?.canonical?.phase ?? null,
        operationKind: event.params?.payload?.runtimeFileOperation?.operationKind ?? null,
        path: event.params?.payload?.runtimeFileOperation?.path ?? null
      }))
      .filter((entry) => entry.operationKind || entry.semanticKind?.startsWith('file.'))
    const fileChanges = result.snapshot.agentRunFileChanges.filter((entry) =>
      entry.agentRunId === accepted.agentRunId
    )
    const output = outputForRun(result.snapshot, accepted.agentRunId)?.body ?? null
    results.push({
      name: testCase.name,
      agentRunId: accepted.agentRunId,
      runStatus: result.run.status,
      nativeSessionContinued: start?.params?.nativeThreadId === nativeSessionId,
      expectedPath: pathSuffix,
      fileEffect: actualText === testCase.expectedText ? 'passed' : 'failed',
      observedText: actualText,
      output,
      typedProjection: matchingOperation ? 'passed' : 'not_observed',
      diffChangeKind: matchingDiff?.changeKind ?? null,
      fileLinkTarget,
      fileLinkMatchesExpected: fileLinkTarget === pathSuffix,
      presentation: testCase.name === 'read'
        ? matchingOperation ? '阅读' : '保持原工具回退'
        : matchingDiff?.changeKind === 'add'
          ? '新增'
          : matchingOperation || matchingDiff
            ? '编辑'
            : '保持原工具回退',
      filesChangedCount: fileChanges.length,
      live,
      history
    })
  }

  return {
    adapterKind: 'pi',
    protocol: 'pi-jsonl-rpc-v1',
    reportedVersion,
    testedPiVersion: piVersion,
    localEvidencePlatform: `${process.platform}-${process.arch}`,
    nativeSessionId,
    fileOperations: results
  }
}

function assertCapabilitySnapshot(snapshot) {
  const requiredCapabilities = [
    'pi-jsonl-rpc-v1',
    'pi.rpc.host',
    'pi.rpc.managed_extension',
    'pi.rpc.get_state',
    'model.dynamic_catalog',
    'session.new',
    'conversation.exact_resume'
  ]
  const unobservedBehaviorCapabilities = [
    'pi.rpc.prompt',
    'pi.rpc.agent_settled',
    'pi.rpc.structured_tools',
    'pi.rpc.extension_approval',
    'pi.rpc.managed_input_receipt',
    'context.charter.managed_system_prompt',
    'context.compaction.native_system_prompt_preserved',
    'usage.model_call.structured',
    'builtin_cli.transport.v22'
  ]
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.protocols?.includes('pi-jsonl-rpc-v1')
      || !snapshot.models?.some((model) => model.id === 'pi://runtime-default' && model.isDefault)
      || !requiredCapabilities.every((capability) => snapshot.capabilities?.includes(capability))
      || unobservedBehaviorCapabilities.some((capability) => snapshot.capabilities?.includes(capability))
      || snapshot.permissionOptions?.length !== 0
      || snapshot.nativeSessionCompatibilityKey !== 'pi-jsonl-rpc-v1:managed-system-prompt-v1') {
    throw new Error(`Pi capability snapshot is invalid: ${JSON.stringify({
      probeStatus: snapshot?.probeStatus,
      protocols: snapshot?.protocols,
      capabilities: snapshot?.capabilities,
      defaultModel: snapshot?.models?.find((model) => model.isDefault),
      permissionOptions: snapshot?.permissionOptions,
      nativeSessionCompatibilityKey: snapshot?.nativeSessionCompatibilityKey
    })}`)
  }
}

function startCore(dataDirectory, isolatedPiAgentDir, resolvedPiBinary) {
  const events = []
  const stderr = []
  const pending = new Map()
  let nextId = 1
  let stopping = false
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library'),
    '--mcp-config-path', join(dataDirectory, 'mcp.json')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: isolatedPiAgentDir,
      ROVAI_PI_BIN: resolvedPiBinary
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk))
    process.stderr.write(chunk)
  })
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopping) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
  })
  const lines = createInterface({ input: child.stdout })
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
    }, 120_000)
    pending.set(id, {
      resolve: (value) => {
        trace(`response ${method}`)
        resolveRequest(value)
      },
      reject: rejectRequest,
      timer
    })
    trace(`request ${method}`)
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
      if (!error) return
      clearTimeout(timer)
      pending.delete(id)
      rejectRequest(error)
    })
  })
  const stop = async () => {
    if (stopping || child.exitCode !== null) {
      return { forced: false, exitCode: child.exitCode, signalCode: child.signalCode }
    }
    stopping = true
    const closed = new Promise((resolveClose) => child.once('close', () => resolveClose(true)))
    child.stdin.end()
    const exitedGracefully = await Promise.race([
      closed,
      delay(10_000).then(() => false)
    ])
    let forced = false
    if (!exitedGracefully && child.exitCode === null) {
      forced = true
      child.kill('SIGTERM')
      const terminated = await Promise.race([
        closed,
        delay(5_000).then(() => false)
      ])
      if (!terminated && child.exitCode === null) {
        child.kill('SIGKILL')
        await Promise.race([closed, delay(5_000)])
      }
    }
    lines.close()
    return { forced, exitCode: child.exitCode, signalCode: child.signalCode }
  }
  return { events, stderr, pid: child.pid, request, stop }
}

async function sendExistingCampMessage(request, campId, body, purpose) {
  const draft = await request('camp.composerDraft.get', { campId })
  const saved = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: draft.revision,
    content: { version: 2, segments: [{ kind: 'text', text: body }] }
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: saved.revision,
    execution: { taskId: null, purpose, completionRole: 'required' }
  })
}

function acceptedRun(result, knownCampId = null) {
  const command = result.commandResult ?? result
  const campId = knownCampId ?? command.payload?.campId
  const agentRunId = command.payload?.agentRunIds?.[0]
  if (command.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`Pi AgentRun intake failed: ${JSON.stringify(result)}`)
  }
  return { campId, agentRunId }
}

async function waitForRun(client, campId, agentRunId) {
  const deadline = Date.now() + 300_000
  let snapshot
  let run
  while (Date.now() < deadline) {
    snapshot = await client.request('camps.snapshot', { campId })
    const actions = actionsForRun(snapshot, agentRunId)
    const approvals = approvalsForRun(snapshot, agentRunId)
    if (approvals.length > 0) {
      throw new Error(`Native Pi execution unexpectedly created Rovai Approval state: ${JSON.stringify(approvals)}`)
    }
    run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      return { snapshot, run, actions }
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for Pi AgentRun ${agentRunId}: ${JSON.stringify(run)}`)
}

async function cancelRunningTool(client, campId, agentRunId) {
  let cancellationRequested = false
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const snapshot = await client.request('camps.snapshot', { campId })
    const approvals = approvalsForRun(snapshot, agentRunId)
    if (approvals.length > 0) {
      throw new Error(`Native Pi cancellation unexpectedly created Rovai Approval state: ${JSON.stringify(approvals)}`)
    }
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (!cancellationRequested && run && ['cancelled', 'failed', 'succeeded'].includes(run.status)) {
      throw new Error(`Pi Run settled before its expected native Tool cancellation: ${diagnostics(client, { snapshot, run }, agentRunId)}`)
    }
    const nativeToolStarted = client.events.some((event) =>
      event.method === 'runtime.action'
        && event.params?.agentRunId === agentRunId
        && event.params?.payload?.toolName === 'bash'
        && event.params?.payload?.status === 'in_progress'
    )
    if (!cancellationRequested && nativeToolStarted && run) {
      const turn = snapshot.turns.find((candidate) => candidate.id === run.campTurnId)
      const cancellation = await client.request('campTurns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, campTurnId: turn.id, expectedVersion: turn.version }
      })
      if (cancellation.status === 'rejected') throw new Error(`Pi CampTurn cancel failed: ${JSON.stringify(cancellation)}`)
      cancellationRequested = true
    }
    if (cancellationRequested && run && ['cancelled', 'failed', 'succeeded'].includes(run.status)) {
      return { snapshot, run }
    }
    await delay(250)
  }
  throw new Error(`Timed out cancelling Pi AgentRun ${agentRunId}`)
}

function actionsForRun(snapshot, agentRunId) {
  return snapshot.actions.filter((action) => action.agentRunId === agentRunId)
}

function approvalsForRun(snapshot, agentRunId) {
  const actionIds = new Set(actionsForRun(snapshot, agentRunId).map((action) => action.id))
  return snapshot.approvals.filter((approval) => actionIds.has(approval.actionId))
}

function outputForRun(snapshot, agentRunId) {
  return snapshot.messages.find((message) => message.sourceAgentRunId === agentRunId)
}

function runtimeActionOutput(events, agentRunId) {
  return events
    .filter((event) => event.method === 'runtime.action' && event.params?.agentRunId === agentRunId)
    .map((event) => String(event.params?.payload?.output ?? ''))
    .join('\n')
}

async function assertBashOutputMatrix(client, result, campId, agentRunId, testCases) {
  const output = outputForRun(result.snapshot, agentRunId)
  const events = client.events.filter((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === agentRunId
      && event.params?.payload?.toolName === 'bash'
  )
  const inputByToolCallId = new Map()
  const terminalByToolCallId = new Map()
  for (const event of events) {
    const payload = event.params.payload
    const toolCallId = payload.toolCallId
    if (typeof toolCallId !== 'string' || toolCallId.length === 0) continue
    if (typeof payload.input === 'string') {
      const previous = inputByToolCallId.get(toolCallId)
      if (previous !== undefined && previous !== payload.input) {
        throw new Error(`Pi Bash input changed within one tool call: ${JSON.stringify({ toolCallId, previous, current: payload.input })}`)
      }
      inputByToolCallId.set(toolCallId, payload.input)
    }
    if (['completed', 'failed'].includes(payload.status)) {
      const terminals = terminalByToolCallId.get(toolCallId) ?? []
      terminals.push(event)
      terminalByToolCallId.set(toolCallId, terminals)
    }
  }

  const failures = []
  if (result.run.status !== 'succeeded') failures.push(`run status=${result.run.status}`)
  if (output?.body.trim() !== 'BASH_MATRIX_DONE') failures.push(`final output=${JSON.stringify(output?.body)}`)
  if (inputByToolCallId.size !== testCases.length) failures.push(`input tool count=${inputByToolCallId.size}`)
  if (terminalByToolCallId.size !== testCases.length) failures.push(`terminal tool count=${terminalByToolCallId.size}`)
  const evidencePage = await client.request('agentRunEvidence.list', {
    campId,
    agentRunId,
    afterSequence: 0,
    limit: 1_000
  })
  const evidenceById = new Map(evidencePage.evidence.map((evidence) => [evidence.id, evidence]))

  for (const testCase of testCases) {
    const matches = [...inputByToolCallId.entries()].filter(([, input]) => input === testCase.command)
    if (matches.length !== 1) {
      failures.push(`${testCase.name}: exact input matches=${matches.length}`)
      continue
    }
    const [toolCallId] = matches[0]
    const terminals = terminalByToolCallId.get(toolCallId) ?? []
    if (terminals.length !== 1) {
      failures.push(`${testCase.name}: terminal count=${terminals.length}`)
      continue
    }
    const terminalEvent = terminals[0]
    let terminal = terminalEvent.params.payload
    if (terminal._rovaiTruncated === true) {
      const evidence = evidenceById.get(terminalEvent.params.evidenceId)
      if (!evidence?.isTruncated || !evidence.contentBlobId) {
        failures.push(`${testCase.name}: truncated preview has no managed evidence Blob`)
      } else {
        const full = await client.request('agentRunEvidence.getContent', {
          campId,
          evidenceId: evidence.id
        })
        terminal = full.payload
      }
    }
    const terminalOutput = String(terminal.output ?? '')
    if (terminal.status !== testCase.terminalStatus) {
      failures.push(`${testCase.name}: terminal status=${terminal.status}`)
    }
    for (const marker of testCase.included) {
      if (!terminalOutput.includes(marker)) failures.push(`${testCase.name}: missing ${JSON.stringify(marker)}`)
    }
    for (const marker of testCase.excluded ?? []) {
      if (terminalOutput.includes(marker)) failures.push(`${testCase.name}: unexpectedly retained ${JSON.stringify(marker)}`)
    }
    if (testCase.name === 'large' && Buffer.byteLength(terminalOutput, 'utf8') > 60 * 1024) {
      failures.push(`${testCase.name}: terminal output was not bounded (${Buffer.byteLength(terminalOutput, 'utf8')} bytes)`)
    }
  }

  const actions = actionsForRun(result.snapshot, agentRunId)
  const actionIds = new Set(actions.map((action) => action.id))
  if (actions.length !== testCases.length || actionIds.size !== testCases.length) {
    failures.push(`snapshot actions=${actions.length}, unique=${actionIds.size}`)
  }
  if (actions.filter((action) => action.status === 'succeeded').length !== testCases.length - 1
      || actions.filter((action) => action.status === 'failed').length !== 1) {
    failures.push(`snapshot action statuses=${JSON.stringify(actions.map((action) => action.status))}`)
  }

  if (failures.length > 0) {
    throw new Error(`Pi Bash output matrix failed (${failures.join('; ')}): ${diagnostics(client, result, agentRunId)}`)
  }
}

function startForRun(events, agentRunId) {
  return events.find((event) => event.method === 'agent_run.started' && event.params?.agentRunId === agentRunId)
}

function diagnostics(client, result, agentRunId) {
  return JSON.stringify({
    run: result.run,
    output: outputForRun(result.snapshot, agentRunId),
    actions: actionsForRun(result.snapshot, agentRunId),
    approvals: approvalsForRun(result.snapshot, agentRunId),
    events: client.events.filter((event) => event.params?.agentRunId === agentRunId).slice(-40),
    stderr: client.stderr.slice(-20)
  })
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitForEvent(client, method, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const event = client.events.find((candidate) => candidate.method === method)
    if (event) return event
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${method}`)
}

async function waitForRunStarted(client, agentRunId) {
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const started = startForRun(client.events, agentRunId)
    if (started) return started
    await delay(50)
  }
  throw new Error(`Timed out waiting for Pi agent_start admission in ${agentRunId}`)
}

function trace(message) {
  if (traceEnabled) process.stderr.write(`[pi-smoke] ${message}\n`)
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

async function runCapture(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun(stdout.join(''))
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}

async function readProcessTable() {
  const output = await runCapture('/bin/ps', ['-axo', 'pid=,ppid=,command='])
  return output
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }))
}

function descendantsOf(processes, rootPid) {
  const descendantIds = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const process of processes) {
      if ((process.parentPid === rootPid || descendantIds.has(process.parentPid))
          && !descendantIds.has(process.pid)) {
        descendantIds.add(process.pid)
        changed = true
      }
    }
  }
  return processes.filter((process) => descendantIds.has(process.pid))
}

async function waitForProcessesGone(processIds, timeoutMs) {
  const expected = new Set(processIds.filter((pid) => Number.isInteger(pid) && pid > 0))
  const deadline = Date.now() + timeoutMs
  let remaining = []
  while (Date.now() < deadline) {
    remaining = (await readProcessTable()).filter((process) => expected.has(process.pid))
    if (remaining.length === 0) return []
    await delay(100)
  }
  return remaining
}

async function resolvePiBinary(configured) {
  if (configured?.trim()) return realpath(resolve(configured.trim()))
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, 'pi')
    try {
      await access(candidate, fsConstants.X_OK)
      return realpath(candidate)
    } catch {}
  }
  throw new Error('Pi executable was not found; set ROVAI_PI_BIN to a Pi >= 0.84.4 executable')
}

function piVersionAtLeast(value, minimum) {
  const match = value.match(/(?:^|\D)(\d+)\.(\d+)\.(\d+)(?!\d)/)
  if (!match || /\d+\.\d+\.\d+-/.test(value)) return false
  const version = match.slice(1).map(Number)
  return version.some((part, index) => part > minimum[index]
    && version.slice(0, index).every((prefix, prefixIndex) => prefix === minimum[prefixIndex]))
    || version.every((part, index) => part === minimum[index])
}

async function prepareIsolatedPiConfig(source, destination) {
  if (!isAbsolute(source) || !isAbsolute(destination)) {
    throw new Error('Pi config isolation requires absolute source and destination paths')
  }
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await chmod(destination, 0o700)
  for (const name of ['auth.json', 'settings.json', 'models.json']) {
    const sourceFile = join(source, name)
    try {
      await access(sourceFile, fsConstants.R_OK)
    } catch (error) {
      if (name === 'models.json') continue
      throw new Error(`Pi smoke requires readable official ${name}: ${error.message}`)
    }
    const destinationFile = join(destination, name)
    await copyFile(sourceFile, destinationFile)
    await chmod(destinationFile, 0o600)
  }
  const settings = JSON.parse(await readFile(join(destination, 'settings.json'), 'utf8'))
  if (settings.defaultProvider !== 'minimax-cn' || settings.defaultModel !== 'MiniMax-M3') {
    throw new Error('Pi smoke requires official settings.json default minimax-cn/MiniMax-M3')
  }
  const auth = JSON.parse(await readFile(join(destination, 'auth.json'), 'utf8'))
  if (auth['minimax-cn']?.type !== 'api_key' || !auth['minimax-cn']?.key) {
    throw new Error('Pi smoke requires official auth.json MiniMax China API-key credential')
  }
}

async function listFiles(directory) {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
