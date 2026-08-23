import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoreMethod } from '@contracts'
import {
  dispatchUserAutomation,
  startUserAutomationOptional,
  UserAutomationError,
  UserAutomationServer
} from './user-automation'

async function socketRequest(path: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(path)
    let response = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => { response += chunk })
    socket.on('end', () => {
      try {
        resolve(JSON.parse(response.trim()) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    socket.on('error', reject)
  })
}

describe('User Automation transport', () => {
  it('sends through one atomic Core operation and maps only the closed V1 launch shape', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    const core = {
      async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
        calls.push({ method, params })
        if (method === 'userAutomation.camp.send') {
          return {
            commandResult: {
              status: 'accepted',
              payload: {
                campMessageId: 'rvmsg_1',
                campTurnId: 'rvturn_1',
                agentRunIds: ['rvrun_1'],
                executionBudget: { deadlineAt: '2026-08-21T10:30:00Z' }
              }
            },
            replayed: false,
            preflight: null,
            pendingExecution: null
          } as T
        }
        throw new Error(`unexpected ${method}`)
      }
    }
    const result = await dispatchUserAutomation(
      'camp.send',
      {
        commandId: 'command-1',
        campId: 'rvcamp_test',
        agentId: 'agent_1',
        body: 'task',
        executionBudget: {
          elapsedSeconds: 1_800,
          maxAgentRunResponsibilities: 1,
          maxAcceptedA2a: 0
        }
      },
      { core, openCamp: async (campId) => ({ campId, opened: true }), appVersion: 'test' }
    )

    expect(result).toEqual({
      status: 'dispatched',
      campMessageId: 'rvmsg_1',
      campTurnId: 'rvturn_1',
      agentRunIds: ['rvrun_1'],
      executionBudget: { deadlineAt: '2026-08-21T10:30:00Z' },
      replayed: false
    })
    expect(calls.map(({ method }) => method)).toEqual(['userAutomation.camp.send'])
    expect(calls[0].params).toMatchObject({
      execution: {
        budget: {
          elapsedSeconds: 1_800,
          maxAgentRunResponsibilities: 1,
          maxAcceptedA2a: 0
        }
      }
    })
  })

  it('fails closed when Core ever returns Pending Execution', async () => {
    const core = {
      async request<T>(method: CoreMethod): Promise<T> {
        expect(method).toBe('userAutomation.camp.send')
        return {
          commandResult: null,
          replayed: false,
          preflight: null,
          pendingExecution: { id: 'intent-1' }
        } as T
      }
    }

    await expect(dispatchUserAutomation(
      'camp.send',
      { commandId: 'c', campId: 'rvcamp_test', agentId: 'agent_1', body: 'task' },
      { core, openCamp: async (campId) => ({ campId, opened: true }), appVersion: 'test' }
    )).rejects.toMatchObject({ code: 'automation_contract_upgrade_required' })
  })

  it('does not expose a generic Core invoke operation', async () => {
    const core = { request: async <T>() => ({} as T) }
    await expect(dispatchUserAutomation(
      'core.invoke',
      { method: 'members.runtime.set' },
      { core, openCamp: async (campId) => ({ campId, opened: true }), appVersion: 'test' }
    )).rejects.toBeInstanceOf(UserAutomationError)
  })

  it('maps Runtime inspection and member configuration to the closed Core methods', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    const core = {
      async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
        calls.push({ method, params })
        return { status: 'applied' } as T
      }
    }
    const dependencies = {
      core,
      openCamp: async (campId: string) => ({ campId, opened: true as const }),
      appVersion: 'test'
    }

    await dispatchUserAutomation('runtime.check', { adapterKind: 'opencode-cli' }, dependencies)
    await dispatchUserAutomation('runtime.models', { adapterKind: 'kiro-cli' }, dependencies)
    await dispatchUserAutomation('member.create', {
      commandId: 'create-command',
      displayName: '开栈',
      avatarRef: null,
      teamRole: 'Runtime 验证员',
      professionalResponsibilities: '验证 OpenCode Runtime。',
      personalityTraits: ['严谨', '直接'],
      workingPrinciples: '先取证，再下结论。',
      growthTopic: ''
    }, dependencies)
    await dispatchUserAutomation('member.runtime.set', {
      commandId: 'runtime-command',
      agentId: 'agent_12',
      expectedVersion: 1,
      adapterKind: 'opencode-cli',
      model: { mode: 'explicit', modelId: 'minimax/MiniMax-M3', options: {} },
      permissions: {
        adapterKind: 'opencode-cli',
        schemaVersion: 1,
        values: { permission_mode: 'allow' }
      }
    }, dependencies)
    await dispatchUserAutomation('member.runtime.clear', {
      commandId: 'clear-command',
      agentId: 'agent_12',
      expectedVersion: 2
    }, dependencies)

    expect(calls).toEqual([
      {
        method: 'runtime.product.check',
        params: { runtimeKind: 'opencode-cli' }
      },
      {
        method: 'runtime.modelCatalog.open',
        params: { runtimeKind: 'kiro-cli' }
      },
      {
        method: 'members.create',
        params: {
          commandId: 'create-command',
          command: {
            displayName: '开栈',
            avatarRef: null,
            teamRole: 'Runtime 验证员',
            professionalResponsibilities: '验证 OpenCode Runtime。',
            personalityTraits: ['严谨', '直接'],
            workingPrinciples: '先取证，再下结论。',
            growthTopic: ''
          }
        }
      },
      {
        method: 'members.runtime.set',
        params: {
          commandId: 'runtime-command',
          command: {
            agentId: 'agent_12',
            expectedVersion: 1,
            adapterKind: 'opencode-cli',
            model: { mode: 'explicit', modelId: 'minimax/MiniMax-M3', options: {} },
            permissions: {
              adapterKind: 'opencode-cli',
              schemaVersion: 1,
              values: { permission_mode: 'allow' }
            }
          }
        }
      },
      {
        method: 'members.runtime.clear',
        params: {
          commandId: 'clear-command',
          command: { agentId: 'agent_12', expectedVersion: 2 }
        }
      }
    ])
  })

  it('rejects mismatched Runtime permission adapters before calling Core', async () => {
    const calls: CoreMethod[] = []
    const core = {
      async request<T>(method: CoreMethod): Promise<T> {
        calls.push(method)
        return {} as T
      }
    }

    await expect(dispatchUserAutomation('member.runtime.set', {
      commandId: 'runtime-command',
      agentId: 'agent_12',
      expectedVersion: 1,
      adapterKind: 'opencode-cli',
      model: { mode: 'runtime_default' },
      permissions: { adapterKind: 'kiro-cli', schemaVersion: 1, values: {} }
    }, {
      core,
      openCamp: async (campId) => ({ campId, opened: true }),
      appVersion: 'test'
    })).rejects.toMatchObject({ code: 'automation_invalid_input' })
    expect(calls).toEqual([])
  })

  it('keeps Desktop available when the optional Automation server cannot start', async () => {
    const unavailable = new Error('injected endpoint bind failure')
    const diagnostics: unknown[] = []
    const server = {
      async start(): Promise<void> { throw unavailable },
      async stop(): Promise<void> {}
    }

    const started = await startUserAutomationOptional(
      () => server,
      (error) => diagnostics.push(error)
    )

    expect(started).toBeNull()
    expect(diagnostics).toEqual([unavailable])
  })

  it.runIf(process.platform !== 'win32')(
    'binds each socket request to the published App instance and removes discovery on stop',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'rovai-automation-'))
      const core = {
        async request<T>(method: CoreMethod): Promise<T> {
          if (method === 'app.info') return { version: 'core-test' } as T
          throw new Error(`unexpected ${method}`)
        }
      }
      const server = new UserAutomationServer(root, {
        core,
        openCamp: async (campId) => ({ campId, opened: true }),
        appVersion: 'app-test'
      })
      try {
        await server.start()
        const context = JSON.parse(await readFile(server.contextPath, 'utf8')) as {
          contractVersion: number
          instanceId: string
          credential: string
          endpoint: { path: string }
        }
        const accepted = await socketRequest(context.endpoint.path, {
          contractVersion: context.contractVersion,
          instanceId: context.instanceId,
          credential: context.credential,
          requestId: 'request-1',
          operation: 'status',
          params: {}
        })
        expect(accepted).toMatchObject({
          requestId: 'request-1',
          ok: true,
          result: { appRunning: true, instanceId: context.instanceId }
        })

        const rejected = await socketRequest(context.endpoint.path, {
          contractVersion: context.contractVersion,
          instanceId: 'another-instance',
          credential: context.credential,
          requestId: 'request-2',
          operation: 'status',
          params: {}
        })
        expect(rejected).toMatchObject({
          requestId: 'request-2',
          ok: false,
          error: { code: 'automation_unauthorized' }
        })
      } finally {
        await server.stop()
        await expect(readFile(server.contextPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform === 'win32')(
    'fails closed before publishing discovery when Unix-domain automation is unavailable',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'rovai-automation-windows-'))
      const server = new UserAutomationServer(root, {
        core: { request: async <T>() => ({} as T) },
        openCamp: async (campId) => ({ campId, opened: true }),
        appVersion: 'app-test'
      })
      try {
        await expect(server.start()).rejects.toMatchObject({
          code: 'automation_platform_unsupported'
        })
        await expect(readFile(server.contextPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await server.stop()
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
