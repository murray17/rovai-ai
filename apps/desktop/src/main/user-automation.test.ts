import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoreMethod } from '@contracts'
import {
  dispatchUserAutomation,
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
  it('sends through the durable Composer and maps only the closed V1 launch shape', async () => {
    const calls: Array<{ method: CoreMethod; params: unknown }> = []
    const core = {
      async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
        calls.push({ method, params })
        if (method === 'camp.composerDraft.get') {
          return {
            campId: 'rvcamp_test',
            body: '',
            content: [],
            revision: 1,
            attachments: [],
            replyIntent: null,
            continuationIntent: null,
            updatedAt: null,
            expiresAt: null
          } as T
        }
        if (method === 'camp.composerDraft.save') {
          return {
            campId: 'rvcamp_test',
            body: '@Agent task',
            content: [],
            revision: 2,
            attachments: [],
            replyIntent: null,
            continuationIntent: null,
            updatedAt: null,
            expiresAt: null
          } as T
        }
        if (method === 'camp.messages.send') {
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
    expect(calls.map(({ method }) => method)).toEqual([
      'camp.composerDraft.get',
      'camp.composerDraft.save',
      'camp.messages.send'
    ])
    expect(calls[2].params).toMatchObject({
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
        if (method === 'camp.composerDraft.get' || method === 'camp.composerDraft.save') {
          return {
            campId: 'rvcamp_test', body: '', content: [], revision: 1,
            attachments: [], replyIntent: null, continuationIntent: null,
            updatedAt: null, expiresAt: null
          } as T
        }
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
