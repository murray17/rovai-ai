// Explicitly authorized real-model acceptance. Each case owns a fresh Core,
// workspace, Skill library and MCP file. Native runtime login/config is reused.
import { chmod, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const repo = resolve(import.meta.dirname, '..')
const [root, ...specs] = process.argv.slice(2)
if (!root || !isAbsolute(root) || !specs.length) throw new Error('Usage: node scripts/smoke-native-subagents.mjs <new absolute output directory> <adapter:foreground|background|parallel[:sample]> ...')
const cases = specs.map(value => {
  const [kind, mode = 'foreground', sample = '1'] = value.split(':')
  if (!/^[a-z0-9-]+$/.test(kind) || !/^[a-z0-9-]+$/.test(sample) || !['foreground', 'background', 'parallel'].includes(mode)
    || ['cline-cli', 'cursor-agent'].includes(kind)) throw new Error(`Invalid case: ${value}`)
  return { kind, mode, id: `${kind}-${mode}-${sample}` }
})
if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('Duplicate case')
await mkdir(root, { mode: 0o700 }) // Never reuse or overwrite a previous campaign.
await mkdir(join(root, 'bin'), { mode: 0o700 })
await mkdir(join(root, 'cases'), { mode: 0o700 })
for (const name of ['rovai-core', 'rovai']) {
  await copyFile(join(repo, 'target/debug', name), join(root, 'bin', name))
  await chmod(join(root, 'bin', name), 0o700)
}
await cp(join(repo, 'skills'), join(root, 'bin/skills'), { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const build = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: repo })),
  binarySha256: hash(await readFile(join(root, 'bin/rovai-core')))
}
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 })
await save(join(root, 'build.json'), build)
for (const key of Object.keys(process.env)) if (key.startsWith('ROVAI_') || key === 'CLAUDECODE') delete process.env[key]

