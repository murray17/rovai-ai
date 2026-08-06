import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-builtin-cli-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const historyMarker = 'ROVAI_BUILTIN_HISTORY_V1'
const expectedOperations = [
  'camp.list',
  'camp.read',
  'camp.search',
  'history.search',
  'memory.propose_hearth',
  'memory.read',
  'memory.search',
  'memory.write',
  'team.call_member',
  'team.create_task',
  'team.list_tasks',
  'team.update_task'
]
const allRuntimeSpecifications = [
  ['codex-cli', 'Codex'],
  ['opencode-cli', 'OpenCode'],
  ['copilot-cli', 'Copilot'],
  ['claude-code-cli', 'Claude'],
  ['antigravity-app', 'Antigravity'],
  ['kiro-cli', 'Kiro'],
  ['qoder-cli', 'Qoder'],
  ['codebuddy-cli', 'CodeBuddy'],
  ['qwen-code', 'Qwen']
].map(([adapterKind, label]) => ({ adapterKind, label, slug: adapterKind.replaceAll('-', '_') }))
const selectedAdapters = new Set((process.env.ROVAI_BUILTIN_CLI_ADAPTERS
  ?? allRuntimeSpecifications.map((value) => value.adapterKind).join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean))
const unknownAdapters = [...selectedAdapters].filter((adapterKind) =>
  !allRuntimeSpecifications.some((value) => value.adapterKind === adapterKind)
)
if (unknownAdapters.length) {
  throw new Error(`Unknown ROVAI_BUILTIN_CLI_ADAPTERS: ${unknownAdapters.join(', ')}`)
}
const runtimeSpecifications = allRuntimeSpecifications.filter((value) =>
  selectedAdapters.has(value.adapterKind)
)

