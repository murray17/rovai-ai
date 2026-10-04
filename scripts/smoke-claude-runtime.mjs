import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { composerDocumentForAddress, createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { claudeSendReceipt } from './lib/claude-send-receipt.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-claude-runtime-smoke-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
console.error(`Isolated Claude Core acceptance: data=${dataDir}; skills=${join(dataDir, 'managed-skill-library')}; MCP=${join(dataDir, 'mcp.json')}`)
let core = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Claude Code Runtime fixture\n')
  await writeFile(
    join(projectRoot, 'CLAUDE_EDIT_FIXTURE.ts'),
    'export const enabled = false\n'
  )
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Claude Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'claude-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md', 'CLAUDE_EDIT_FIXTURE.ts'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore(dataDir)
  await core.request('health.check')
  const installation = await configureProductRuntime(
    core.request,
    'claude-code-cli',
    ['agent_1']
  )
  const snapshot = installation?.snapshot
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.models.some((model) =>
        model.id === 'claude-code://runtime-default' && model.isDefault
      )
      || !snapshot.permissionOptions.some((option) =>
        option.key === 'permission_mode' && option.recommendedValue === 'acceptEdits'
      )
      || !snapshot.capabilities.includes('team_tool.mcp_config')
      || !snapshot.capabilities.includes('team_tool.allow')) {
    throw new Error(`Claude Code capability snapshot is invalid: ${JSON.stringify(snapshot)}`)
  }

  if (process.env.ROVAI_CLAUDE_APPROVAL_ONLY === '1') {
    const profile = await core.request('members.get', { agentId: 'agent_1' })
    await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: profile.agentId, expectedVersion: profile.version, adapterKind: 'claude-code-cli', model: profile.runtimeConfiguration.model,
      permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: { permission_mode: 'acceptEdits' } }
    } })
    const workspace = await core.request('workspaces.inspect', { path: projectRoot })
    const allowed = await runClaudeApprovalScenario(core, workspace, 'allow_once')
    const denied = await runClaudeApprovalScenario(core, workspace, 'deny')
    const cancelled = await runClaudeApprovalScenario(core, workspace, 'cancel')
    console.log(JSON.stringify({ ok: true, runtime: snapshot.reportedVersion, approvalSmoke: { allowed, denied, cancelled } }, null, 2))
  } else {
  let profile = await core.request('members.get', { agentId: 'agent_1' })
  const permissionsConfigured = await core.request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId: profile.agentId,
      expectedVersion: profile.version,
      adapterKind: 'claude-code-cli',
      model: profile.runtimeConfiguration.model,
      permissions: {
        adapterKind: 'claude-code-cli',
        schemaVersion: 1,
        values: { permission_mode: 'bypassPermissions' }
      }
    }
  })
  if (permissionsConfigured.status !== 'applied') {
    throw new Error(`Claude Code smoke permissions were rejected: ${JSON.stringify(permissionsConfigured)}`)
  }
  profile = await core.request('members.get', { agentId: profile.agentId })
  if (profile.runtimeConfiguration?.permissions?.values?.permission_mode !== 'bypassPermissions') {
    throw new Error(`Claude Code smoke permissions drifted: ${JSON.stringify(profile.runtimeConfiguration)}`)
  }

  const workspace = await core.request('workspaces.inspect', { path: projectRoot })
  const first = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: 'Reply with exactly ROVAI_CLAUDE_RUN_ONE and nothing else. Do not call tools.',
    purpose: 'Verify Claude Code CLI execution.',
  })
  if (first.status !== 'accepted') {
    throw new Error(`Claude Code Camp intake failed: ${JSON.stringify(first)}`)
  }
  const threadId = first.payload.threadId
  let camp = await waitFor(async () => {
    const value = await core.request('threads.snapshot', { threadId })
    const run = value.agentRuns[0]
    return run?.status === 'succeeded'
      && value.messages.some((message) =>
        message.sourceAgentRunId === run.id && message.body.includes('ROVAI_CLAUDE_RUN_ONE')
      )
      ? value
      : null
  }, 'first Claude Code AgentRun')
  const firstRun = camp.agentRuns[0]
  const firstNarration = runtimeNarration(core.events, firstRun.id)
  if (!firstNarration.includes('ROVAI_CLAUDE_RUN_ONE')) {
    throw new Error(`Claude Code first final text was not projected as narration: ${JSON.stringify({
      firstRun,
      firstNarration,
      events: core.events.filter((event) => event.params?.agentRunId === firstRun.id)
    })}`)
  }
  const firstBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === firstRun.id
  )
  const nativeSessionId = firstBinding?.params?.nativeThreadId
  if (!isUuid(nativeSessionId)) {
    throw new Error(`Claude Code Native Session was not bound: ${JSON.stringify(firstBinding)}`)
  }
  const observedRuntimeModel = core.events.find((event) =>
    event.method === 'agent_run.runtime_model_observed'
      && event.params?.agentRunId === firstRun.id
  )?.params?.modelId
  if (typeof observedRuntimeModel !== 'string' || observedRuntimeModel.length === 0) {
    throw new Error('Claude Code did not report the model used by the first AgentRun')
  }

  const followUp = await sendThreadMessage(
    core.request,
    threadId,
    'Reply with exactly ROVAI_CLAUDE_RUN_TWO and nothing else. Do not call tools.',
    {
      taskId: null,
      purpose: 'Verify Claude Code Native Session resume.',
      completionRole: 'required'
    }
  )
  if (followUp.commandResult?.status !== 'accepted') {
    throw new Error(`Claude Code follow-up failed: ${JSON.stringify(followUp)}`)
  }
  camp = await waitFor(async () => {
    const value = await core.request('threads.snapshot', { threadId })
    const response = value.messages.find((message) =>
      message.sourceAgentRunId
        && message.body.includes('ROVAI_CLAUDE_RUN_TWO')
    )
    return value.agentRuns.length === 2
      && value.agentRuns.every((agentRun) => agentRun.status === 'succeeded')
      && response
      ? value
      : null
  }, 'resumed Claude Code AgentRun')
  const secondResponse = camp.messages.find((message) =>
    message.sourceAgentRunId
      && message.body.includes('ROVAI_CLAUDE_RUN_TWO')
  )
  const secondRun = camp.agentRuns.find((agentRun) =>
    agentRun.id === secondResponse?.sourceAgentRunId
  )
  if (!secondRun) {
    throw new Error(`Claude Code follow-up AgentRun was not found: ${JSON.stringify(camp)}`)
  }
  const secondNarration = runtimeNarration(core.events, secondRun.id)
  if (!secondNarration.includes('ROVAI_CLAUDE_RUN_TWO')) {
    throw new Error(`Claude Code resumed final text was not projected as narration: ${JSON.stringify({
      secondRun,
      secondNarration,
      events: core.events.filter((event) => event.params?.agentRunId === secondRun.id)
    })}`)
  }
  const secondBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === secondRun.id
  )
  if (secondBinding?.params?.nativeThreadId !== nativeSessionId
      || secondRun.conversationId !== firstRun.conversationId) {
    throw new Error(`Claude Code did not resume the same Conversation: ${JSON.stringify({
      firstRun,
      secondRun,
      firstBinding,
      secondBinding
    })}`)
  }

  const commandMarker = 'ROVAI_CLAUDE_PRINTF_OK'
  const commandRequest = await sendThreadMessage(
    core.request,
    threadId,
    `Use the Bash tool exactly once to run this command without changing files: printf '%s\\n' '${commandMarker}'. Do not call any other tool. Then immediately reply exactly ROVAI_CLAUDE_COMMAND_OUTPUT_OK.`,
    {
      taskId: null,
      purpose: 'Verify Claude Code Bash output projection.',
      completionRole: 'required'
    }
  )
  if (commandRequest.commandResult?.status !== 'accepted') {
    throw new Error(`Claude Code command-output intake failed: ${JSON.stringify(commandRequest)}`)
  }
  const commandRunId = await waitForAgentRunId(core, threadId, [firstRun.id, secondRun.id])
  camp = await waitFor(async () => {
    const value = await core.request('threads.snapshot', { threadId })
    const commandRun = value.agentRuns.find((agentRun) => agentRun.id === commandRunId)
    if (commandRun?.status === 'failed' || commandRun?.status === 'cancelled') {
      throw new Error(`Claude Code command-output AgentRun entered ${commandRun.status}: ${JSON.stringify({
        commandRun,
        actions: value.actions.filter((action) => action.agentRunId === commandRunId),
        events: core.events.filter((event) => event.params?.agentRunId === commandRunId).slice(-30)
      })}`)
    }
    return commandRun?.status === 'succeeded' ? value : null
  }, 'Claude Code Bash AgentRun')
  const commandRun = camp.agentRuns.find((agentRun) => agentRun.id === commandRunId)
  const commandOutputEvent = core.events.find((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === commandRunId
      && String(event.params?.payload?.output ?? '').includes(commandMarker)
  )
  const commandInputEvent = core.events.find((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === commandRunId
      && String(event.params?.payload?.input ?? '').includes(commandMarker)
  )
  const commandBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === commandRunId
  )
  if (!commandRun
      || !commandOutputEvent
      || !commandInputEvent
      || commandBinding?.params?.nativeThreadId !== nativeSessionId
      || commandRun.conversationId !== firstRun.conversationId) {
    throw new Error(`Claude Code Bash output was not projected on the resumed Conversation: ${JSON.stringify({
      commandRun,
      commandBinding,
      marker: commandMarker,
      runtimeActions: core.events.filter((event) =>
        event.method === 'runtime.action' && event.params?.agentRunId === commandRunId
      )
    })}`)
  }

  const editRequest = await sendThreadMessage(
    core.request,
    threadId,
    'Use the Edit tool exactly once on CLAUDE_EDIT_FIXTURE.ts. Replace the exact text `export const enabled = false` with `export const enabled = true`. Do not call Read, Write, Bash, NotebookEdit, ApplyPatch, or any other tool. Then immediately reply exactly ROVAI_CLAUDE_EDIT_OK.',
    {
      taskId: null,
      purpose: 'Verify Claude Code native Edit exact-mutation Evidence.',
      completionRole: 'required'
    }
  )
  if (editRequest.commandResult?.status !== 'accepted') {
    throw new Error(`Claude Code Edit intake failed: ${JSON.stringify(editRequest)}`)
  }
  const editRunId = await waitForAgentRunId(core, threadId, [
    firstRun.id, secondRun.id, commandRunId
  ])
  camp = await waitFor(async () => {
    const value = await core.request('threads.snapshot', { threadId })
    const editRun = value.agentRuns.find((agentRun) => agentRun.id === editRunId)
    if (editRun?.status === 'failed' || editRun?.status === 'cancelled') {
      throw new Error(`Claude Code Edit AgentRun entered ${editRun.status}: ${JSON.stringify({
        editRun,
        actions: value.actions.filter((action) => action.agentRunId === editRunId),
        events: core.events.filter((event) => event.params?.agentRunId === editRunId).slice(-30)
      })}`)
    }
    return editRun?.status === 'succeeded' ? value : null
  }, 'Claude Code Edit AgentRun')
  const editTerminalEvents = core.events.filter((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === editRunId
      && event.params?.payload?.toolName === 'Edit'
      && event.params?.payload?.status === 'completed'
  )
  const exactEditEvent = editTerminalEvents.find((event) =>
    event.params?.payload?.runtimeDiff?.status === 'available'
      && event.params?.payload?.runtimeDiff?.semanticKind === 'exact_mutation'
  )
  const exactEditEvidence = exactEditEvent?.params?.payload?.runtimeDiff?.entries?.[0]
  const exactEditProjection = exactEditEvent?.params?.canonical?.diffProjection
  const exactEditProjectionEntry = exactEditProjection?.entries?.[0]
  const editedFixture = await readFile(join(projectRoot, 'CLAUDE_EDIT_FIXTURE.ts'), 'utf8')
  if (editTerminalEvents.length !== 1
      || !exactEditEvent
      || exactEditEvidence?.semantics !== 'exact_mutation'
      || exactEditEvidence?.path !== 'CLAUDE_EDIT_FIXTURE.ts'
      || exactEditEvidence?.oldText !== 'export const enabled = false'
      || exactEditEvidence?.newText !== 'export const enabled = true'
      || Object.hasOwn(exactEditEvidence, 'diff')
      || exactEditProjection?.semanticKind !== 'exact_mutation'
      || exactEditProjectionEntry?.path !== 'CLAUDE_EDIT_FIXTURE.ts'
      || exactEditProjectionEntry?.diff !== '-export const enabled = false\n+export const enabled = true\n'
      || exactEditProjectionEntry.diff.includes('@@')
      || editedFixture !== 'export const enabled = true\n') {
    throw new Error(`Claude Code Edit exact mutation was not preserved: ${JSON.stringify({
      editTerminalEvents,
      exactEditEvidence,
      exactEditProjection,
      editedFixture
    })}`)
  }

  const cancellationPath = join(projectRoot, 'CLAUDE_CANCEL_SHOULD_NOT_EXIST.txt')
  const cancellationScriptName = process.platform === 'win32'
    ? 'rovai-cancel-probe.ps1'
    : 'rovai-cancel-probe.sh'
  await writeFile(
    join(projectRoot, cancellationScriptName),
    process.platform === 'win32'
      ? "Start-Sleep -Seconds 45\r\nSet-Content -LiteralPath 'CLAUDE_CANCEL_SHOULD_NOT_EXIST.txt' -Value 'late'\r\n"
      : "sleep 45\nprintf '%s\\n' 'late' > CLAUDE_CANCEL_SHOULD_NOT_EXIST.txt\n"
  )
  const cancellationCommand = process.platform === 'win32'
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./${cancellationScriptName}`
    : `sh ./${cancellationScriptName}`
  const cancellationRequest = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(),
    workspace,
    memberAgentIds: ['agent_1'],
    defaultLeadAgentId: 'agent_1',
    body: `Use the Bash tool exactly once to run exactly this command and do nothing else: ${cancellationCommand}`,
    purpose: 'Verify Claude Code cancellation and descendant cleanup.'
  })
  const cancellationCampId = cancellationRequest.payload?.threadId
  const cancellationMessageId = cancellationRequest.payload?.threadMessageId
  if (cancellationRequest.status !== 'accepted' || !cancellationCampId || !cancellationMessageId) {
    throw new Error(`Claude Code cancellation intake failed: ${JSON.stringify(cancellationRequest)}`)
  }
  const cancellationRunId = await waitFor(async () => {
    const snapshot = await core.request('threads.snapshot', { threadId: cancellationCampId })
    return snapshot.agentRuns.find((run) =>
      run.inputMessageIds?.includes(cancellationMessageId)
        || run.anchorMessageId === cancellationMessageId)?.id ?? null
  }, 'Claude Code cancellation AgentRun')
  const cancellationStarted = await waitFor(async () => {
    const event = core.events.find((candidate) =>
      candidate.method === 'runtime.action'
        && candidate.params?.agentRunId === cancellationRunId
        && candidate.params?.payload?.status === 'in_progress'
        && String(candidate.params?.payload?.input ?? '').includes(cancellationScriptName)
    )
    if (event) return event
    const unexpectedAction = core.events.find((candidate) =>
      candidate.method === 'runtime.action'
        && candidate.params?.agentRunId === cancellationRunId
        && candidate.params?.payload?.status === 'in_progress'
    )
    if (unexpectedAction) {
      throw new Error(`Claude Code started an unexpected cancellation action: ${JSON.stringify(unexpectedAction)}`)
    }
    const value = await core.request('threads.snapshot', { threadId: cancellationCampId })
    const run = value.agentRuns.find((agentRun) => agentRun.id === cancellationRunId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      throw new Error(`Claude Code cancellation target became ${run.status} before the Bash start event: ${JSON.stringify({
        run,
        actions: value.actions.filter((action) => action.agentRunId === cancellationRunId),
        events: core.events.filter((candidate) => candidate.params?.agentRunId === cancellationRunId).slice(-30)
      })}`)
    }
    return null
  }, 'Claude Code cancellable Bash action')
  camp = await core.request('threads.snapshot', { threadId: cancellationCampId })
  const cancellationRun = camp.agentRuns.find((agentRun) => agentRun.id === cancellationRunId)
  if (!cancellationRun || !['queued', 'running', 'waiting_approval'].includes(cancellationRun.status)) {
    throw new Error(`Claude Code cancellation target was not active: ${JSON.stringify({
      cancellationRun,
      cancellationStarted
    })}`)
  }
  const cancellationResult = await core.request('agentRuns.cancel', {
    commandId: crypto.randomUUID(),
    command: {
      threadId: cancellationCampId,
      agentRunId: cancellationRunId,
      expectedVersion: cancellationRun.version
    }
  })
  if (cancellationResult.status === 'rejected') {
    throw new Error(`Claude Code cancellation was rejected: ${JSON.stringify(cancellationResult)}`)
  }
  camp = await waitFor(async () => {
    const value = await core.request('threads.snapshot', { threadId: cancellationCampId })
    const run = value.agentRuns.find((agentRun) => agentRun.id === cancellationRunId)
    if (run?.status === 'failed' || run?.status === 'succeeded') {
      throw new Error(`Claude Code cancellation target entered ${run.status}: ${JSON.stringify({
        run,
        actions: value.actions.filter((action) => action.agentRunId === cancellationRunId),
        events: core.events.filter((event) => event.params?.agentRunId === cancellationRunId).slice(-30)
      })}`)
    }
    return run?.status === 'cancelled' ? value : null
  }, 'cancelled Claude Code AgentRun')
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500))
  if (await pathExists(cancellationPath)) {
    throw new Error('Claude Code cancelled Bash descendant still created its delayed file')
  }

  let approvalSmoke = null
  if (process.env.ROVAI_CLAUDE_APPROVAL_SMOKE === '1') {
    profile = await core.request('members.get', { agentId: 'agent_1' })
    const interactivePermissions = await core.request('members.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentId: profile.agentId,
        expectedVersion: profile.version,
        adapterKind: 'claude-code-cli',
        model: profile.runtimeConfiguration.model,
        permissions: {
          adapterKind: 'claude-code-cli',
          schemaVersion: 1,
          values: { permission_mode: 'acceptEdits' }
        }
      }
    })
    if (interactivePermissions.status !== 'applied') {
      throw new Error(`Claude Code interactive permissions were rejected: ${JSON.stringify(interactivePermissions)}`)
    }
    const allowed = await runClaudeApprovalScenario(core, workspace, 'allow_once')
    const denied = await runClaudeApprovalScenario(core, workspace, 'deny')
    const cancelled = await runClaudeApprovalScenario(core, workspace, 'cancel')
    approvalSmoke = { allowed, denied, cancelled }
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: snapshot.reportedVersion,
    observedRuntimeModel,
    modelAliases: snapshot.models
      .filter((model) => !model.id.endsWith('://runtime-default'))
      .map((model) => model.id),
    nativeSessionId,
    nativeSessionContinued: true,
    conversationId: firstRun.conversationId,
    narrationProjected: true,
    commandOutput: {
      marker: commandMarker,
      output: commandOutputEvent.params.payload.output,
      input: commandInputEvent.params.payload.input,
      toolName: commandOutputEvent.params.payload.toolName,
      toolCallId: commandOutputEvent.params.payload.toolCallId
    },
    exactEditMutation: {
      path: exactEditEvidence.path,
      oldText: exactEditEvidence.oldText,
      newText: exactEditEvidence.newText,
      diff: exactEditProjectionEntry.diff,
      hasSyntheticHunkHeader: exactEditProjectionEntry.diff.includes('@@')
    },
    cancellation: {
      status: camp.agentRuns.find((agentRun) => agentRun.id === cancellationRunId)?.status,
      actionStarted: true,
      delayedFileCreated: false
    },
    approvalSmoke,
    teamToolAdvertised: true
  }, null, 2))
  }
} finally {
  if (core) await core.stop()
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function runClaudeApprovalScenario(core, workspace, decision) {
  const marker = `ROVAI_CLAUDE_APPROVAL_${decision}_${crypto.randomUUID()}`
  const intake = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(),
    workspace,
    memberAgentIds: ['agent_1'],
    defaultLeadAgentId: 'agent_1',
    body: `Use the Bash tool exactly once to run this exact command: rovai send --public-only --body "${marker}". If permission is denied, do not retry. Then report the result.`,
    purpose: `Verify Claude Code ${decision} permission callback.`
  })
  const threadId = intake.payload?.threadId
  if (intake.status !== 'accepted' || !threadId) {
    throw new Error(`Claude approval intake failed: ${JSON.stringify(intake)}`)
  }
  const runId = await waitForAgentRunId(core, threadId)
  let resolvedApprovalId = null
  const result = await waitFor(async () => {
    const snapshot = await core.request('threads.snapshot', { threadId })
    const action = snapshot.actions.find((candidate) => candidate.agentRunId === runId)
    const approval = snapshot.approvals.find((candidate) =>
      candidate.actionId === action?.id && candidate.status === 'pending'
    )
    if (approval && !resolvedApprovalId) {
      const run = snapshot.agentRuns.find((candidate) => candidate.id === runId)
      if (approval.permissionSemantics !== 'runtime_managed_v2') {
        throw new Error(`Claude approval has no expected native option: ${JSON.stringify(approval)}`)
      }
      if (decision === 'cancel') {
        const cancellation = await core.request('agentRuns.cancel', {
          commandId: crypto.randomUUID(),
          command: { threadId, agentRunId: runId, expectedVersion: run.version }
        })
        if (cancellation.status === 'rejected') {
          throw new Error(`Claude pending approval cancellation was rejected: ${JSON.stringify(cancellation)}`)
        }
      } else {
        const option = approval.options.find((candidate) => candidate.kind === decision)
        if (!option) {
          throw new Error(`Claude approval has no ${decision} option: ${JSON.stringify(approval)}`)
        }
        const resolution = await core.request('action.approvals.resolve', {
          commandId: crypto.randomUUID(),
          threadId,
          approvalId: approval.id,
          expectedVersion: approval.version,
          optionId: option.optionId,
          reason: 'Isolated Claude permission callback smoke'
        })
        if (resolution.status === 'rejected') {
          throw new Error(`Claude approval resolution was rejected: ${JSON.stringify(resolution)}`)
        }
      }
      resolvedApprovalId = approval.id
    }
    const run = snapshot.agentRuns.find((candidate) => candidate.id === runId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      return { snapshot, run, action }
    }
    return null
  }, `Claude ${decision} Approval`)
  const finalSnapshot = await core.request('threads.snapshot', { threadId })
  const action = finalSnapshot.actions.find((candidate) => candidate.agentRunId === runId)
  const published = finalSnapshot.messages.some((message) => message.body === marker)
  const sendReceipt = await claudeSendReceipt(core.request, threadId, runId, marker, finalSnapshot)
  if (!resolvedApprovalId
      || (decision === 'allow_once' && (result.run.status !== 'succeeded' || action?.status !== 'succeeded' || !published || !sendReceipt))
      || (decision === 'deny' && (action?.status !== 'not_executed' || published || sendReceipt))
      || (decision === 'cancel' && (result.run.status !== 'cancelled' || action?.status !== 'not_executed' || published || sendReceipt))) {
    throw new Error(`Claude ${decision} approval did not settle safely: ${JSON.stringify({
      runStatus: result.run.status,
      action,
      published,
      sendReceipt,
      resolvedApprovalId,
      approval: finalSnapshot.approvals.find((candidate) => candidate.id === resolvedApprovalId),
      events: core.events.filter((event) => event.params?.agentRunId === runId && ['action.prepared', 'runtime_request.resolved', 'runtime.diagnostic', 'runtime.action'].includes(event.method)).slice(-12)
    })}`)
  }
  return { runStatus: result.run.status, actionStatus: action?.status, published, sendReceipt }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library'),
    '--mcp-config-path', join(dataDirectory, 'mcp.json')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  const events = []
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
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
    }, 180_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop, events }
}

async function waitFor(probe, label) {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function waitForAgentRunId(core, threadId, excludedIds = []) {
  return waitFor(async () => {
    const snapshot = await core.request('threads.snapshot', { threadId })
    return snapshot.agentRuns.find((run) => !excludedIds.includes(run.id))?.id ?? null
  }, `AgentRun in Camp ${threadId}`)
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function runtimeNarration(events, agentRunId) {
  return events
    .filter((event) =>
      event.method === 'agent.text.delta'
        && event.params?.agentRunId === agentRunId
    )
    .map((event) => String(event.params?.payload?.delta ?? ''))
    .join('')
}

async function sendThreadMessage(request, threadId, body, execution) {
  const sent = await request('thread.messages.send', {
    commandId: crypto.randomUUID(),
    threadId,
    content: composerDocumentForAddress({ mode: 'default' }, body),
    sourceAttachments: [],
    quotes: [],
    replyToThreadMessageId: null,
    execution
  })
  const messageId = sent.commandResult?.payload?.threadMessageId
  if (sent.commandResult?.status !== 'accepted' || !messageId) return sent
  const runId = await waitFor(async () => {
    const camp = await request('threads.snapshot', { threadId })
    return camp.agentRuns.find((run) =>
      run.inputMessageIds?.includes(messageId) || run.anchorMessageId === messageId)?.id ?? null
  }, `AgentRun for Camp message ${messageId}`)
  return {
    ...sent,
    commandResult: {
      ...sent.commandResult,
      payload: { ...sent.commandResult.payload, agentRunIds: [runId] }
    }
  }
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