async function runCase(spec) {
  const dir = join(root, 'cases', spec.id), data = join(dir, 'user-data'), workspace = join(dir, 'workspace')
  const skillLibrary = join(data, 'managed-skill-library')
  await mkdir(skillLibrary, { recursive: true, mode: 0o700 })
  await mkdir(workspace, { mode: 0o700 })
  await writeFile(join(data, 'mcp.json'), '{}', { mode: 0o600 })
  await writeFile(join(workspace, 'fixture.txt'), 'ROVAI_READ_MARKER_7319\nSample color: amber.\n')
  execFileSync('git', ['init', '-q'], { cwd: workspace })
  const events = []
  let finish, deadline, threadId, installation, snapshot, error
  const terminal = new Promise(resolve => { finish = resolve })
  const started = Date.now()
  console.log(JSON.stringify({ case: spec.id, stage: 'starting', channel: 'automatic_acceptance', data, skillLibrary, workspace }))
  const core = startQualificationCore({ coreExecutable: join(root, 'bin/rovai-core'), dataDirectory: data,
    workingDirectory: repo, runtimeCacheDirectory: join(dir, 'cache'), mcpConfigPath: join(data, 'mcp.json'),
    onNotification(event) {
      events.push({ atMs: Date.now() - started, ...event })
      if (event.method === 'agent_run.terminal') finish(event)
    } })
  try {
    await core.request('health.check')
    await core.request('runtime.product.check', { runtimeKind: spec.kind })
    installation = (await core.request('runtime.installations.list')).find(item => item.adapterKind === spec.kind && item.installationClass === 'managed_default' && item.authScope === 'default')
    if (!installation?.memberRuntimeDefaults) throw new Error('No configured runtime installation')
    const member = await core.request('members.get', { agentId: 'agent_1' })
    const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: member.version, adapterKind: spec.kind,
      model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions
    } })
    if (configured.status !== 'applied') throw new Error('Runtime selection rejected')
    const workspaceView = await core.request('workspaces.inspect', { path: workspace })
    const count = spec.mode === 'parallel' ? 'exactly two independent native subagents concurrently' : 'exactly one native subagent'
    const mode = spec.mode === 'foreground' ? 'Use synchronous delegation when supported; wait for the report.'
      : spec.mode === 'background' ? 'Request background delegation when supported, write one short parent progress sentence after launch, then use the actual native report/wait tool. If unsupported, state that and use the supported mode.'
        : 'Dispatch both tasks before waiting for either, using actual native result/wait tools when needed.'
    const body = `This is an explicitly authorized read-only native subagent display acceptance in an isolated workspace. Start ${count} using native tools, not Rovai members or Missions. ${mode}
Give each child this exact work: Read only ${join(workspace, 'fixture.txt')} with exactly one native file-read or shell tool. Return CHILD_A_BEGIN (CHILD_B_BEGIN for the second), the file marker and color, and CHILD_A_END (CHILD_B_END). Do not write files, search the web, invoke other CLIs, delegate grandchildren, or publish Thread messages. Return through the native tool.
The parent must not read the fixture. If native delegation is unavailable, report NATIVE_SUBAGENT_UNAVAILABLE without installing or simulating tools. Preserve native behavior. After receiving the result, finish briefly with PARENT_DONE and publish the result as required by Session Charter. These native subagent calls are explicitly authorized.`
    const accepted = await createConfiguredCampAndSend(core.request, { commandId: randomUUID(), workspace: workspaceView,
      memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', name: spec.id, body, purpose: 'Native subagent display acceptance' })
    threadId = accepted.payload.threadId
    console.log(JSON.stringify({ case: spec.id, stage: 'running', version: installation.snapshot?.reportedVersion }))
    if (!await Promise.race([terminal, new Promise(resolve => { deadline = setTimeout(() => resolve(null), 240_000) })])) error = 'run_deadline'
    clearTimeout(deadline)
    // Passive observation only: never synthesize a continuation to get a report.
    if (spec.mode === 'background') await new Promise(resolve => setTimeout(resolve, 12_000))
    snapshot = await core.request('camps.snapshot', { campId: threadId })
    const execution = []
    for (const run of snapshot.agentRuns) {
      const evidence = [], contents = {}
      let afterSequence = 0
      for (let index = 0; index < 30; index++) {
        const page = await core.request('agentRunEvidence.list', { threadId, agentRunId: run.id, afterSequence, limit: 200 })
        evidence.push(...page.evidence)
        if (!page.hasMore) break
        afterSequence = page.nextAfterSequence
      }
      for (const item of evidence) if (item.isTruncated || item.outputTruncated) {
        contents[item.id] = await core.request('agentRunEvidence.getContent', { threadId, evidenceId: item.id })
      }
      const blocks = await core.request('agentRunExecution.page', { threadId, agentRunId: run.id, projection: 'blocks', limit: 200 })
      execution.push({ run, evidence, contents, blocks })
    }
    await save(join(dir, 'execution.json'), execution)
  } catch (caught) {
    error = String(caught.message)
  } finally {
    clearTimeout(deadline)
    await save(join(dir, 'events.json'), events)
    const stopped = await core.stop(10_000)
    await writeFile(join(dir, 'stderr-private.txt'), stopped.stderrTail, { mode: 0o600 })
    const summary = { ...spec, build, threadId, version: installation?.snapshot?.reportedVersion, error,
      runs: snapshot?.agentRuns.map(run => ({ id: run.id, status: run.status })),
      elapsedMs: Date.now() - started, coreStopped: { code: stopped.code, signal: stopped.signal } }
    await save(join(dir, 'summary.json'), summary)
    console.log(JSON.stringify({ case: spec.id, stage: 'finished', status: summary.runs?.map(run => run.status), error: Boolean(error), elapsedMs: summary.elapsedMs }))
  }
}
const queue = [...cases]
await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
  while (queue.length) await runCase(queue.shift())
}))