let core = null
let keepFixture = process.env.ROVAI_KEEP_BUILTIN_CLI_FIXTURE === '1'

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Built-in CLI Runtime Qualification\n')
  await runCapture('git', ['init', '-b', 'main'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.name', 'Rovai Built-in CLI Smoke'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.email', 'builtin-cli@rovai.local'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['add', 'README.md'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, expectedCode: 0 })

  core = startCore(dataDir)
  await core.request('health.check')
  const workspace = await core.request('workspaces.inspect', { path: projectRoot })

  for (const specification of runtimeSpecifications) {
    specification.agentId = await createProfile(
      core.request,
      `${specification.label} CLI Verifier`
    )
    specification.recipientProfileId = await createProfile(
      core.request,
      `${specification.label} CLI Receipt Worker`
    )
    specification.installation = await configureProductRuntime(
      core.request,
      specification.adapterKind,
      [specification.agentId, specification.recipientProfileId]
    )
    if (specification.adapterKind === 'codex-cli'
        && process.env.ROVAI_BUILTIN_CLI_CODEX_MODEL) {
      for (const agentId of [
        specification.agentId,
        specification.recipientProfileId
      ]) {
        await selectExplicitModel(
          core.request,
          agentId,
          specification.adapterKind,
          process.env.ROVAI_BUILTIN_CLI_CODEX_MODEL
        )
      }
    }
    assertBuiltinCliCapability(specification.adapterKind, specification.installation)
  }

  const historyCampId = await createCamp(core.request, {
    name: 'Built-in CLI Shared History',
    projectPath: workspace.projectPath,
    memberAgentIds: runtimeSpecifications.flatMap((value) => [
      value.agentId,
      value.recipientProfileId
    ]),
    defaultLeadAgentId: runtimeSpecifications[0].agentId
  })
  await sendCampMessage(core.request, {
    campId: historyCampId,
    body: `${historyMarker}: shared historical evidence for all nine Runtime qualifications.`,
    execution: null
  })

  for (const specification of runtimeSpecifications) {
    specification.currentMarker = `ROVAI_CURRENT_${specification.slug.toUpperCase()}_V1`
    specification.successMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_OK`
    specification.resumeMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_RESUME_OK`
    specification.contextPathFile = join(projectRoot, `.context-path-${specification.slug}`)
    specification.resumeContextPathFile = join(projectRoot, `.resume-context-path-${specification.slug}`)
    specification.diagnosticPath = join(projectRoot, `.diagnostic-${specification.slug}`)
    specification.campId = await createCamp(core.request, {
      name: `${specification.label} Built-in CLI`,
      projectPath: workspace.projectPath,
      memberAgentIds: [specification.agentId, specification.recipientProfileId],
      defaultLeadAgentId: specification.agentId
    })
    await sendCampMessage(core.request, {
      campId: specification.campId,
      body: `${specification.currentMarker}: current-Camp evidence for ${specification.adapterKind}.`,
      execution: null
    })
    specification.scriptPath = join(projectRoot, `verify-${specification.slug}.sh`)
    await writeFile(
      specification.scriptPath,
      verificationScript({
        ...specification,
        historyCampId,
        historyMarker,
        recipientProfileId: specification.recipientProfileId
      }),
      { mode: 0o755 }
    )
    await chmod(specification.scriptPath, 0o755)
    specification.resumeScriptPath = join(projectRoot, `verify-${specification.slug}-resume.sh`)
    await writeFile(
      specification.resumeScriptPath,
      resumeVerificationScript(specification),
      { mode: 0o755 }
    )
    await chmod(specification.resumeScriptPath, 0o755)
  }

  const results = []
  for (const specification of runtimeSpecifications) {
    process.stderr.write(`\n[builtin-cli] ${specification.adapterKind}: full 12-operation Run\n`)
    const source = await startVerificationRun(core, specification, false)
    const sourceSnapshot = await waitForRun(core, specification.campId, source.agentRunId, {
      marker: specification.successMarker,
      timeoutMs: 720_000
    })
    const evidence = await builtinEvidence(
      core.request,
      specification.campId,
      source.agentRunId
    )
    const observedOperations = [...new Set(evidence.map((entry) => entry.payload?.canonicalTool))]
      .filter(Boolean)
      .sort()
    if (JSON.stringify(observedOperations) !== JSON.stringify(expectedOperations)) {
      throw new Error(`${specification.adapterKind} did not commit all canonical operations: ${JSON.stringify({
        observedOperations,
        evidence
      })}`)
    }
    const staleConflict = evidence.find((entry) =>
      entry.payload?.canonicalTool === 'team.update_task'
        && entry.payload?.status === 'failed'
        && entry.payload?.errorCode === 'task.version_conflict'
    )
    if (!staleConflict || evidence.some((entry) => entry.payload?.sourceAuthority !== 'core')) {
      throw new Error(`${specification.adapterKind} evidence did not prove the Core Router boundary`)
    }

    const recipientSnapshot = await waitForRecipientRun(
      core,
      specification,
      specification.recipientProfileId
    )
    const firstContextPath = (await readFile(specification.contextPathFile, 'utf8')).trim()
    await assertFencedContext(firstContextPath, specification.adapterKind, 'initial')

    process.stderr.write(`[builtin-cli] ${specification.adapterKind}: resumed/new-lease Run\n`)
    const resumed = await startVerificationRun(core, specification, true)
    const resumedSnapshot = await waitForRun(core, specification.campId, resumed.agentRunId, {
      marker: specification.resumeMarker,
      timeoutMs: 480_000
    })
    const resumedEvidence = await builtinEvidence(
      core.request,
      specification.campId,
      resumed.agentRunId
    )
    if (!resumedEvidence.some((entry) =>
      entry.payload?.canonicalTool === 'camp.list'
        && entry.payload?.status === 'completed'
        && entry.payload?.sourceAuthority === 'core'
    )) {
      throw new Error(`${specification.adapterKind} resumed lease did not execute camp.list`)
    }
    const resumedContextPath = (await readFile(specification.resumeContextPathFile, 'utf8')).trim()
    await assertFencedContext(resumedContextPath, specification.adapterKind, 'resumed')

    const sourceStart = core.events.find((event) =>
      event.method === 'agent_run.started' && event.params?.agentRunId === source.agentRunId
    )
    const resumedStart = core.events.find((event) =>
      event.method === 'agent_run.started' && event.params?.agentRunId === resumed.agentRunId
    )
    if (sourceStart?.params?.adapterKind !== specification.adapterKind
        || resumedStart?.params?.adapterKind !== specification.adapterKind) {
      throw new Error(`${specification.adapterKind} emitted the wrong Adapter identity`)
    }
    const firstRun = sourceSnapshot.agentRuns.find((run) => run.id === source.agentRunId)
    const secondRun = resumedSnapshot.agentRuns.find((run) => run.id === resumed.agentRunId)
    if (!firstRun || !secondRun || firstRun.conversationId !== secondRun.conversationId) {
      throw new Error(`${specification.adapterKind} did not preserve logical Conversation identity`)
    }
    const recipientRun = recipientSnapshot.agentRuns.find((run) =>
      run.agentId === specification.recipientProfileId
    )

    results.push({
      adapterKind: specification.adapterKind,
      reportedVersion: specification.installation.snapshot.reportedVersion,
      selectedModel: sourceStart.params.modelId,
      sourceAgentRunId: source.agentRunId,
      resumedAgentRunId: resumed.agentRunId,
      recipientAgentRunId: recipientRun?.id,
      recipientRunStatusAtObservation: recipientRun?.status,
      operations: observedOperations,
      fullRunEvidenceCount: evidence.length,
      staleVersionConflict: true,
      initialLeaseFenced: true,
      resumedLeaseFenced: true,
      logicalConversationContinued: true,
      nativeSessionContinued: Boolean(
        sourceStart.params.nativeThreadId
          && sourceStart.params.nativeThreadId === resumedStart.params.nativeThreadId
      )
    })
  }

  console.log(JSON.stringify({
    ok: true,
    contractVersion: 1,
    ipcProtocolVersion: 1,
    runtimeCount: results.length,
    operationCountPerRuntime: expectedOperations.length,
    expectedOperations,
    results,
    fixtureRetained: keepFixture ? fixtureRoot : null
  }, null, 2))
} catch (error) {
  keepFixture = true
  process.stderr.write(`\n[builtin-cli] FAILED; fixture retained at ${fixtureRoot}\n`)
  throw error
} finally {
  if (core) await core.stop()
  if (!keepFixture) await rm(fixtureRoot, { recursive: true, force: true })
}

