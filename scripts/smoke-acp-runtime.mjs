import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-acp-runtime-smoke-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const commandOutputOnly = process.env.ROVAI_ACP_COMMAND_OUTPUT_ONLY === '1'
const keepFixture = process.env.ROVAI_KEEP_ACP_RUNTIME_FIXTURE === '1'
const fullCommandOutputMatrix = process.env.ROVAI_ACP_FULL_COMMAND_MATRIX === '1'
const useProductPermissionDefaults = process.env.ROVAI_ACP_USE_PRODUCT_PERMISSION_DEFAULTS === '1'
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# ACP Runtime fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai ACP Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'acp-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDir),
    '--skill-library-root', join(dataDir, 'managed-skill-library')
  ], {
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
    if (!shuttingDown) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
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

  await request('health.check')
  const workspace = await request('workspaces.inspect', { path: projectRoot })
  let camp = null
  // This smoke exercises both read-only completion and an approved file write.
  // Use the starter coding companion so the AgentRun receives a write workspace;
  // an Approval may authorize a concrete action, but it must never widen a
  // read-only AgentRun into a writer.
  const agentId = 'agent_2'

  // Qualification deliberately opts into prompt-capable permission values so
  // the allow/deny matrix remains observable. Product memberRuntimeDefaults
  // use each Adapter's verified native maximum, including Kimi `yolo`.
  const specifications = [
    {
      adapterKind: 'opencode-cli',
      permissionValues: { permission: process.env.ROVAI_OPENCODE_PERMISSION ?? 'ask' },
      token: 'ROVAI_OPENCODE_ACP_OK'
    },
    {
      adapterKind: 'copilot-cli',
      permissionValues: { allow_all: process.env.ROVAI_COPILOT_ALLOW_ALL ?? 'off' },
      token: 'ROVAI_COPILOT_ACP_OK'
    },
    {
      adapterKind: 'kiro-cli',
      permissionValues: { trust_all_tools: process.env.ROVAI_KIRO_TRUST_ALL_TOOLS ?? 'off' },
      token: 'ROVAI_KIRO_ACP_OK'
    },
    {
      adapterKind: 'qoder-cli',
      permissionValues: { permission_mode: process.env.ROVAI_QODER_PERMISSION_MODE ?? 'default' },
      token: 'ROVAI_QODER_ACP_OK'
    },
    {
      adapterKind: 'codebuddy-cli',
      permissionValues: { permission_mode: process.env.ROVAI_CODEBUDDY_PERMISSION_MODE ?? 'default' },
      token: 'ROVAI_CODEBUDDY_ACP_OK'
    },
    {
      adapterKind: 'qwen-code',
      permissionValues: { approval_mode: process.env.ROVAI_QWEN_APPROVAL_MODE ?? 'default' },
      token: 'ROVAI_QWEN_ACP_OK'
    },
    {
      adapterKind: 'trae-cn-cli',
      permissionValues: { permission_mode: process.env.ROVAI_TRAE_PERMISSION_MODE ?? 'default' },
      token: 'ROVAI_TRAE_ACP_OK'
    },
    {
      adapterKind: 'kimi-code-cli',
      permissionValues: { permission_mode: process.env.ROVAI_KIMI_PERMISSION_MODE ?? 'default' },
      token: 'ROVAI_KIMI_ACP_OK'
    }
  ].filter((specification) => !process.env.ROVAI_ACP_SMOKE_ADAPTER || specification.adapterKind === process.env.ROVAI_ACP_SMOKE_ADAPTER)
  const results = []
  for (const specification of specifications) {
    const installation = await configureProductRuntime(
      request,
      specification.adapterKind,
      [agentId]
    )
    const executionDeferred = specification.adapterKind === 'trae-cn-cli'
      && installation?.snapshot?.probeStatus === 'installed_unverified'
    if (!executionDeferred
        && (installation?.snapshot?.probeStatus !== 'ready' || !installation.snapshot.models.length)) {
      throw new Error(`Capability snapshot is not ready: ${JSON.stringify(installation)}`)
    }
    const permissionValues = useProductPermissionDefaults
      ? installation.memberRuntimeDefaults?.permissions?.values
      : specification.permissionValues
    if (!permissionValues || typeof permissionValues !== 'object' || Array.isArray(permissionValues)) {
      throw new Error(`ACP smoke has no Product permission defaults: ${JSON.stringify({
        adapterKind: specification.adapterKind,
        memberRuntimeDefaults: installation.memberRuntimeDefaults
      })}`)
    }

    let profile = await request('members.get', { agentId })
    const explicitModelId = specification.adapterKind === 'codebuddy-cli'
      ? process.env.ROVAI_CODEBUDDY_MODEL?.trim()
      : null
    const permissionsConfigured = await request('members.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentId: profile.agentId,
        expectedVersion: profile.version,
        adapterKind: specification.adapterKind,
        model: explicitModelId
          ? { mode: 'explicit', modelId: explicitModelId, options: {} }
          : profile.runtimeConfiguration.model,
        permissions: {
          adapterKind: specification.adapterKind,
          schemaVersion: installation.snapshot.permissionSchemaVersion,
          values: permissionValues
        }
      }
    })
    if (permissionsConfigured.status !== 'applied') {
      throw new Error(`ACP smoke permissions were rejected: ${JSON.stringify({
        adapterKind: specification.adapterKind,
        permissionsConfigured
      })}`)
    }
    profile = await request('members.get', { agentId })
    if (explicitModelId
        && profile.runtimeConfiguration?.model?.modelId !== explicitModelId) {
      throw new Error(`ACP smoke model override drifted: ${JSON.stringify({
        adapterKind: specification.adapterKind,
        expected: explicitModelId,
        actual: profile.runtimeConfiguration?.model
      })}`)
    }
    if (JSON.stringify(profile.runtimeConfiguration?.permissions?.values)
        !== JSON.stringify(permissionValues)) {
      throw new Error(`ACP smoke permissions drifted: ${JSON.stringify({
        adapterKind: specification.adapterKind,
        expected: permissionValues,
        actual: profile.runtimeConfiguration?.permissions
      })}`)
    }
    const body = `Do not call tools or inspect files. Reply with exactly ${specification.token} and nothing else.`
    const purpose = `Verify the ${specification.adapterKind} ACP execution path without tools`
    const sent = camp
      ? await sendExistingCampMessage(request, camp.id, body, {
          taskId: null,
          purpose,
          completionRole: 'required'
        })
      : await createConfiguredCampAndSend(request, {
          commandId: crypto.randomUUID(),
          workspace,
          body,
          address: { mode: 'explicit', agentIds: [profile.agentId] },
          purpose
        })
    const commandResult = sent.commandResult ?? sent
    const campId = camp?.id ?? commandResult.payload?.campId
    const agentRunId = commandResult.payload?.agentRunIds?.[0]
    if (commandResult.status !== 'accepted' || !campId || !agentRunId) {
      throw new Error(`AgentRun intake failed: ${JSON.stringify(sent)}`)
    }
    if (!camp) {
      camp = { id: campId, defaultLeadAgentId: profile.agentId }
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
    let verifiedInstallation = installation
    if (executionDeferred) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        verifiedInstallation = (await request('runtime.installations.list')).find((candidate) =>
          candidate.id === installation.id
        )
        if (verifiedInstallation?.snapshot?.probeStatus === 'ready'
            && verifiedInstallation.snapshot.models.length) break
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
      if (verifiedInstallation?.snapshot?.probeStatus !== 'ready'
          || !verifiedInstallation.snapshot.models.length) {
        throw new Error(`TRAE execution did not persist a Ready snapshot: ${JSON.stringify(verifiedInstallation)}`)
      }
    }
    results.push({
      adapterKind: specification.adapterKind,
      version: verifiedInstallation.snapshot.reportedVersion,
      modelCount: verifiedInstallation.snapshot.models.length,
      model: start.params.modelId,
      hostInstanceId: start.params.hostInstanceId,
      nativeSessionId: start.params.nativeThreadId,
      output: output.body
    })

    if (specifications.some(({ adapterKind }) => adapterKind === specification.adapterKind)) {
      const commandMarker = `ROVAI_${specification.adapterKind.replaceAll('-', '_').toUpperCase()}_PRINTF_OK`
      const commandRequest = await sendExistingCampMessage(
        request,
        camp.id,
        `Use the Bash or terminal tool exactly once to run this cross-platform command without changing files: echo ${commandMarker}. Do not call any other tool. Then immediately reply exactly ACP_COMMAND_OUTPUT_OK.`,
        {
          taskId: null,
          purpose: 'Verify fixed command output enters Runtime Evidence',
          completionRole: 'required'
        }
      )
      const commandRunId = commandRequest.commandResult?.payload?.agentRunIds?.[0]
      if (!commandRunId) throw new Error(`ACP command-output AgentRun was not accepted: ${JSON.stringify(commandRequest)}`)
      const commandApprovals = new Set()
      const commandDeadline = Date.now() + 180_000
      let commandSnapshot
      let commandRun
      while (Date.now() < commandDeadline) {
        commandSnapshot = await request('camps.snapshot', { campId: camp.id })
        for (const approval of commandSnapshot.approvals.filter((candidate) =>
          candidate.status === 'pending'
            && !commandApprovals.has(candidate.id)
            && commandSnapshot.actions.some((action) => action.id === candidate.actionId && action.agentRunId === commandRunId)
        )) {
          const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
            ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
          if (!option) throw new Error(`ACP command-output request has no exact allow option: ${JSON.stringify(approval)}`)
          const resolution = await request('action.approvals.resolve', {
            commandId: crypto.randomUUID(),
            campId: camp.id,
            approvalId: approval.id,
            expectedVersion: approval.version,
            optionId: option.optionId,
            reason: 'ACP fixed command output smoke test'
          })
          if (resolution.status === 'rejected') throw new Error(`ACP command-output approval was rejected: ${JSON.stringify(resolution)}`)
          commandApprovals.add(approval.id)
        }
        commandRun = commandSnapshot.agentRuns.find((value) => value.id === commandRunId)
        if (commandRun?.status === 'succeeded') break
        if (commandRun?.status === 'failed' || commandRun?.status === 'cancelled') {
          throw new Error(`${specification.adapterKind} command-output AgentRun entered ${commandRun.status}: ${JSON.stringify({
            commandRun,
            actions: commandSnapshot.actions.filter((action) => action.agentRunId === commandRunId),
            events: events.filter((event) => event.params?.agentRunId === commandRunId).slice(-30)
          })}`)
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
      const commandRuntimeActions = events.filter((event) =>
        event.method === 'runtime.action' && event.params?.agentRunId === commandRunId
      )
      const commandOutputEvent = commandRuntimeActions.find((event) => {
        const output = String(event.params?.payload?.output ?? '')
        const presentation = String(event.params?.canonical?.presentationHint ?? '')
        const markerObserved = output.includes(commandMarker) || presentation.includes(commandMarker)
        const canonical = event.params?.canonical
        return markerObserved && (canonical
          ? canonical.phase === 'terminal' && canonical.outcome === 'succeeded'
          : !/exit code [1-9]\d*/i.test(output))
      })
      const commandStart = events.find((event) =>
        event.method === 'agent_run.started' && event.params?.agentRunId === commandRunId
      )
      if (commandRun?.status !== 'succeeded'
          || !commandOutputEvent
          || commandStart?.params?.nativeThreadId !== results.at(-1).nativeSessionId) {
        throw new Error(`${specification.adapterKind} fixed printf output was not projected: ${JSON.stringify({
          commandRun,
          commandStart,
          marker: commandMarker,
          runtimeActions: commandRuntimeActions
        })}`)
      }
      if (specification.adapterKind === 'kimi-code-cli'
          && permissionValues.permission_mode === 'yolo'
          && commandApprovals.size !== 0) {
        throw new Error(`Kimi yolo command unexpectedly required interactive Approval: ${JSON.stringify({
          approvalCount: commandApprovals.size,
          permissionValues
        })}`)
      }
      results.at(-1).commandOutput = {
        marker: commandMarker,
        output: commandOutputEvent.params.payload.output
          ?? commandOutputEvent.params.canonical?.presentationHint,
        outcome: commandOutputEvent.params.canonical?.outcome ?? 'observed',
        rawOutputDigest: commandOutputEvent.params.payload.rawOutputDigest ?? null,
        approvalCount: commandApprovals.size,
        nativeSessionContinued: commandStart.params.nativeThreadId === results.at(-1).nativeSessionId,
        warmHostReused: commandStart.params.hostInstanceId === results.at(-1).hostInstanceId,
        hostInstanceId: commandStart.params.hostInstanceId
      }
      if (fullCommandOutputMatrix) {
        results.at(-1).commandOutputMatrix = await runCommandOutputMatrix({
          request,
          events,
          campId: camp.id,
          adapterKind: specification.adapterKind
        })
      }
      if (commandOutputOnly) continue

      const writeToken = 'ROVAI_ACP_APPROVED_WRITE'
      const adapterFileStem = ({
        'opencode-cli': 'OPENCODE',
        'copilot-cli': 'COPILOT',
        'kiro-cli': 'KIRO',
        'qoder-cli': 'QODER',
        'codebuddy-cli': 'CODEBUDDY',
        'qwen-code': 'QWEN',
        'trae-cn-cli': 'TRAE',
        'kimi-code-cli': 'KIMI'
      })[specification.adapterKind]
      const writePath = join(projectRoot, `ACP_APPROVED_${adapterFileStem}.txt`)
      if (specification.adapterKind === 'codebuddy-cli') {
        // CodeBuddy's DeepSeek provider expresses Edit as an update-only patch.
        // Seed an empty target so this case still verifies one mediated write;
        // the denial case below continues to use a missing path.
        await writeFile(writePath, '')
      }
      const writeBody = specification.adapterKind === 'kimi-code-cli'
        ? `Use the Bash tool exactly once to run this command and do not use any other tool: printf '%s\\n' '${writeToken}' > '${writePath}'. Then immediately reply exactly ACP_WRITE_OK.`
        : specification.adapterKind === 'codebuddy-cli'
          ? `Use the terminal tool exactly once to run this command: powershell.exe -NoProfile -Command "Set-Content -LiteralPath '${writePath}' -Value '${writeToken}'". Do not call any other tool before or after it. Then immediately reply exactly ACP_WRITE_OK.`
          : specification.adapterKind === 'qwen-code'
            ? `Use the terminal tool exactly once to run this Windows shell built-in command: echo ${writeToken}> "${writePath}". Do not call any other tool before or after it. Then immediately reply exactly ACP_WRITE_OK.`
            : `Use the file editing tool exactly once to create ${writePath} with exactly ${writeToken} and a trailing newline. Do not call shell, list, read, or any verification tool before or after the edit. Then immediately reply exactly ACP_WRITE_OK.`
      const writeRequest = await sendExistingCampMessage(
        request,
        camp.id,
        writeBody,
        {
          taskId: null,
          purpose: 'Verify ACP permission mediation and one-time file write authorization',
          completionRole: 'required'
        }
      )
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
          const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
            ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
          if (!option) throw new Error(`ACP request has no exact allow option: ${JSON.stringify(approval)}`)
          const resolution = await request('action.approvals.resolve', {
            commandId: crypto.randomUUID(),
            campId: camp.id,
            approvalId: approval.id,
            expectedVersion: approval.version,
            optionId: option.optionId,
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
      const immediatelyPreviousHostInstanceId = commandStart?.params?.hostInstanceId
        ?? results.at(-1).hostInstanceId
      const written = await readFile(writePath, 'utf8').catch((error) => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      const writtenMatches = written === `${writeToken}\n`
        || (process.platform === 'win32' && written === `${writeToken}\r\n`)
      const requiresNativeSessionContinuation = true
      if (writeRun?.status !== 'succeeded'
          || !writtenMatches
          || !writeActions.some((action) => action.status === 'succeeded')
          || (requiresNativeSessionContinuation
            && writeStart?.params?.nativeThreadId !== results.at(-1).nativeSessionId)
          || (['trae-cn-cli', 'kimi-code-cli'].includes(specification.adapterKind)
            && writeStart?.params?.hostInstanceId !== immediatelyPreviousHostInstanceId)) {
        throw new Error(`ACP approved write did not converge: ${JSON.stringify({
          writeRun,
          writeActions,
          writeStart,
          expectedHostInstanceId: immediatelyPreviousHostInstanceId,
          expectedNativeSessionId: results.at(-1).nativeSessionId,
          written,
          hostLogs: events.filter((event) => event.method === 'runtime.host.log').slice(-30),
          events: events.filter((event) =>
            event.params?.agentRunId === writeRunId && event.method !== 'runtime.event'
          ).slice(-30)
        })}`)
      }
      if (specification.adapterKind === 'kimi-code-cli'
          && permissionValues.permission_mode === 'yolo'
          && resolvedApprovals.size !== 0) {
        throw new Error(`Kimi yolo write unexpectedly required interactive Approval: ${JSON.stringify({
          approvalCount: resolvedApprovals.size,
          permissionValues
        })}`)
      }
      results.at(-1).approval = {
        resolved: resolvedApprovals.size,
        actionKinds: writeActions.map((action) => action.actionKind),
        nativeSessionContinued: writeStart?.params?.nativeThreadId === results.at(-1).nativeSessionId,
        continuationStrategy: requiresNativeSessionContinuation ? 'native_session' : 'new_only',
        warmHostReused: writeStart?.params?.hostInstanceId === immediatelyPreviousHostInstanceId,
        written
      }

      const approvalExpected = permissionValues.permission === 'ask'
        || permissionValues.allow_all === 'off'
        || permissionValues.trust_all_tools === 'off'
        || permissionValues.permission_mode === 'default'
        || permissionValues.approval_mode === 'default'
      if (approvalExpected) {
        // Keep the requested content semantically neutral. Some Runtime models
        // interpret a file or payload literally named DENIED as an instruction
        // not to issue the tool request, which bypasses the approval boundary
        // this branch is intended to exercise. Core still performs the denial.
        const deniedWriteToken = 'ROVAI_ACP_SECOND_WRITE'
        const deniedPath = join(projectRoot, `ACP_SECOND_${adapterFileStem}.txt`)
        const deniedBody = specification.adapterKind === 'kimi-code-cli'
          ? `Use the Bash tool exactly once to run this command and do not use any other tool: touch '${deniedPath}'. Do not simulate or explain the tool call. Then briefly report the concrete result.`
          : specification.adapterKind === 'trae-cn-cli'
            ? `Use the Bash tool exactly once to run this command and do not use any other tool: printf '${deniedWriteToken}\\n' > '${deniedPath}'. Do not simulate or explain the tool call. Then immediately reply exactly ACP_SECOND_WRITE_OK.`
            : specification.adapterKind === 'codebuddy-cli'
              ? `Use the terminal tool exactly once to run this command: powershell.exe -NoProfile -Command "Set-Content -LiteralPath '${deniedPath}' -Value '${deniedWriteToken}'". Do not call any other tool. Then immediately reply exactly ACP_SECOND_WRITE_OK.`
              : specification.adapterKind === 'qwen-code'
                ? `Use the terminal tool exactly once to run this Windows shell built-in command: echo ${deniedWriteToken}> "${deniedPath}". Do not call any other tool. Then immediately reply exactly ACP_SECOND_WRITE_OK.`
                : `Use the file editing tool exactly once to create ${deniedPath} with exactly ${deniedWriteToken} and a trailing newline. Do not call shell, list, read, or any verification tool before or after the edit. Then immediately reply exactly ACP_SECOND_WRITE_OK.`
        const deniedRequest = specification.adapterKind === 'kimi-code-cli'
          ? await createConfiguredCampAndSend(request, {
              commandId: crypto.randomUUID(),
              name: 'Kimi ACP denial isolation',
              workspace,
              body: deniedBody,
              address: { mode: 'explicit', agentIds: [agentId] },
              purpose: 'Create the requested file and report the concrete result'
            })
          : await sendExistingCampMessage(
              request,
              camp.id,
              deniedBody,
              {
                taskId: null,
                purpose: 'Create the requested file and report the concrete result',
                completionRole: 'required'
              }
            )
        const deniedCampId = deniedRequest.commandResult?.payload?.campId
          ?? deniedRequest.payload?.campId
          ?? camp.id
        const deniedRunId = deniedRequest.commandResult?.payload?.agentRunIds?.[0]
          ?? deniedRequest.payload?.agentRunIds?.[0]
        if (!deniedRunId) throw new Error(`ACP denied AgentRun was not accepted: ${JSON.stringify(deniedRequest)}`)
        const deniedApprovals = new Set()
        const deniedDeadline = Date.now() + 180_000
        let deniedSnapshot
        let deniedRun
        while (Date.now() < deniedDeadline) {
          deniedSnapshot = await request('camps.snapshot', { campId: deniedCampId })
          for (const approval of deniedSnapshot.approvals.filter((candidate) =>
            candidate.status === 'pending'
              && !deniedApprovals.has(candidate.id)
              && deniedSnapshot.actions.some((action) => action.id === candidate.actionId && action.agentRunId === deniedRunId)
          )) {
            const option = approval.options.find((candidate) => candidate.kind === 'cancel')
              ?? approval.options.find((candidate) => candidate.kind === 'deny')
            if (!option) throw new Error(`ACP request has no exact safe option: ${JSON.stringify(approval)}`)
            const resolution = await request('action.approvals.resolve', {
              commandId: crypto.randomUUID(),
              campId: deniedCampId,
              approvalId: approval.id,
              expectedVersion: approval.version,
              optionId: option.optionId,
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
        const explicitDenial = deniedApprovals.size > 0
          && deniedActions.some((action) => action.status === 'not_executed')
        const refusedBeforeTool = deniedApprovals.size === 0 && deniedActions.length === 0
        if (!deniedRun
            || !['succeeded', 'failed'].includes(deniedRun.status)
            || deniedFileExists
            || (!explicitDenial && !refusedBeforeTool)) {
          throw new Error(`ACP denial did not fail closed: ${JSON.stringify({ deniedRun, deniedActions, deniedApprovals: deniedApprovals.size, deniedFileExists })}`)
        }
        results.at(-1).denial = {
          path: explicitDenial ? 'rovai_approval_denied' : 'runtime_refused_before_tool',
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
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  if (!keepFixture) await rm(fixtureRoot, { recursive: true, force: true })
}

async function sendExistingCampMessage(request, campId, body, execution) {
  const draft = await request('camp.composerDraft.get', { campId })
  const saved = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: draft.revision,
    content: [{ kind: 'text', text: body }]
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: saved.revision,
    execution
  })
}

async function runCommandOutputMatrix({ request, events, campId, adapterKind }) {
  const stem = adapterKind.replaceAll('-', '_').toUpperCase()
  const cases = [
    {
      name: 'stdout',
      command: `printf '%s\\n' 'ROVAI_${stem}_STDOUT_OK'`,
      status: 'completed',
      markers: [`ROVAI_${stem}_STDOUT_OK`]
    },
    {
      name: 'stderr',
      command: `printf '%s\\n' 'ROVAI_${stem}_STDERR_OK' >&2`,
      status: 'completed',
      markers: [`ROVAI_${stem}_STDERR_OK`]
    },
    {
      name: 'mixed',
      command: `printf '%s\\n' 'ROVAI_${stem}_MIXED_STDOUT_OK'; printf '%s\\n' 'ROVAI_${stem}_MIXED_STDERR_OK' >&2`,
      status: 'completed',
      markers: [`ROVAI_${stem}_MIXED_STDOUT_OK`, `ROVAI_${stem}_MIXED_STDERR_OK`]
    },
    {
      name: 'empty',
      command: ':',
      status: 'completed',
      markers: []
    },
    {
      name: 'nonzero',
      command: `printf '%s\\n' 'ROVAI_${stem}_NONZERO_OK' >&2; exit 7`,
      status: 'failed',
      markers: [`ROVAI_${stem}_NONZERO_OK`]
    },
    {
      name: 'large',
      command: `printf '%s\\n' 'ROVAI_${stem}_LARGE_BEGIN'; /usr/bin/yes '0123456789abcdef' | /usr/bin/head -c 131072`,
      status: 'completed',
      markers: [`ROVAI_${stem}_LARGE_BEGIN`]
    }
  ]
  const results = []
  for (const specification of cases) {
    const sent = await sendExistingCampMessage(
      request,
      campId,
      [
        'Use the Bash or terminal tool exactly once to run the following command verbatim.',
        'Do not call any other tool and do not alter the command.',
        specification.command,
        'After the tool reaches a terminal state, briefly report that it finished.'
      ].join('\n'),
      {
        taskId: null,
        purpose: `Verify ACP ${specification.name} command-output behavior`,
        completionRole: 'required'
      }
    )
    const runId = sent.commandResult?.payload?.agentRunIds?.[0]
    if (!runId) throw new Error(`ACP ${specification.name} matrix Run was not accepted: ${JSON.stringify(sent)}`)
    const resolvedApprovals = new Set()
    const deadline = Date.now() + 180_000
    let snapshot
    let run
    while (Date.now() < deadline) {
      snapshot = await request('camps.snapshot', { campId })
      const actionIds = new Set(snapshot.actions
        .filter((action) => action.agentRunId === runId)
        .map((action) => action.id))
      for (const approval of snapshot.approvals.filter((candidate) =>
        candidate.status === 'pending'
          && actionIds.has(candidate.actionId)
          && !resolvedApprovals.has(candidate.id)
      )) {
        const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
          ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
        if (!option) throw new Error(`ACP ${specification.name} request has no bounded allow option`)
        const resolution = await request('action.approvals.resolve', {
          commandId: crypto.randomUUID(),
          campId,
          approvalId: approval.id,
          expectedVersion: approval.version,
          optionId: option.optionId,
          reason: `ACP ${specification.name} output matrix`
        })
        if (resolution.status === 'rejected') {
          throw new Error(`ACP ${specification.name} approval was rejected: ${JSON.stringify(resolution)}`)
        }
        resolvedApprovals.add(approval.id)
      }
      run = snapshot.agentRuns.find((candidate) => candidate.id === runId)
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) break
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    const actionEvents = events.filter((event) =>
      event.method === 'runtime.action' && event.params?.agentRunId === runId
    )
    const toolCallIds = new Set(actionEvents
      .map((event) => event.params?.payload?.toolCallId)
      .filter((value) => typeof value === 'string' && value.length > 0))
    const terminal = actionEvents.find((event) =>
      event.params?.canonical?.phase === 'terminal'
        && event.params?.payload?.status === specification.status
    )
    const output = String(terminal?.params?.payload?.output ?? '')
    const input = String(terminal?.params?.payload?.input ?? '')
    if (!run
        || !['succeeded', 'failed'].includes(run.status)
        || toolCallIds.size !== 1
        || !terminal
        || !input.includes(specification.command)
        || !specification.markers.every((marker) => output.includes(marker))) {
      throw new Error(`ACP ${specification.name} output matrix failed: ${JSON.stringify({
        run,
        expectedStatus: specification.status,
        expectedMarkers: specification.markers,
        toolCallIds: [...toolCallIds],
        actionEvents
      })}`)
    }
    results.push({
      name: specification.name,
      runStatus: run.status,
      toolStatus: terminal.params.payload.status,
      toolCallId: [...toolCallIds][0],
      approvalCount: resolvedApprovals.size,
      outputBytes: Buffer.byteLength(output)
    })
  }
  return results
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
