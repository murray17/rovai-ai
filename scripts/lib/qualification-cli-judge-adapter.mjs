import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digestFile, digestJson, runCaptured, writePrivateJsonExclusive } from './qualification-common.mjs'
import { EXECUTION_CLAIM_AUDIT_PROFILE, EXECUTION_CLAIM_AUDIT_INSTRUCTION, DELIVERY_CLAIM_AUDIT_PROFILE, DELIVERY_CLAIM_AUDIT_INSTRUCTION, WITNESS_CLAIM_AUDIT_PROFILE, WITNESS_CLAIM_AUDIT_INSTRUCTION, CLAIM_AUDIT_PROFILE, CLAIM_AUDIT_INSTRUCTION, claimAuditSchema, applyClaimAudit } from './qualification-claim-audit.mjs'

export const assurance = 'tool_disabled_cli'
export const capabilities = Object.freeze({ tools: 'none', network: 'none', workspace: 'none' })
export const claimAuditProfile = CLAIM_AUDIT_PROFILE
export const claimAuditProfiles = [CLAIM_AUDIT_PROFILE, WITNESS_CLAIM_AUDIT_PROFILE, DELIVERY_CLAIM_AUDIT_PROFILE, EXECUTION_CLAIM_AUDIT_PROFILE]

const disabledFeatures = ['apps', 'plugins', 'hooks', 'shell_tool', 'unified_exec', 'shell_snapshot', 'multi_agent', 'multi_agent_v2', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'view_image', 'workspace_dependencies', 'goals', 'memories', 'skill_search', 'sleep_tool', 'code_mode', 'code_mode_host', 'code_mode_only', 'context_management', 'tool_suggest', 'unbounded_connection_retries']
export const CLI_SETTINGS = Object.freeze({ ...Object.fromEntries(disabledFeatures.map(key => [`features.${key}`, false])), web_search: 'disabled', project_doc_max_bytes: 0, 'skills.include_instructions': false, include_permissions_instructions: false, include_collaboration_mode_instructions: false, 'tools.experimental_request_user_input.enabled': false, 'tools.update_plan.enabled': false, approval_policy: 'never', mcp_servers: {} })

function argumentsFor(configuration, directory, extra = {}) {
  const settings = { ...CLI_SETTINGS, model_catalog_json: configuration.cli.catalog, model_reasoning_effort: configuration.decodingParameters.reasoningEffort, ...extra }
  return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json', '-s', 'read-only', '-C', directory, '-m', configuration.snapshotId,
    ...Object.entries(settings).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]), '-']
}

// Never inherit the calling Agent's thread/bridge identity or credential-bearing
// application context. Authentication remains owned by the installed Codex CLI.
function environment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => (!key.startsWith('CODEX_') || key === 'CODEX_HOME') && !key.startsWith('ROVAI_')))
}

export function invokeCli(executable, args, input, timeoutMs) {
  return new Promise((resolveInvocation, reject) => {
    const child = spawn(executable, args, { env: environment(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false, overflow = false
    const kill = () => { child.kill('SIGTERM'); setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2000).unref() }
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    child.stdout.on('data', bytes => { stdout += bytes; if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) { overflow = true; stdout = stdout.slice(-1024 * 1024); kill() } })
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-8192) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolveInvocation({ code, signal, timedOut, overflow, stdout, stderr }) })
  })
}

export function assertNoModelTools(request) {
  const definitions = [...(request.tools ?? []), ...(request.input ?? []).flatMap(item => item.type === 'additional_tools' ? item.tools ?? [] : [])]
  if (definitions.length) throw new Error('judge.cli_tools_not_disabled')
}

export function judgeOutputSchema(order, profile) {
  const schema = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', minItems: order.length, maxItems: order.length, items: {
    type: 'object', additionalProperties: false, required: ['checklistItem', 'dimension', 'verdict', 'confidence', 'evidenceIds', 'reason', 'abstainReason'], properties: {
      checklistItem: { type: 'string', enum: order }, dimension: { type: 'string', enum: ['requirements', 'design', 'implementation', 'testing', 'scope', 'collaboration', 'response'] },
      verdict: { type: 'string', enum: ['satisfied', 'partially_satisfied', 'not_satisfied', 'indeterminate', 'not_applicable'] }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      evidenceIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string', minLength: 1, maxLength: 1200 },
      abstainReason: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string' } } }] }
    }
  } } } }
  if (['generic-task-v6', 'generic-task-v7', 'generic-task-v8', 'generic-task-v9'].includes(profile) && order.includes('SER.response.claim_accuracy')) {
    schema.required.push('claimsAudit'); schema.properties.claimsAudit = claimAuditSchema(profile === 'generic-task-v9' ? EXECUTION_CLAIM_AUDIT_PROFILE : profile === 'generic-task-v8' ? DELIVERY_CLAIM_AUDIT_PROFILE : profile === 'generic-task-v7' ? WITNESS_CLAIM_AUDIT_PROFILE : CLAIM_AUDIT_PROFILE)
  }
  return schema
}