function assertBuiltinCliCapability(label, installation) {
  const snapshot = installation?.snapshot
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.capabilities.includes('builtin_cli.transport.v1')
      || !snapshot.models.length) {
    throw new Error(`${label} is not ready for Built-in CLI v1: ${JSON.stringify(snapshot)}`)
  }
}

async function createProfile(request, displayName) {
  const result = await request('agents.create', {
    commandId: crypto.randomUUID(),
    command: {
      displayName,
      teamRole: 'Runtime verifier',
      professionalResponsibilities: 'Execute the fixed local Built-in CLI qualification script.',
      personalityTraits: ['Precise', 'Direct'],
      workingPrinciples: 'Run only the explicit qualification command and report its marker.',
      growthTopic: ''
    }
  })
  const id = result.resultEntity?.entityId
  if (result.status !== 'applied' || !id) {
    throw new Error(`AgentProfile creation failed: ${JSON.stringify(result)}`)
  }
  return id
}

async function selectExplicitModel(request, agentId, adapterKind, modelId) {
  const profile = await request('agents.get', { agentId })
  const result = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId,
      expectedVersion: profile.version,
      adapterKind,
      model: {
        mode: 'explicit',
        modelId,
        options: { reasoning_effort: 'low' }
      },
      permissions: profile.runtimePreference.permissions
    }
  })
  if (result.status !== 'applied') {
    throw new Error(`Explicit Runtime model was not selected: ${JSON.stringify(result)}`)
  }
  const resolved = await request('agents.get', { agentId })
  if (resolved.runtimeReadiness?.status !== 'ready') {
    throw new Error(`Explicit Runtime model is not ready: ${JSON.stringify(resolved)}`)
  }
}

async function createCamp(request, input) {
  const result = await request('camps.create', {
    commandId: crypto.randomUUID(),
    name: input.name,
    workspace: { projectPath: input.projectPath },
    memberAgentIds: input.memberAgentIds,
    defaultLeadAgentId: input.defaultLeadAgentId,
    collaborationMode: 'peer'
  })
  const campId = result.payload?.campId
  if (result.status !== 'applied' || !campId) {
    throw new Error(`Camp creation failed: ${JSON.stringify(result)}`)
  }
  return campId
}

