import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const evidenceRoot = join(
  root,
  'docs',
  'versions',
  'v0.64',
  'evidence',
  'copilot-native-turn-reconciliation-2026-08-12'
)

test('Copilot Native Turn reconciliation P1 bundle is complete, safe, and digest-closed', async () => {
  const manifest = await readJson('manifest.json')
  assert.equal(manifest.experiment, 'copilot-native-turn-reconciliation')
  assert.equal(manifest.status, 'capability_not_proven')
  assert.equal(manifest.model, 'gpt-5.4')
  assert.deepEqual(manifest.hostBPolicy.outboundAllowlist, ['initialize', 'session/load'])
  assert.equal(manifest.hostBPolicy.promptForbidden, true)
  assert.deepEqual(manifest.safetyViolations, [])

  const files = (await readdir(evidenceRoot)).sort()
  const declared = manifest.artifacts.map((artifact) => artifact.file).sort()
  assert.deepEqual(files, [...declared, 'manifest.json'].sort())
  for (const artifact of manifest.artifacts) {
    const contents = await readFile(join(evidenceRoot, artifact.file))
    assert.equal(`sha256:${createHash('sha256').update(contents).digest('hex')}`, artifact.digest)
    if (artifact.file.endsWith('-ledger.jsonl')) assertRedacted(contents.toString('utf8'))
  }

  const preflight = await readJson('preflight.json')
  assert.equal(preflight.status, 'passed')
  assert.ok(Object.values(preflight.checks).every(Boolean))
  assert.equal(preflight.requestCounts['session/prompt'] ?? 0, 0)

  const expectedCases = [
    ['control', 1],
    ['control', 2],
    ['in_flight_kill', 1],
    ['in_flight_kill', 2],
    ['terminal_before_persist_kill', 1],
    ['terminal_before_persist_kill', 2]
  ]
  assert.deepEqual(
    manifest.caseSummary.map((entry) => [entry.case, entry.repetition]),
    expectedCases
  )

  for (const [caseName, repetition] of expectedCases) {
    const stem = `${caseName}-${repetition}`
    const artifact = await readJson(`${stem}.json`)
    assert.equal(artifact.providerTurnId, null)
    assert.deepEqual(artifact.providerTurnIdCandidates, [])
    assert.equal(artifact.observedState, 'ambiguous')
    assert.equal(artifact.terminalResultDigest, null)
    assert.equal(artifact.clientPromptRequestCount, 1)
    assert.equal(artifact.providerModelRequestCount, null)
    assert.equal(artifact.toolCallCount, 1)
    assert.equal(artifact.workspaceNonceCount, 1)
    assert.equal(artifact.hostA.promptRequestCount, 1)
    assert.equal(artifact.hostA.acceptedObserved, true)
    assert.equal(artifact.hostA.uniqueToolCallCount, 1)
    assert.equal(artifact.permissionProfile.approvedCommandCount, 1)
    assert.equal(artifact.permissionProfile.unexpectedPermissionRequestCount, 0)
    assert.equal(artifact.hostB.promptRequestCount, 0)
    assert.equal(artifact.hostB.permissionRequestCount, 0)
    assert.equal(artifact.hostB.sessionLoadCount, 2)
    assert.equal(artifact.hostB.lookupRequestCount, 0)
    assert.equal(artifact.hostB.attempts.length, 2)
    assert.ok(artifact.hostB.attempts.every((attempt) =>
      attempt.promptRequestCount === 0
      && attempt.permissionRequestCount === 0
      && attempt.sessionLoadCount === 1
      && attempt.requestCounts.initialize === 1
      && attempt.requestCounts['session/load'] === 1
      && Object.keys(attempt.requestCounts).length === 2
    ))
    assert.deepEqual(artifact.criterionResults, {
      stableProviderTurnId: false,
      machineReadableTurnState: false,
      terminalResultRereadByHostB: false,
      noHostBPrompt: true,
      noHostBExecutionRequest: true,
      idempotentReconcile: false,
      exactlyOneToolCall: true,
      exactlyOneWorkspaceSideEffect: true
    })
    assert.equal(artifact.verdict, 'capability_not_proven')

    if (caseName === 'control') {
      assert.equal(artifact.hostA.requestedStopSignal, 'SIGTERM')
      assert.equal(artifact.hostA.promptTerminalObserved, true)
      assert.equal(artifact.hostA.killedAt, null)
    } else if (caseName === 'in_flight_kill') {
      assert.equal(artifact.hostA.exitSignal, 'SIGKILL')
      assert.equal(artifact.hostA.promptTerminalObserved, false)
      assert.ok(artifact.hostB.attempts.every((attempt) => attempt.replayNotificationCount === 5))
    } else {
      assert.equal(artifact.hostA.exitSignal, 'SIGKILL')
      assert.equal(artifact.hostA.promptTerminalObserved, true)
      assert.ok(artifact.hostA.terminalResultDigest)
    }

    const ledgerText = await readFile(join(evidenceRoot, `${stem}-ledger.jsonl`), 'utf8')
    assertRedacted(ledgerText)
    const ledger = ledgerText.trim().split('\n').map((line) => JSON.parse(line))
    const hostAPrompt = ledger.find((entry) =>
      entry.host.includes('-host-a-setup-')
      && entry.direction === 'client_to_agent'
      && entry.message.method === 'session/prompt'
    )
    assert.ok(hostAPrompt)
    assert.ok(Date.parse(artifact.hostA.acceptedAt) >= Date.parse(hostAPrompt.at))
    const hostBRequests = ledger
      .filter((entry) => entry.host.includes('-host-b-') && entry.direction === 'client_to_agent')
      .map((entry) => entry.message.method)
    assert.ok(hostBRequests.every((method) => ['initialize', 'session/load'].includes(method)))
    assert.equal(hostBRequests.filter((method) => method === 'session/load').length, 2)
    assert.equal(hostBRequests.filter((method) => method === 'session/prompt').length, 0)

    const toolCallIds = new Set(ledger
      .map((entry) => entry.message?.params?.update?.toolCallId)
      .filter(Boolean))
    assert.equal(toolCallIds.size, 1)

    const hostBUpdates = ledger
      .filter((entry) => entry.host.includes('-host-b-'))
      .map((entry) => entry.message?.params?.update)
      .filter(Boolean)
    const hostAUpdates = ledger
      .filter((entry) => entry.host === hostAPrompt.host)
      .map((entry) => entry.message?.params?.update)
      .filter(Boolean)
    const replayedToolStatuses = new Set(hostBUpdates
      .filter((update) => ['tool_call', 'tool_call_update'].includes(update.sessionUpdate))
      .map((update) => update.status)
      .filter(Boolean))
    const replayedAgentText = hostBUpdates
      .filter((update) => update.sessionUpdate === 'agent_message_chunk')
      .map((update) => update.content?.text ?? '')
      .join('')
    if (caseName === 'in_flight_kill') {
      assert.deepEqual([...replayedToolStatuses], ['pending'])
      assert.doesNotMatch(replayedAgentText, /P1_DONE_/)
      assert.equal(hostAUpdates.some((update) =>
        update.sessionUpdate === 'tool_call_update'
        && ['completed', 'failed'].includes(update.status)
      ), false)
    } else if (caseName === 'control') {
      assert.ok(replayedToolStatuses.has('completed'))
      assert.match(replayedAgentText, /P1_DONE_/)
    } else {
      assert.ok(replayedToolStatuses.has('completed'))
      assert.doesNotMatch(replayedAgentText, /P1_DONE_/)
    }
    assert.equal(ledger.some((entry) =>
      entry.host.includes('-host-b-') && entry.message?.result?.stopReason
    ), false)
  }

  const excluded = await readJson('in_flight_kill-2-attempt-1-prompt-failure.json')
  assert.equal(excluded.workspaceNonceCount, 0)
  assert.deepEqual(excluded.approvedCommands, [])
  assert.equal(excluded.toolCallIds.length, 1)
  assert.equal(excluded.permissionViolations.length, 1)
  assert.equal(excluded.permissionViolations[0].reason, 'command did not match the one-shot allowlist')
  const secondInFlight = await readJson('in_flight_kill-2.json')
  assert.deepEqual(secondInFlight.excludedAttempts, [{
    sampleAttempt: 1,
    reason: 'rejected_command_mismatch_without_side_effect',
    evidenceFile: 'in_flight_kill-2-attempt-1-prompt-failure.json',
    workspaceNonceCount: 0
  }])
})

async function readJson(fileName) {
  return JSON.parse(await readFile(join(evidenceRoot, fileName), 'utf8'))
}

function assertRedacted(text) {
  assert.doesNotMatch(text, /\/var\/folders\/[^\s"']*rovai-copilot-turn-reconciliation/)
  assert.doesNotMatch(text, /\/private\/tmp\/rovai-p0-recovery-blocked/)
  assert.doesNotMatch(text, /Bearer\s+(?!\[REDACTED\])\S+/i)
  assert.doesNotMatch(text, /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/)
  assert.doesNotMatch(text, /"sessionId":"[0-9a-f]{8}-[0-9a-f-]{27,}"/i)
}
