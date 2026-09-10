import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, access, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { AutomationView, CoreMethod } from '@contracts'
import { EvaluationHostService } from './evaluation-host'
import { digest } from '../../../../packages/evaluation/src/daily'

// Synthetic worker result: proves Host ownership/lifecycle only, never Agent quality.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rovai-evaluation-host-test-')), source = join(root, 'source'), workspace = join(root, 'workspace')
  for (const path of ['scripts/lib', 'packages/evaluation', 'docs/contracts/schemas', 'docs/versions/v0.34/schemas', 'docs/versions/v0.36/schemas']) await mkdir(join(source, path), { recursive: true })
  await mkdir(workspace)
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'rovai-ai', type: 'module' }))
  await writeFile(join(source, 'pnpm-lock.yaml'), 'fixture: true')
  await copyFile(resolve('scripts/eval-host.mjs'), join(source, 'scripts/eval-host.mjs'))
  await copyFile(resolve('scripts/eval-wait.mjs'), join(source, 'scripts/eval-wait.mjs'))
  await writeFile(join(source, 'scripts/lib/context-weekly.mjs'), "export { runPlan as runWeekly } from './context-evaluation.mjs'\n")
  await writeFile(join(source, 'scripts/lib/context-evaluation.mjs'), `
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
export async function validatePlanInputs() {}
export async function buildProduct(source, directory) { await mkdir(directory); await writeFile(directory+'/product.json','{}'); return {core:directory+'/core'}; }
export async function freezePlan(config, output) { await writeFile(output, JSON.stringify({...config,planDigest:'fixture-plan'})); }
export async function runPlan(planFile, directory) {
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  await mkdir(directory, {recursive:true});
  if(plan.pause) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {detached:true, stdio:'ignore'});
    await writeFile(directory+'/fixture-child.pid', String(child.pid));
    await new Promise(resolve => child.on('exit', resolve));
  }
  await writeFile(directory+'/report.json', JSON.stringify({fixture:true, status:'insufficient'}));
  return {directory, report:{status:'insufficient', planDigest:plan.planDigest}};
}
`)
  let automation = { automationId: 'automation-1', enabled: true, projectRef: { kind: 'directory', path: workspace } } as AutomationView
  let runs: unknown[] = []
  const calls: string[] = []
  const service = new EvaluationHostService(join(root, 'owner'), { async request<T>(method: CoreMethod): Promise<T> {
    calls.push(method)
    if (method === 'automations.get') return automation as T
    if (method === 'automations.runs.list') return { runs, truncated: false, nextCursor: null } as T
    throw new Error('Unexpected Core request')
  } })
  async function plan(mode = 'weekly', extra = {}) {
    const payload = { schemaVersion: 1, mode, budget: { wallSeconds: 60 }, products: { candidate: { repository: source } }, suite: { path: 'fixture-suite' }, ...extra }
    const path = join(root, `${mode}-${Math.random()}.json`)
    await writeFile(path, JSON.stringify({ ...payload, planDigest: digest(payload) }))
    return path
  }
  return { root, source, workspace, service, calls, plan,
    setRuns(value: unknown[]) { runs = value }, disable() { automation = { ...automation, enabled: false } },
    async close() { await service.stop(); await rm(root, { recursive: true, force: true }) } }
}

it('does no Core queries or writes until configured; freezes installation and manual job identity independently of Gate verdict', async () => {
  const f = await fixture()
  try {
    await f.service.tick()
    expect(f.calls).toEqual([])
    await expect(access(join(f.root, 'owner'))).rejects.toThrow()
    await f.service.configure({ source: f.source, node: process.execPath })
    const params = { jobId: 'manual-1', plan: await f.plan('gate'), output: join(f.workspace, 'manual') }
    await expect(f.service.start({ ...params, command: 'arbitrary' }, 'gate')).rejects.toThrow('Unsupported')
    await f.service.start(params, 'gate')
    await expect.poll(async () => (await f.service.status({ jobId: params.jobId }) as { state: string }).state).toBe('completed')
    const result = await f.service.status({ jobId: params.jobId }) as { reportStatus: string }
    expect(result.reportStatus).toBe('insufficient')
    expect(await f.service.start(params, 'gate')).toEqual(await f.service.status({ jobId: params.jobId }))
    await expect(f.service.start({ ...params, output: join(f.workspace, 'other') }, 'gate')).rejects.toThrow('reused')
    await writeFile(join(f.source, 'scripts/lib/context-evaluation.mjs'), '// changed')
    await expect(f.service.start({ ...params, jobId: 'manual-2' }, 'gate')).rejects.toThrow('installation changed')
  } finally { await f.close() }
})