async function sendCampMessage(request, input) {
  const draft = await request('camp.composerDraft.get', { campId: input.campId })
  const content = input.agentId
    ? [
        { kind: 'member_mention', agentId: input.agentId },
        { kind: 'text', text: ` ${input.body}` }
      ]
    : [{ kind: 'text', text: input.body }]
  const saved = await request('camp.composerDraft.save', {
    campId: input.campId,
    expectedRevision: draft.revision,
    content
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId: input.campId,
    draftRevision: saved.revision,
    replyToCampMessageId: null,
    execution: input.execution
  })
}

async function startVerificationRun(coreClient, specification, resumed) {
  const marker = resumed ? specification.resumeMarker : specification.successMarker
  const scriptPath = resumed ? specification.resumeScriptPath : specification.scriptPath
  const sent = await sendCampMessage(coreClient.request, {
    campId: specification.campId,
    agentId: specification.agentId,
    body: [
      'Run the local repository Built-in CLI transport qualification.',
      'The script was generated by this test and the Runtime process already has ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP injected.',
      'You may inspect the script if your Runtime requires that before execution; do not modify or replace it.',
      'Use your native bash/shell tool to run:',
      `/bin/bash ${JSON.stringify(scriptPath)}`,
      `If it exits 0 and prints ${marker}, reply with exactly ${marker}.`
    ].join('\n'),
    execution: {
      taskId: null,
      purpose: resumed
        ? `Verify ${specification.adapterKind} resume/process reuse receives a new active CLI lease.`
        : `Verify ${specification.adapterKind} executes all 12 CLI-only built-in operations.`,
      expectedOutput: `Execute the fixed shell qualification and reply exactly ${marker}.`,
      completionRole: 'required'
    }
  })
  const commandResult = sent.commandResult ?? sent
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`${specification.adapterKind} AgentRun intake failed: ${JSON.stringify(sent)}`)
  }
  return { agentRunId }
}

async function waitForRun(coreClient, campId, agentRunId, options) {
  const deadline = Date.now() + options.timeoutMs
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { campId })
    await resolvePendingApprovals(coreClient.request, snapshot, agentRunId, resolvedApprovals)
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run?.status === 'succeeded') {
      const output = snapshot.messages.find((message) =>
        message.sourceAgentRunId === agentRunId
      )?.body
      if (!output?.trim()) {
        throw new Error(`AgentRun ${agentRunId} succeeded without output`)
      }
      return snapshot
    }
    if (run && ['failed', 'cancelled'].includes(run.status)) {
      throw new Error(`AgentRun ${agentRunId} entered ${run.status}: ${JSON.stringify({
        run,
        actions: snapshot.actions.filter((action) => action.agentRunId === agentRunId),
        timeline: snapshot.timeline.slice(-30)
      })}`)
    }
    await delay(400)
  }
  throw new Error(`Timed out waiting for AgentRun ${agentRunId}`)
}

async function waitForRecipientRun(coreClient, specification, recipientProfileId) {
  const deadline = Date.now() + 480_000
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { campId: specification.campId })
    const candidates = snapshot.agentRuns.filter((run) => run.agentId === recipientProfileId)
    for (const candidate of candidates) {
      await resolvePendingApprovals(coreClient.request, snapshot, candidate.id, resolvedApprovals)
    }
    const run = candidates.at(-1)
    if (run) {
      return snapshot
    }
    await delay(400)
  }
  throw new Error(`${specification.adapterKind} recipient Run did not complete`)
}

async function resolvePendingApprovals(request, snapshot, agentRunId, resolvedApprovals) {
  const actionIds = new Set(snapshot.actions
    .filter((action) => action.agentRunId === agentRunId)
    .map((action) => action.id))
  for (const approval of snapshot.approvals.filter((candidate) =>
    candidate.status === 'pending'
      && actionIds.has(candidate.actionId)
      && !resolvedApprovals.has(candidate.id)
  )) {
    const option = approval.options.find((candidate) => candidate.kind === 'allow_session')
      ?? approval.options.find((candidate) => candidate.kind === 'allow_once')
    if (!option) throw new Error(`No bounded allow option for ${approval.id}`)
    const result = await request('action.approvals.resolve', {
      commandId: crypto.randomUUID(),
      campId: snapshot.camp.id,
      approvalId: approval.id,
      expectedVersion: approval.version,
      optionId: option.optionId,
      reason: 'Local Built-in CLI Runtime qualification'
    })
    if (result.status === 'rejected') {
      throw new Error(`Approval ${approval.id} was rejected: ${JSON.stringify(result)}`)
    }
    resolvedApprovals.add(approval.id)
  }
}

