import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, rename, readdir, realpath, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AutomationRunListPage, AutomationView, CoreMethod } from '@contracts'
import { digest } from '../../../../packages/evaluation/src/daily'

type Core = { request<T>(method: CoreMethod, params?: unknown): Promise<T> }
type Engine = { source: string; node: string; nodeDigest: string; sourceDigest: string }
type Binding = { automationId: string; automationVersion: number; workspace: string; output: string; plan: string; planDigest: string; registeredAt: string }
type Job = {
  schemaVersion: 1; jobId: string; mode: 'gate' | 'weekly'; plan: string; planDigest: string; output: string
  automationId: string | null; campId: string | null; createdAt: string; endedAt: string | null
  state: 'running' | 'completed' | 'failed' | 'interrupted'; reportStatus: string | null
  directory: string | null; reason: string | null; engine: Engine | null
  executionPlanDigest?: string | null
}
type Live = { child: ChildProcess; job: Job; closed: Promise<void>; timer: NodeJS.Timeout }
const exec = promisify(execFile)
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error('Invalid evaluation identity')
  return value
}
function input(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported evaluation option')
  return value as Record<string, unknown>
}
function absolute(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Evaluation paths must be absolute')
  return resolve(value)
}
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}
async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }
async function optionalJson<T>(path: string, fallback: T): Promise<T> {
  try { return await readJson<T>(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.evaluation-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

// This is an explicitly registered developer installation, not code chosen by a
// scheduled Agent. Fingerprint the executable evaluation inputs before each job.
export async function evaluationSourceDigest(source: string): Promise<string> {
  const files: [string, string][] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(join(source, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Evaluation installation contains a symlink')
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && /\.(mjs|js|ts|json)$/.test(path)) files.push([path, await fileDigest(join(source, path))])
      if (files.length > 8000) throw new Error('Evaluation installation exceeds the file limit')
    }
  }
  for (const directory of ['scripts', 'packages/evaluation', 'docs/contracts/schemas', 'docs/versions/v0.34/schemas', 'docs/versions/v0.36/schemas']) await visit(directory)
  for (const path of ['package.json', 'pnpm-lock.yaml']) files.push([path, await fileDigest(join(source, path))])
  return digest(files)
}

export class EvaluationHostService {
  #serial: Promise<unknown> = Promise.resolve()
  #live = new Map<string, Live>()
  #stopped = false
  #tickPending = false
  #nextTick = 0
  #recovered = false
  readonly root: string
  constructor(root: string, private readonly core: Core) { this.root = join(root, 'evaluation') }
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#serial.then(work)
    this.#serial = result.catch(() => undefined)
    return result
  }

  configure(value: unknown): Promise<Engine> {
    return this.#exclusive(async () => {
      if (this.#live.size) throw new Error('Wait for the active evaluation before changing its installation')
      const params = input(value, ['source', 'node'])
      const source = await realpath(absolute(params.source)), node = await realpath(absolute(params.node))
      if (JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).name !== 'rovai-ai') throw new Error('Expected a Rovai developer checkout')
      if (!(await lstat(join(source, 'scripts/eval-host.mjs'))).isFile()) throw new Error('Evaluation Host entry is missing')
      const version = await exec(node, ['--version'], { timeout: 5000, maxBuffer: 1024 })
      if (!/^v(2[4-9]|[3-9]\d)\./.test(version.stdout.trim())) throw new Error('Evaluation requires Node >=24')
      const engine = { source, node, nodeDigest: await fileDigest(node), sourceDigest: await evaluationSourceDigest(source) }
      await mkdir(join(this.root, 'jobs'), { recursive: true, mode: 0o700 })
      await atomicJson(join(this.root, 'engine.json'), engine)
      return engine
    })
  }

  start(value: unknown, mode: 'gate' | 'weekly'): Promise<Job> {
    return this.#exclusive(async () => {
      const params = input(value, ['plan', 'output', 'jobId'])
      return this.#start({ jobId: identifier(params.jobId), mode, plan: absolute(params.plan), output: absolute(params.output), automationId: null, campId: null })
    })
  }

  schedule(value: unknown): Promise<Binding> {
    return this.#exclusive(async () => {
      const params = input(value, ['automationId', 'plan', 'output'])
      const automationId = identifier(params.automationId)
      const automation = await this.core.request<AutomationView | null>('automations.get', { automationId })
      if (automation?.projectRef.kind !== 'directory') throw new Error('Evaluation requires an existing Automation bound to a directory')
      const workspace = await realpath(automation.projectRef.path)
      const output = await this.#output(absolute(params.output), workspace)
      const plan = await realpath(absolute(params.plan)), frozen = await this.#plan(plan, 'weekly')
      if (frozen.budget.wallSeconds > 2700) throw new Error('Scheduled evaluation allows at most 2700 seconds, leaving time within the existing one-hour Automation for analysis')
      const engine = await this.#engine()
      const existing = await optionalJson<Binding[]>(join(this.root, 'schedules.json'), [])
      if (existing.some(binding => binding.automationId !== automationId && binding.output === output)) throw new Error('Evaluation output is already bound to another Automation')
      const binding = { automationId, automationVersion: automation.version, workspace, output, plan, planDigest: frozen.planDigest, registeredAt: new Date().toISOString() }
      const bindings = existing.filter(item => item.automationId !== automationId).concat(binding)
      if (bindings.length > 8) throw new Error('At most eight evaluation schedules are supported')
      // The helper only waits for a receipt belonging to the current Camp. It
      // cannot submit a job, reach owner IPC, or treat an old report as current.
      await writeFile(join(output, 'wait-for-evaluation.mjs'), await readFile(join(engine.source, 'scripts/eval-wait.mjs')), { mode: 0o600 })
      await atomicJson(join(this.root, 'schedules.json'), bindings)
      this.#nextTick = 0
      return binding
    })
  }

  async status(value: unknown = {}): Promise<unknown> {
    const params = input(value, ['jobId'])
    if (params.jobId !== undefined) return readJson<Job>(join(this.root, 'jobs', identifier(params.jobId), 'job.json'))
    return { engine: await optionalJson<Engine | null>(join(this.root, 'engine.json'), null), schedules: await optionalJson<Binding[]>(join(this.root, 'schedules.json'), []), activeJobs: [...this.#live.keys()] }
  }

  cancel(value: unknown): Promise<unknown> {
    return this.#exclusive(async () => {
      const params = input(value, ['jobId']), jobId = identifier(params.jobId)
      const live = this.#live.get(jobId)
      if (live) { live.job.reason = 'cancelled_by_owner'; live.child.kill('SIGTERM') }
      return { jobId, cancellationRequested: Boolean(live) }
    })
  }

  async tick(now = new Date()): Promise<void> {
    if (this.#stopped || this.#tickPending || now.getTime() < this.#nextTick) return
    this.#tickPending = true
    this.#nextTick = now.getTime() + 5000
    try {
      await this.#exclusive(async () => {
        const bindings = await optionalJson<Binding[]>(join(this.root, 'schedules.json'), [])
        if (!bindings.length) this.#nextTick = now.getTime() + 60_000
        if (!this.#recovered) {
          // Never relaunch jobs from an earlier App instance, nor signal their
          // saved PIDs. The worker stops its children when its original parent exits.
          const jobs = await readdir(join(this.root, 'jobs')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
          for (const id of jobs) {
            const job = await readJson<Job>(join(this.root, 'jobs', identifier(id), 'job.json'))
            if (job.state === 'running' && !this.#live.has(id)) { job.state = 'interrupted'; job.reason = 'app_restarted'; job.endedAt = now.toISOString(); await this.#publish(job) }
          }
          this.#recovered = true
        }
        for (const binding of bindings) {
          const automation = await this.core.request<AutomationView | null>('automations.get', { automationId: binding.automationId })
          const live = [...this.#live.values()].find(item => item.job.automationId === binding.automationId)
          // Consuming a once schedule disables future dispatch without changing
          // its owner version. An explicit close/update increments that version.
          const enabledOrConsumedOnce = automation?.enabled || automation?.schedule.kind === 'once' && automation.version === binding.automationVersion
          const eligible = enabledOrConsumedOnce && automation?.projectRef.kind === 'directory' && await realpath(automation.projectRef.path) === binding.workspace
          const page = eligible ? await this.core.request<AutomationRunListPage>('automations.runs.list', { automationId: binding.automationId, limit: 50 }) : null
          if (live && !page?.runs.some(run => run.runId === live.job.jobId && run.status === 'running')) {
            live.job.reason = 'automation_stopped_or_finished'; live.child.kill('SIGTERM')
          }
          if (!eligible || this.#live.size) continue
          const run = page?.runs.find(item => item.status === 'running' && item.campId && Date.parse(item.createdAt) >= Date.parse(binding.registeredAt))
          if (!run?.campId) continue
          const previous = await optionalJson<Job | null>(join(this.root, 'jobs', identifier(run.runId), 'job.json'), null)
          if (previous) continue
          try {
            await this.#start({ jobId: run.runId, mode: 'weekly', plan: binding.plan, output: binding.output, automationId: binding.automationId, campId: identifier(run.campId) }, binding)
          } catch (error) {
            const failed: Job = { schemaVersion: 1, jobId: run.runId, mode: 'weekly', plan: binding.plan, planDigest: binding.planDigest, output: binding.output, automationId: binding.automationId, campId: identifier(run.campId), createdAt: now.toISOString(), endedAt: now.toISOString(), state: 'failed', reportStatus: null, directory: null, reason: (error as Error).message.slice(0, 300), engine: null }
            await mkdir(join(this.root, 'jobs', run.runId), { recursive: true, mode: 0o700 })
            await this.#publish(failed)
          }
        }
      })
    } finally { this.#tickPending = false }
  }

  async stop(): Promise<void> {
    this.#stopped = true
    await this.#serial
    const live = [...this.#live.values()]
    for (const item of live) { item.job.reason = 'app_shutdown'; item.child.kill('SIGTERM') }
    await Promise.all(live.map(item => item.closed))
  }

  async #engine(): Promise<Engine> {
    const engine = await readJson<Engine>(join(this.root, 'engine.json'))
    if (await fileDigest(engine.node) !== engine.nodeDigest || await evaluationSourceDigest(engine.source) !== engine.sourceDigest) throw new Error('Evaluation installation changed; register it again before execution')
    return engine
  }
  async #plan(path: string, mode: string): Promise<{ planDigest: string; budget: { wallSeconds: number } }> {
    const plan = await readJson<Record<string, unknown>>(path)
    const { planDigest, ...payload } = plan
    const budget = plan.budget as { wallSeconds: number }
    if (planDigest !== digest(payload) || plan.mode !== mode || !Number.isInteger(budget?.wallSeconds) || budget.wallSeconds < 60 || budget.wallSeconds > 86400) throw new Error('Expected an intact frozen evaluation plan with the requested mode and budget')
    return { planDigest: planDigest as string, budget }
  }
  async #output(path: string, workspace?: string): Promise<string> {
    // Canonicalize the existing parent before creating anything. A configured
    // output may already exist, but symlink path aliases are never accepted.
    let parent = path
    const suffix: string[] = []
    for (;;) {
      try { await lstat(parent); break } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; suffix.unshift(parent.slice(dirname(parent).length + 1)); parent = dirname(parent) }
    }
    const destination = join(await realpath(parent), ...suffix)
    if (workspace && !inside(workspace, destination)) throw new Error('Evaluation output must remain inside the Automation workspace')
    await mkdir(destination, { recursive: true, mode: 0o700 })
    return await realpath(destination)
  }
  async #start(params: Pick<Job, 'jobId' | 'mode' | 'plan' | 'output' | 'automationId' | 'campId'>, binding?: Binding): Promise<Job> {
    if (this.#stopped) throw new Error('Evaluation Host is shutting down')
    const jobDirectory = join(this.root, 'jobs', params.jobId)
    const previous = await optionalJson<Job | null>(join(jobDirectory, 'job.json'), null)
    if (previous) {
      const output = await realpath(params.output).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return params.output; throw error })
      if (previous.plan !== params.plan || previous.output !== output || previous.mode !== params.mode) throw new Error('Evaluation job identity was reused with different inputs')
      return previous
    }
    if (this.#live.size) throw new Error('Another evaluation is active; no overlapping jobs are admitted')
    const engine = await this.#engine(), frozen = await this.#plan(params.plan, params.mode)
    if (binding && binding.planDigest !== frozen.planDigest) throw new Error('Scheduled plan changed; bind the new plan explicitly')
    const output = await this.#output(params.output, binding?.workspace)
    const job: Job = { ...params, output, schemaVersion: 1, planDigest: frozen.planDigest, createdAt: new Date().toISOString(), endedAt: null, state: 'running', reportStatus: null, directory: null, reason: null, engine }
    await mkdir(jobDirectory, { mode: 0o700 })
    await this.#publish(job)
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(engine.node)}${sep === '/' ? ':' : ';'}${process.env.PATH ?? ''}` }
    delete env.ROVAI_APP_AUTOMATION_CONTEXT
    const child = spawn(engine.node, [join(engine.source, 'scripts/eval-host.mjs'), '--job', join(jobDirectory, 'job.json'), '--parent', String(process.pid)], { cwd: engine.source, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout?.on('data', chunk => { log = (log + String(chunk)).slice(-65536) })
    child.stderr?.on('data', chunk => { log = (log + String(chunk)).slice(-65536) })
    let spawnError: string | null = null
    child.once('error', error => { spawnError = error.message })
    const timer = setTimeout(() => { job.reason = 'host_budget_exhausted'; child.kill('SIGTERM') }, (frozen.budget.wallSeconds + 120) * 1000)
    const closed = new Promise<void>(resolveClose => {
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        void this.#exclusive(async () => {
          const result = await optionalJson<{ directory: string; status: string; planDigest: string } | null>(join(jobDirectory, 'result.json'), null)
          job.endedAt = new Date().toISOString()
          job.state = job.reason || signal ? 'interrupted' : code === 0 && result ? 'completed' : 'failed'
          job.reportStatus = result?.status ?? null
          job.directory = result?.directory ?? null
          job.executionPlanDigest = result?.planDigest ?? null
          job.reason ??= spawnError ?? (job.state === 'failed' ? 'evaluation_worker_failed; see worker.log' : null)
          await writeFile(join(jobDirectory, 'worker.log'), log, { mode: 0o600 })
          await this.#publish(job)
        }).finally(() => { this.#live.delete(job.jobId); resolveClose() }).catch(() => undefined)
      })
    })
    this.#live.set(job.jobId, { job, child, timer, closed })
    return job
  }
  async #publish(job: Job): Promise<void> {
    await atomicJson(join(this.root, 'jobs', job.jobId, 'job.json'), job)
    if (job.campId) {
      const binding = (await optionalJson<Binding[]>(join(this.root, 'schedules.json'), [])).find(item => item.automationId === job.automationId)
      if (!binding || await realpath(job.output) !== binding.output || !inside(binding.workspace, binding.output)) return
      const directory = join(binding.output, 'automation')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (await realpath(directory) !== directory) throw new Error('Automation receipt directory cannot be a symlink')
      const { engine: _engine, plan: _plan, ...receipt } = job
      await atomicJson(join(directory, `${job.campId}.json`), receipt)
    }
  }
}