it('binds an existing Automation and consumes each accepted run once, exposing only the matching Camp receipt', async () => {
  const f = await fixture()
  try {
    await f.service.configure({ source: f.source, node: process.execPath })
    const plan = await f.plan(), output = join(f.workspace, 'reports')
    await expect(f.service.schedule({ automationId: 'automation-1', plan, output: join(f.root, 'outside') })).rejects.toThrow('inside')
    await f.service.schedule({ automationId: 'automation-1', plan, output })
    const now = new Date(Date.now() + 1000)
    f.setRuns([{ runId: 'auto-run-1', campId: 'camp-1', status: 'running', createdAt: now.toISOString() }])
    await f.service.tick(now)
    await expect.poll(async () => (await f.service.status({ jobId: 'auto-run-1' }) as { state: string }).state).toBe('completed')
    await f.service.tick(new Date(now.getTime() + 6000))
    const receipt = JSON.parse(await readFile(join(output, 'automation/camp-1.json'), 'utf8'))
    expect(receipt).toMatchObject({ jobId: 'auto-run-1', campId: 'camp-1', state: 'completed', reportStatus: 'insufficient' })
    expect(receipt).not.toHaveProperty('engine')
    await expect(access(join(output, 'automation/camp-2.json'))).rejects.toThrow()
    await expect(f.service.schedule({ automationId: 'automation-1', plan: await f.plan('weekly', { budget: { wallSeconds: 3000 } }), output })).rejects.toThrow('2700')
    const outside = join(f.root, 'external'); await mkdir(outside)
    await symlink(outside, join(f.workspace, 'escape'))
    await expect(f.service.schedule({ automationId: 'automation-1', plan, output: join(f.workspace, 'escape/reports') })).rejects.toThrow('inside')
  } finally { await f.close() }
})

it('stops the actual worker and its detached descendant on cancellation, retaining an interrupted attempt', async () => {
  const f = await fixture()
  try {
    await f.service.configure({ source: f.source, node: process.execPath })
    const output = join(f.workspace, 'long')
    await f.service.start({ jobId: 'cancel-1', plan: await f.plan('gate', { pause: true }), output }, 'gate')
    await expect.poll(async () => readFile(join(output, 'fixture-child.pid'), 'utf8').catch(() => null)).not.toBeNull()
    const pid = Number(await readFile(join(output, 'fixture-child.pid'), 'utf8'))
    await f.service.cancel({ jobId: 'cancel-1' })
    await expect.poll(async () => (await f.service.status({ jobId: 'cancel-1' }) as { state: string }).state, { timeout: 15000 }).toBe('interrupted')
    expect(() => process.kill(pid, 0)).toThrow()
    expect(await f.service.status({ jobId: 'cancel-1' })).toMatchObject({ reason: 'cancelled_by_owner', reportStatus: null })
  } finally { await f.close() }
}, 20000)

it('publishes configuration drift as a terminal failure and never relaunches a job after App restart', async () => {
  const f = await fixture()
  try {
    await f.service.configure({ source: f.source, node: process.execPath })
    const output = join(f.workspace, 'reports')
    await f.service.schedule({ automationId: 'automation-1', plan: await f.plan(), output })
    await writeFile(join(f.source, 'scripts/eval-wait.mjs'), '// changed')
    const now = new Date(Date.now() + 1000)
    f.setRuns([{ runId: 'drift-1', campId: 'camp-drift', status: 'running', createdAt: now.toISOString() }])
    await f.service.tick(now)
    expect(await f.service.status({ jobId: 'drift-1' })).toMatchObject({ state: 'failed', reportStatus: null })
    const jobFile = join(f.root, 'owner/evaluation/jobs/drift-1/job.json')
    const job = JSON.parse(await readFile(jobFile, 'utf8'))
    await writeFile(jobFile, JSON.stringify({ ...job, state: 'running' }))
    const restarted = new EvaluationHostService(join(f.root, 'owner'), { async request<T>(): Promise<T> { return null as T } })
    await restarted.tick(now)
    expect(await restarted.status({ jobId: 'drift-1' })).toMatchObject({ state: 'interrupted', reason: 'app_restarted' })
    await restarted.stop()
  } finally { await f.close() }
})