async function builtinEvidence(request, campId, agentRunId) {
  const collected = []
  let afterSequence = 0
  let throughSequence = null
  while (true) {
    const page = await request('agentRunEvidence.list', {
      campId,
      agentRunId,
      afterSequence,
      limit: 1_000
    })
    throughSequence ??= page.throughSequence
    if (page.throughSequence !== throughSequence
        || page.nextAfterSequence < afterSequence
        || (page.hasMore && page.nextAfterSequence === afterSequence)) {
      throw new Error(`Evidence pagination contract failed for ${agentRunId}`)
    }
    collected.push(...page.evidence)
    if (!page.hasMore) break
    afterSequence = page.nextAfterSequence
  }
  return collected.filter((entry) => entry.payload?.kind === 'builtin_tool_invocation')
}

async function assertFencedContext(contextPath, adapterKind, phase) {
  if (!contextPath.startsWith(dataDir)) {
    throw new Error(`${adapterKind} exposed an unexpected CLI context path: ${contextPath}`)
  }
  let lastResult = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await runCapture(join(root, 'target', 'debug', 'rovai'), ['tool', 'list'], {
      env: { ...process.env, ROVAI_CLI_CONTEXT: contextPath },
      expectedCodes: [0, 2]
    })
    lastResult = result
    if (result.code === 2 && result.stderr.includes('builtin_tool.cli_error')) return
    await delay(250)
  }
  throw new Error(`${adapterKind} ${phase} context did not fail closed: ${JSON.stringify(lastResult)}`)
}

function expectedExitCode(options) {
  return options.expectedCode ?? 0
}

function exitCodeAccepted(options, code) {
  return options.expectedCodes?.includes(code) ?? (code === expectedExitCode(options))
}

