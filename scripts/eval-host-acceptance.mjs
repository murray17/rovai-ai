// Explicit real-runtime acceptance. Not part of unit tests or daily App startup.
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildProduct, freezePlan } from './lib/context-evaluation.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { runCaptured, writePrivateJsonExclusive } from './lib/qualification-common.mjs'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--root' || args[2] !== '--config') throw new Error('Usage: node scripts/eval-host-acceptance.mjs --root <empty-absolute-root> --config <weekly-config.json>')
const root = resolve(args[1]), source = resolve(import.meta.dirname, '..')
if ((await readdir(root)).length) throw new Error('Acceptance root must exist and be empty')
const input = JSON.parse(await readFile(resolve(args[3]), 'utf8'))
// macOS owner IPC uses a Unix socket with a 104-byte pathname limit. Keep
// acceptance userData short; the durable isolation record names its exact path.
const data = await mkdtemp('/private/tmp/rovai-eval-host-'), workspace = join(root, 'analysis'), output = join(workspace, 'reports')
await mkdir(workspace, { mode: 0o700 })
await writePrivateJsonExclusive(join(root, 'isolation.json'), { channel: 'automatic_acceptance', dataDirectory: data, skillLibrary: join(data, 'managed-skill-library'), mcpConfig: join(data, 'mcp.json'), workspace, source, electronAppStarted: false, productionServices: ['UserAutomationServer', 'EvaluationHostService', 'Core Automation Scheduler', 'Qualification Runner'] })
const product = await buildProduct(source, join(root, 'product'))
const plan = join(root, 'weekly-plan.json')
await freezePlan({ ...input, mode: 'weekly', candidate: join(root, 'product/product.json'), budget: { wallSeconds: 2700 } }, plan)
await build({ stdin: { contents: `export {EvaluationHostService} from ${JSON.stringify(join(source, 'apps/desktop/src/main/evaluation-host.ts'))}; export {UserAutomationServer} from ${JSON.stringify(join(source, 'apps/desktop/src/main/user-automation.ts'))};`, resolveDir: source, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'host-services.mjs') })
const { EvaluationHostService, UserAutomationServer } = await import(pathToFileURL(join(root, 'host-services.mjs')).href)
const core = startQualificationCore({ coreExecutable: product.core, dataDirectory: data, workingDirectory: workspace, runtimeCacheDirectory: join(root, 'runtime-cache'), mcpConfigPath: join(data, 'mcp.json') })
const ownerRoot = join(data, 'automation-v1'), host = new EvaluationHostService(ownerRoot, core)
const server = new UserAutomationServer(ownerRoot, { core, evaluation: host, appVersion: 'evaluation-host-acceptance', openCamp: async campId => ({ campId, opened: true }) })
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms))
let lastSummary = null
async function cli(id, args, env = {}) {
  const execution = await runCaptured(product.cli, ['app', 'eval', ...args], { env: { ...process.env, ROVAI_APP_AUTOMATION_CONTEXT: server.contextPath, ...env }, timeoutMs: 60_000 })
  await writePrivateJsonExclusive(join(root, `${id}.json`), execution)
  if (execution.code !== 0) throw new Error(`Owner CLI ${id} failed: ${execution.stdout}`)
  return JSON.parse(execution.stdout)
}
try {
  await core.request('health.check', {}, 120_000)
  const member = input.team[0]
  await core.request('runtime.product.check', { runtimeKind: member.adapterKind }, 120_000)
  for (let i = 0; i < 90; i++) {
    const installations = await core.request('runtime.installations.list')
    if (installations.some(item => item.adapterKind === member.adapterKind && item.snapshot?.probeStatus === 'ready')) break
    if (i === 89) throw new Error('Configured Runtime did not become ready')
    await pause(1000)
  }
  const before = await core.request('members.get', { agentId: member.agentId })
  const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: { ...member, expectedVersion: before.version } }, 120_000)
  if (configured.status !== 'applied') throw new Error('Analysis member configuration failed')
  await server.start()
  await cli('configure', ['configure', '--source', source, '--node', process.execPath])
  const due = new Date(Date.now() + 120_000)
  const localDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
  const at = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
  const prompt = '本次是隔离评测运行。宿主会独立运行固定回归，请勿自行启动 Runner。先从当前上下文取得本 Camp 的 ID，然后执行 node reports/wait-for-evaluation.mjs --camp-id <当前CampID>。命令最多等待55分钟；必要时继续等待同一进程，不能用旧报告或自己编写评测结果。完成后读取回执 directory 中的 report.json，总结真实版本、12个独立Case、计划重复数、硬性通过/失败/未知、Judge状态和HTML报告路径。completed是执行结束，不等于Gate通过。失败或中断则说明原因。最终用公开消息交付本次结论，不修改产品、Case或评分。'
  const created = await core.request('automations.create', { commandId: randomUUID(), command: { name: '隔离每周回归验收', prompt, memberId: member.agentId, projectRef: { kind: 'directory', path: workspace }, schedule: { kind: 'once', date: localDate, at }, notifyChannels: [] } })
  const automationId = created.payload?.automationId
  if (!automationId) throw new Error('Automation creation returned no identity')
  await cli('schedule', ['schedule', '--automation-id', automationId, '--plan', plan, '--output', output])
  const start = new Date()
  await core.request('automations.schedulerControl', { epoch: 1, recoveryBoundary: start.toISOString(), paused: false })
  await writePrivateJsonExclusive(join(root, 'automation-definition.json'), await core.request('automations.get', { automationId }))
  const denied = await runCaptured(product.cli, ['app', 'eval', 'status'], { env: { ...process.env, ROVAI_CLI_CONTEXT: 'managed-boundary-check', ROVAI_APP_AUTOMATION_CONTEXT: server.contextPath } })
  await writePrivateJsonExclusive(join(root, 'managed-cli-denial.json'), denied)
  if (denied.code !== 2 || !denied.stdout.includes('unavailable_in_managed_runtime')) throw new Error('Managed CLI owner boundary failed')
  console.log(JSON.stringify({ stage: 'awaiting_real_schedule', automationId, due: { date: localDate, at }, root }))
  const deadline = Date.now() + 62 * 60_000
  while (Date.now() < deadline) {
    await core.request('automations.schedulerTick', { epoch: 1, now: new Date().toISOString() })
    await host.tick()
    const automation = await core.request('automations.get', { automationId })
    const run = automation.lastRun
    const job = run?.campId ? await host.status({ jobId: run.runId }).catch(() => null) : null
    const summary = { automation: run?.status ?? 'waiting', job: job?.state ?? null, reportStatus: job?.reportStatus ?? null }
    if (JSON.stringify(summary) !== lastSummary) { console.log(JSON.stringify(summary)); lastSummary = JSON.stringify(summary) }
    if (run && ['completed', 'failed', 'skipped'].includes(run.status)) {
      await writePrivateJsonExclusive(join(root, 'automation-result.json'), { automation, job, observedAt: new Date().toISOString() })
      if (run.campId) await writePrivateJsonExclusive(join(root, 'analysis-camp.json'), await core.request('camps.snapshot', { campId: run.campId }))
      console.log(JSON.stringify({ stage: 'finished', ...summary, root }))
      process.exitCode = run.status === 'completed' && job?.state === 'completed' ? 0 : 2
      break
    }
    await pause(1000)
  }
  if (!await readFile(join(root, 'automation-result.json')).catch(() => null)) throw new Error('Scheduled acceptance exceeded its time budget')
} finally {
  await host.stop()
  await server.stop()
  await writePrivateJsonExclusive(join(root, 'core-stop.json'), await core.stop())
}
