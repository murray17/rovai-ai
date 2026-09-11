import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { CoreMethod } from '@contracts'
import { DailyAnalysisService } from './daily-analysis'
import { digest } from '../../../../packages/evaluation/src/daily'

it('prepares only owner-configured workspace files, excludes analysis descendants and reports broken scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-analysis-host-test-'))
  try {
    const workspace = join(root, 'workspace'); await mkdir(workspace)
    let project = workspace
    const calls: { method: CoreMethod; params: unknown }[] = []
    const service = new DailyAnalysisService(join(root, 'user-ipc'), { async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
      calls.push({ method, params })
      if (method === 'automations.get') return { enabled: true, projectRef: { kind: 'directory', path: project } } as T
      if (method === 'executionTrace.export') {
        const facts = { runs: [], tools: [], deliveries: [], deliveryEvents: [] }
        const scope = params as Record<string, unknown>
        return { schemaVersion: 1, scope, window: { since: scope.since, until: scope.until }, asOf: '2026-09-10T02:00:00Z', facts, factsDigest: digest(facts), metrics: { definitionVersion: 1, memory: { bodyReads: null, formalRevisions: null } } } as T
      }
      throw new Error(`Unexpected operation ${method}`)
    } })
    const config = { automationId: 'analysis', timezone: 'Asia/Shanghai', output: join(workspace, 'reports'), campIds: [], excludeCampIds: [], excludeAutomationIds: ['weekly-regression'] }
    await expect(service.configure({ ...config, output: join(root, 'outside') })).rejects.toThrow('inside')
    await symlink(root, join(workspace, 'escape'))
    await expect(service.configure({ ...config, output: join(workspace, 'escape') })).rejects.toThrow('outside')
    await service.configure(config)
    await service.tick(new Date('2026-09-10T02:00:00Z'))
    const trace = calls.find(call => call.method === 'executionTrace.export')
    expect(trace?.params).toMatchObject({ excludeAutomationIds: ['analysis', 'weekly-regression'] })
    const pointer = JSON.parse(await readFile(join(config.output, 'latest.json'), 'utf8'))
    expect(pointer.status).toBe('available')
    await service.tick(new Date('2026-09-10T02:00:30Z'))
    expect(calls.filter(call => call.method === 'executionTrace.export')).toHaveLength(1)
    project = join(root, 'moved'); await mkdir(project)
    await service.tick(new Date('2026-09-10T02:02:00Z'))
    expect(await service.status()).toMatchObject({ preparation: { outcomes: [{ status: 'unavailable' }] } })
  } finally { await rm(root, { recursive: true, force: true }) }
})