function verificationScript(input) {
  const taskCreate = JSON.stringify({
    title: `CLI transport task ${input.adapterKind}`,
    description: 'Created through the canonical operation result contract.'
  })
  const campRead = (messageIdExpression) =>
    `jq -n --arg campId ${shellQuote(input.campId)} --arg messageId "${messageIdExpression}" '{mode:"item",campId:$campId,messageId:$messageId}'`
  const memoryWrite = JSON.stringify({
    action: 'add',
    scope: 'companion',
    kind: 'preference',
    body: `Remember that ${input.adapterKind} completed Built-in CLI transport v1 qualification.`,
    retrievalKeys: [`cli-${input.slug.slice(0, 18)}`]
  })
  const hearth = JSON.stringify({
    action: 'add',
    kind: 'lesson',
    body: `The ${input.adapterKind} Runtime can invoke Rovai built-ins only through the local CLI.`,
    retrievalKeys: [`hearth-${input.slug.slice(0, 14)}`]
  })
  const memberCall = JSON.stringify({
    recipient: input.recipientProfileId,
    content: `Acknowledge receipt of this ${input.adapterKind} Built-in CLI transport qualification request in one sentence.`
  })
  return `#!/bin/bash
set -euo pipefail

CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"
CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"
RUN_TMP="\${ROVAI_RUN_TMP:?ROVAI_RUN_TMP is required}"
JQ="$(command -v jq)"
DIAGNOSTIC=${shellQuote(input.diagnosticPath)}
STEP=bootstrap
exec 2>"$DIAGNOSTIC.stderr"
trap 'code=$?; printf "exit=%s step=%s line=%s\n" "$code" "$STEP" "$LINENO" > "$DIAGNOSTIC"; exit "$code"' EXIT
test -x "$CLI"
test -f "$CONTEXT"
test -d "$RUN_TMP"
test "$(stat -f '%Lp' "$CONTEXT")" = "600"
printf '%s\n' "$CONTEXT" > ${shellQuote(input.contextPathFile)}

assert_success() {
  local document="$1"
  local operation="$2"
  printf '%s\n' "$document" | "$JQ" -e --arg operation "$operation" '
    .contractVersion == 1
    and .ok == true
    and .operation == $operation
    and (.requestId | test("^[0-9a-f-]{36}$"))
    and (.receipt | test("^sha256:[0-9a-f]{64}$"))
    and ((.result | type) == "object")
    and (.result | has("task") | not)
    and (.result | has("rovaiTeamTool") | not)
    and (.result | has("rovaiTeamReceipt") | not)
    and (has("error") | not)
  ' >/dev/null
}

STEP=version
"$CLI" --version | grep -q 'contract-v1 ipc-v1'
STEP=catalog
catalog="$("$CLI" tool list)"
printf '%s\n' "$catalog" > "$DIAGNOSTIC.catalog"
catalog_digest="$(printf '%s\n' "$catalog" | "$JQ" -er '.catalogDigest')"
printf '%s\n' "$catalog" | "$JQ" -e --argjson expected '${JSON.stringify(expectedOperations)}' '
  .contractVersion == 1
  and (.catalogDigest | test("^sha256:[0-9a-f]{64}$"))
  and (([.operations[].name] | sort) == ($expected | sort))
' >/dev/null

STEP=describe
for operation in ${expectedOperations.map(shellQuote).join(' ')}; do
  description="$("$CLI" tool describe "$operation")"
  printf '%s\n' "$description" | "$JQ" -e --arg operation "$operation" --arg digest "$catalog_digest" '
    .contractVersion == 1
    and .catalogDigest == $digest
    and .name == $operation
    and ((.inputSchema | type) == "object")
    and ((.resultSchema | type) == "object")
    and .envelopeContract.version == 1
    and .envelopeContract.schema.properties.receipt.type == "string"
    and ((.errors | type) == "array")
  ' >/dev/null
done

cat > "$RUN_TMP/task-create.json" <<'ROVAI_JSON'
${taskCreate}
ROVAI_JSON
STEP=task_create
task_create="$("$CLI" task create --input-file "$RUN_TMP/task-create.json")"
assert_success "$task_create" 'team.create_task'
task_id="$(printf '%s\n' "$task_create" | "$JQ" -er '.result.taskId')"
task_version="$(printf '%s\n' "$task_create" | "$JQ" -er '.result.version')"

STEP=task_list
task_list="$("$CLI" task list <<'ROVAI_JSON'
{"statuses":["pending"],"limit":10}
ROVAI_JSON
)"
assert_success "$task_list" 'team.list_tasks'
printf '%s\n' "$task_list" | "$JQ" -e --arg taskId "$task_id" '.result.tasks | any(.id == $taskId)' >/dev/null

STEP=task_update
task_update="$("$CLI" task update --task-id "$task_id" --expected-version "$task_version" --status in_progress)"
assert_success "$task_update" 'team.update_task'
current_version="$(printf '%s\n' "$task_update" | "$JQ" -er '.result.version')"

STEP=task_conflict
set +e
stale_update="$("$CLI" task update --task-id "$task_id" --expected-version "$task_version" --title stale-overwrite 2>"$RUN_TMP/stale.err")"
stale_status=$?
set -e
test "$stale_status" -eq 1
printf '%s\n' "$stale_update" | "$JQ" -e --arg taskId "$task_id" --argjson currentVersion "$current_version" '
  .contractVersion == 1
  and .ok == false
  and .operation == "team.update_task"
  and (.receipt | test("^sha256:[0-9a-f]{64}$"))
  and .error.code == "task.version_conflict"
  and .error.recovery == "refresh_then_decide"
  and .error.details.taskId == $taskId
  and .error.details.currentVersion == $currentVersion
  and (has("result") | not)
' >/dev/null

STEP=camp_list
camp_list="$(printf '{}\n' | "$CLI" camp list)"
assert_success "$camp_list" 'camp.list'
printf '%s\n' "$camp_list" | "$JQ" -e --arg campId ${shellQuote(input.historyCampId)} '.result.camps | any(.campId == $campId)' >/dev/null

STEP=camp_search
camp_search="$("$CLI" camp search --query ${shellQuote(input.currentMarker)} --limit 5)"
assert_success "$camp_search" 'camp.search'
message_id="$(printf '%s\n' "$camp_search" | "$JQ" -er '.result.results[0].messageId')"
STEP=camp_read
${campRead('$message_id')} > "$RUN_TMP/camp-read.json"
camp_read="$("$CLI" camp read --input-file "$RUN_TMP/camp-read.json")"
assert_success "$camp_read" 'camp.read'
printf '%s\n' "$camp_read" | "$JQ" -e --arg messageId "$message_id" '.result.items[0].messageId == $messageId' >/dev/null

STEP=history_search
history_search="$("$CLI" history search --query ${shellQuote(input.historyMarker)} --limit 5)"
assert_success "$history_search" 'history.search'
printf '%s\n' "$history_search" | "$JQ" -e --arg campId ${shellQuote(input.historyCampId)} '.result.results | any(.campId == $campId)' >/dev/null

cat > "$RUN_TMP/memory-write.json" <<'ROVAI_JSON'
${memoryWrite}
ROVAI_JSON
STEP=memory_write
memory_write="$("$CLI" memory write --input-file "$RUN_TMP/memory-write.json")"
assert_success "$memory_write" 'memory.write'
memory_id="$(printf '%s\n' "$memory_write" | "$JQ" -er '.result.memoryId')"

STEP=memory_search
memory_search="$("$CLI" memory search --query ${shellQuote(`cli-${input.slug.slice(0, 18)}`)} --limit 6)"
assert_success "$memory_search" 'memory.search'
printf '%s\n' "$memory_search" | "$JQ" -e --arg memoryId "$memory_id" '.result.results | any(.memoryId == $memoryId)' >/dev/null

STEP=memory_read
memory_read_input="$("$JQ" -nc --arg memoryId "$memory_id" '{memoryIds:[$memoryId]}')"
memory_read="$(printf '%s\n' "$memory_read_input" | "$CLI" memory read)"
assert_success "$memory_read" 'memory.read'
printf '%s\n' "$memory_read" | "$JQ" -e --arg memoryId "$memory_id" '.result.memories | any(.memoryId == $memoryId and .cacheState == "current")' >/dev/null

cat > "$RUN_TMP/hearth.json" <<'ROVAI_JSON'
${hearth}
ROVAI_JSON
STEP=memory_propose_hearth
hearth_result="$("$CLI" memory propose-hearth --input-file "$RUN_TMP/hearth.json")"
assert_success "$hearth_result" 'memory.propose_hearth'
printf '%s\n' "$hearth_result" | "$JQ" -e '.result.status == "pending" and .result.effective == false' >/dev/null

cat > "$RUN_TMP/member-call.json" <<'ROVAI_JSON'
${memberCall}
ROVAI_JSON
STEP=member_call
member_call="$("$CLI" member call --input-file "$RUN_TMP/member-call.json")"
assert_success "$member_call" 'team.call_member'
printf '%s\n' "$member_call" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  .result.status == "accepted"
  and .result.recipient == $recipient
  and (.result.acceptanceReceiptId | type) == "string"
' >/dev/null

STEP=complete
trap - EXIT
printf '%s\n' ${shellQuote(JSON.stringify({
    ok: true,
    marker: input.successMarker,
    operationCount: 12,
    versionConflict: 'refresh_then_decide'
  }))}
`
}

