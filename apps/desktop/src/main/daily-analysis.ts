import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, realpath, lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AutomationView, CoreMethod } from '@contracts'
import { dailyWindow, runDaily, type DailyScope } from '../../../../packages/evaluation/src/daily'

type Configuration = DailyScope & { automationId: string; timezone: string; output: string }
type Requester = { request<T>(method: CoreMethod, params?: unknown): Promise<T> }

// Host prepares an explicitly scoped, metadata-only report. The existing
// Automation runs the analysis Agent; its sandbox never gains user IPC access.
export class DailyAnalysisService {
  #pending = false
  #nextAttempt = 0
  #configurationChange: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: string, private readonly core: Requester) {}

  configure(value: unknown): Promise<Configuration> {
    const change = this.#configurationChange.then(() => this.#configure(value))
    this.#configurationChange = change.catch(() => undefined)
    return change
  }

  async #configure(value: unknown): Promise<Configuration> {
    const configuration = parseConfiguration(value)
    const automation = await this.core.request<AutomationView | null>('automations.get', { automationId: configuration.automationId })
    if (!automation || automation.projectRef.kind !== 'directory') throw new Error('Daily analysis requires an existing Automation bound to a directory')
    const project = await realpath(automation.projectRef.path)
    const output = await canonicalDestination(configuration.output)
    if (!inside(project, output)) throw new Error('Daily output is outside the analysis Automation workspace; choose a path inside it')
    await mkdir(output, { recursive: true, mode: 0o700 })
    if ((await lstat(output)).isSymbolicLink() || !inside(project, await realpath(output))) throw new Error('Daily output resolves outside the Automation workspace')
    const existing = await this.#load()
    if (existing.some(entry => entry.automationId !== configuration.automationId && entry.output === output)) throw new Error('Daily output is already registered to another Automation')
    const configs = existing.filter(entry => entry.automationId !== configuration.automationId).concat({ ...configuration, output })
    if (configs.length > 8) throw new Error('At most eight daily analysis configurations are supported')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temporary = join(this.root, `daily-analysis-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(configs), { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(this.root, 'daily-analysis.json'))
    this.#nextAttempt = 0
    return { ...configuration, output }
  }

  async status(): Promise<unknown> {
    let preparation: unknown = null
    try { preparation = JSON.parse(await readFile(join(this.root, 'daily-analysis-status.json'), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return { configurations: await this.#load(), preparation }
  }

  async tick(now = new Date()): Promise<void> {
    if (this.#pending || now.getTime() < this.#nextAttempt) return
    this.#pending = true
    this.#nextAttempt = now.getTime() + 60_000
    try {
      const configs = await this.#load()
      const outcomes: unknown[] = []
      for (const config of configs) {
        try {
          const automation = await this.core.request<AutomationView | null>('automations.get', { automationId: config.automationId })
          if (!automation?.enabled || automation.projectRef.kind !== 'directory') { outcomes.push({ automationId: config.automationId, status: 'inactive' }); continue }
          const project = await realpath(automation.projectRef.path)
          if (!inside(project, await realpath(config.output))) throw new Error('Analysis workspace changed; configure the report destination again')
          const result = await runDaily({ output: config.output, timezone: config.timezone, now,
            scope: { campIds: config.campIds, excludeCampIds: config.excludeCampIds, excludeAutomationIds: [...new Set([...config.excludeAutomationIds, ...configs.map(entry => entry.automationId)])] },
            exportTrace: params => this.core.request('executionTrace.export', params)
          })
          outcomes.push({ automationId: config.automationId, status: result.report.status, directory: result.directory })
          if (result.report.status !== 'available') this.#nextAttempt = now.getTime() + 3_600_000
        } catch (error) {
          outcomes.push({ automationId: config.automationId, status: 'unavailable', reason: (error as Error).message.slice(0, 300) })
          this.#nextAttempt = now.getTime() + 3_600_000
        }
      }
      if (configs.length) {
        const temporary = join(this.root, `daily-status-${randomUUID()}.tmp`)
        await writeFile(temporary, JSON.stringify({ observedAt: now.toISOString(), outcomes }), { flag: 'wx', mode: 0o600 })
        await rename(temporary, join(this.root, 'daily-analysis-status.json'))
      }
    } finally { this.#pending = false }
  }

  async #load(): Promise<Configuration[]> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.root, 'daily-analysis.json'), 'utf8'))
      if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid daily analysis configuration')
      return value.map(parseConfiguration)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}
function parseConfiguration(value: unknown): Configuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected daily configuration')
  const input = { ...value } as Record<string, unknown>
  const allowed = ['automationId', 'timezone', 'output', 'campIds', 'excludeCampIds', 'excludeAutomationIds']
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unknown daily configuration field')
  for (const key of ['automationId', 'timezone', 'output']) if (typeof input[key] !== 'string' || !input[key]) throw new Error(`Missing ${key}`)
  if (!isAbsolute(input.output as string)) throw new Error('Daily output must be absolute')
  dailyWindow(input.timezone as string)
  for (const key of ['campIds', 'excludeCampIds', 'excludeAutomationIds']) {
    input[key] ??= []
    if (!Array.isArray(input[key]) || input[key].length > 90 || input[key].some((id: unknown) => typeof id !== 'string' || !id || id.length > 128 || /\s/.test(id))) throw new Error(`Invalid ${key}`)
  }
  return input as Configuration
}

// Resolve existing ancestors before mkdir, so /var aliases work and a symlink
// cannot cause report preparation to create directories outside the workspace.
async function canonicalDestination(path: string): Promise<string> {
  let ancestor = resolve(path)
  const suffix: string[] = []
  for (;;) {
    try { return join(await realpath(ancestor), ...suffix) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error
      // A dangling symlink must fail instead of being mistaken for a missing directory.
      try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Daily output has a dangling symlink') }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError }
      suffix.unshift(basename(ancestor))
      ancestor = dirname(ancestor)
    }
  }
}