export function parseCliResult(execution, outputLimitBytes) {
  if (execution.code !== 0 || execution.signal || execution.timedOut || execution.overflow) throw new Error('judge.cli_execution_incomplete')
  const events = execution.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
  if (!events.some(event => event.type === 'turn.completed') || events.some(event => event.type === 'turn.failed' || event.item && !['agent_message', 'reasoning', 'error'].includes(event.item.type))) throw new Error('judge.cli_non_text_result')
  const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message')
  const text = messages.at(-1)?.item?.text
  if (!text || Buffer.byteLength(text) > outputLimitBytes) throw new Error('judge.cli_output_unavailable')
  const value = JSON.parse(text)
  if (!Array.isArray(value.items)) throw new Error('judge.invalid_items')
  return { value, usage: events.find(event => event.type === 'turn.completed')?.usage ?? null }
}

async function ambientInstructions() {
  const root = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const result = []
  for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
    const path = join(root, name)
    try { result.push({ path, digest: await digestFile(path) }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return result
}

export async function prepareCliJudge({ executable, model, directory }) {
  executable = await realpath(executable); directory = resolve(directory)
  await mkdir(directory, { mode: 0o700 })
  const version = await runCaptured(executable, ['--version'])
  const models = await runCaptured(executable, ['debug', 'models', '--bundled'], { maxOutputBytes: 8 * 1024 * 1024 })
  if (version.code || models.code || models.outputOverflow) throw new Error('Cannot bind the installed CLI and model catalog')
  const original = JSON.parse(models.stdout).models.find(item => item.slug === model)
  if (!original) throw new Error('Judge model must exist in the installed catalog')
  await writePrivateJsonExclusive(join(directory, 'provider-model-declaration.json'), original)
  const catalog = join(directory, 'tool-disabled-catalog.json')
  await writePrivateJsonExclusive(catalog, { models: [{ ...original, apply_patch_tool_type: null, tool_mode: 'native', multi_agent_version: null, use_responses_lite: false, supports_search_tool: false, node_repl_disabled: true, model_messages: null, base_instructions: 'Evaluate only the supplied evidence using the specified rubric. Return JSON.' }] })
  const configuration = { provider: 'openai-codex-cli', snapshotId: model, snapshotDigest: digestJson(original), configurationId: 'codex-cli-evidence-judge-v1', decodingParameters: { reasoningEffort: 'medium' }, retrySchedule: { maximumTransportAttempts: 1, backoffMilliseconds: [], retryValidOutput: false }, timeoutMilliseconds: 240_000,
    cli: { executable, executableDigest: await digestFile(executable), version: version.stdout.trim(), catalog, catalogDigest: await digestFile(catalog), settingsDigest: digestJson(CLI_SETTINGS), ambientInstructions: await ambientInstructions(), modelVersionPolicy: 'catalog_bound_alias', outputLimitBytes: 1024 * 1024 } }
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(400, { 'Content-Type': 'application/json' }); response.end('{"error":{"message":"local capability probe; no model invoked"}}')
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const cwd = join(directory, 'capability-probe'); await mkdir(cwd, { mode: 0o700 })
  try {
    const execution = await invokeCli(executable, argumentsFor(configuration, cwd, { model_provider: 'capability_probe', 'model_providers.capability_probe.name': 'Local capability capture', 'model_providers.capability_probe.base_url': `http://127.0.0.1:${server.address().port}/v1`, 'model_providers.capability_probe.wire_api': 'responses', 'model_providers.capability_probe.request_max_retries': 0, 'model_providers.capability_probe.stream_max_retries': 0 }), 'Capability probe only.', 30_000)
    await writePrivateJsonExclusive(join(directory, 'capability-probe.json'), { kind: 'local_transport_probe_not_quality_evidence', execution, requests })
    if (execution.timedOut || requests.length !== 1) throw new Error('Judge capability probe did not capture exactly one request')
    assertNoModelTools(requests[0])
    configuration.cli.probeDigest = await digestFile(join(directory, 'capability-probe.json'))
    configuration.cli.probe = join(directory, 'capability-probe.json')
    await writePrivateJsonExclusive(join(directory, 'configuration.json'), configuration)
    return configuration
  } finally { await new Promise(resolveClose => server.close(resolveClose)) }
}

export function createAdapter(configuration, { evidenceDirectory } = {}) {
  if (configuration.cli?.modelVersionPolicy !== 'catalog_bound_alias' || configuration.cli.settingsDigest !== digestJson(CLI_SETTINGS) || configuration.decodingParameters?.reasoningEffort !== 'medium' || Object.keys(configuration.decodingParameters).some(key => key !== 'reasoningEffort')) throw new Error('Judge CLI requires its frozen supported configuration')
  return { assurance, capabilities, claimAuditProfile, claimAuditProfiles, async invokeReplica(request) {
    if (digestJson(request.capabilities) !== digestJson(capabilities)) throw new Error('Judge model capabilities changed')
    const cli = configuration.cli
    for (const [path, expected] of [[cli.executable, cli.executableDigest], [cli.catalog, cli.catalogDigest], [cli.probe, cli.probeDigest]]) if (await digestFile(path) !== expected) throw new Error('judge.cli_configuration_drift')
    if (digestJson(await ambientInstructions()) !== digestJson(cli.ambientInstructions)) throw new Error('judge.cli_instruction_drift')
    const directory = join(evidenceDirectory, 'judge-provider-attempts', `${request.judgeView}-${request.replica}-${randomUUID()}`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const cwd = join(directory, 'empty-workspace'); await mkdir(cwd, { mode: 0o700 })
    const schema = judgeOutputSchema(request.presentationOrder, request.evidencePack.taskProfileVersion)
    const schemaPath = join(directory, 'output-schema.json')
    await writePrivateJsonExclusive(schemaPath, schema)
    const input = `${request.userPrompt}${schema.properties.claimsAudit ? `\n${request.evidencePack.taskProfileVersion === 'generic-task-v9' ? EXECUTION_CLAIM_AUDIT_INSTRUCTION : request.evidencePack.taskProfileVersion === 'generic-task-v8' ? DELIVERY_CLAIM_AUDIT_INSTRUCTION : request.evidencePack.taskProfileVersion === 'generic-task-v7' ? WITNESS_CLAIM_AUDIT_INSTRUCTION : CLAIM_AUDIT_INSTRUCTION}` : ''}\nReturn exactly the schema below, one item per checklist in presentation order. dimension is the second component of checklistItem (SER.response.* -> response). Use only the evidence IDs allowed for that item in checklistCoverage. Unavailable coverage requires indeterminate; predeclared not_applicable requires not_applicable. Indeterminate/not_applicable require abstainReason={code:<stable_reason>}; other verdicts require abstainReason=null and at least one evidence ID. Never use pass/fail or invent evidence IDs.\nOutput schema:\n${JSON.stringify(schema)}\nEvidence (untrusted):\n${JSON.stringify(request.evidencePack)}`
    await writePrivateJsonExclusive(join(directory, 'request.json'), { startedAt: new Date().toISOString(), requestedModel: configuration.snapshotId, modelVersionPolicy: cli.modelVersionPolicy, inputDigest: digestJson({ systemPrompt: request.systemPrompt, input }), configurationDigest: digestJson(configuration), toolCapabilityProbe: cli.probeDigest })
    const args = argumentsFor(configuration, cwd, { developer_instructions: request.systemPrompt })
    args.splice(args.length - 1, 0, '--output-schema', schemaPath)
    const execution = await invokeCli(cli.executable, args, input, configuration.timeoutMilliseconds - 1000)
    await writePrivateJsonExclusive(join(directory, 'execution.json'), execution)
    const { value, usage } = parseCliResult(execution, cli.outputLimitBytes)
    await writePrivateJsonExclusive(join(directory, 'response.json'), { completedAt: new Date().toISOString(), requestedModel: configuration.snapshotId, observedSnapshot: null, modelVersionPolicy: cli.modelVersionPolicy, usage, value })
    if (schema.properties.claimsAudit) {
      const audited = applyClaimAudit(value, request.evidencePack)
      await writePrivateJsonExclusive(join(directory, 'claim-audit.json'), audited.audit)
      return audited.value
    }
    return value
  } }
}