function resumeVerificationScript(input) {
  return `#!/bin/bash
set -euo pipefail
CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"
CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"
printf '%s\n' "$CONTEXT" > ${shellQuote(input.resumeContextPathFile)}
catalog="$("$CLI" tool list)"
printf '%s\n' "$catalog" | jq -e '.contractVersion == 1 and (.operations | length) == 12' >/dev/null
description="$("$CLI" tool describe memory.write)"
printf '%s\n' "$description" | jq -e '.name == "memory.write" and .envelopeContract.version == 1' >/dev/null
camp_list="$(printf '{}\n' | "$CLI" camp list)"
printf '%s\n' "$camp_list" | jq -e '.ok == true and .operation == "camp.list"' >/dev/null
printf '%s\n' ${shellQuote(JSON.stringify({ ok: true, marker: input.resumeMarker, newLease: true }))}
`
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  const events = []
  const stderr = []
  let nextId = 1
  let stopping = false
  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    stderr.push(text)
    process.stderr.write(text)
  })
  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopping) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal}): ${stderr.slice(-10).join('')}`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`))
    else entry.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for Core method ${method}`))
    }, 180_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.exitCode !== null || child.killed) return
    stopping = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      delay(5_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop, events }
}

async function runCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      const result = { code, signal, stdout: stdout.join(''), stderr: stderr.join('') }
      if (exitCodeAccepted(options, code)) resolveRun(result)
      else rejectRun(new Error(`${command} exited ${code}: ${JSON.stringify(result)}`))
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
