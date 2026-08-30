import { describe, expect, it, vi } from 'vitest'
import {
  buildDingTalkDeveloperInvocation,
  DingTalkDeveloperApiError,
  DingTalkDeveloperApiTransport,
  DingTalkDeveloperGateway
} from './dingtalk-developer-gateway'

describe('DingTalk developer API boundary', () => {
  it('maps reviewed operations to typed official developer tools', () => {
    const cases = [
      [{ operation: 'app.create', values: { appName: '芝士', description: '鉴定士' } },
        { tool: 'create_dev_app', arguments: { name: '芝士', desc: '鉴定士' } }],
      [{ operation: 'app.get', values: { unifiedAppId: 'u-app' } },
        { tool: 'get_dev_app', arguments: { unifiedAppId: 'u-app' } }],
      [{ operation: 'app.update', values: { unifiedAppId: 'u-app', iconMediaId: 'media-1' } },
        { tool: 'update_dev_app', arguments: { unifiedAppId: 'u-app', iconMediaId: 'media-1' } }],
      [{ operation: 'app.credentials.get', values: { unifiedAppId: 'u-app' } },
        { tool: 'get_dev_app_credentials', arguments: { unifiedAppId: 'u-app' } }],
      [{ operation: 'app.robot.get', values: { unifiedAppId: 'u-app' } },
        { tool: 'get_extension_robot_config', arguments: { unifiedAppId: 'u-app' } }],
      [{
        operation: 'app.robot.config',
        values: {
          unifiedAppId: 'u-app', robotName: '芝士', robotBrief: '鉴定士',
          robotDescription: 'Rovai AI 队员', iconMediaId: 'media-1', mode: 'STREAM',
          addScope: false
        }
      }, {
        tool: 'set_extension_robot_config',
        arguments: {
          unifiedAppId: 'u-app', name: '芝士', brief: '鉴定士',
          desc: 'Rovai AI 队员', iconMediaId: 'media-1', mode: 'STREAM', addScope: false
        }
      }],
      [{ operation: 'app.robot.enable', values: { unifiedAppId: 'u-app' } },
        { tool: 'enable_dev_app_robot', arguments: { unifiedAppId: 'u-app' } }],
      [{
        operation: 'app.permission.list',
        values: { unifiedAppId: 'u-app', scopeValue: 'scope.one', authStatus: 'AUTHORIZED', pageSize: '50' }
      }, {
        tool: 'list_dev_app_permissions',
        arguments: { unifiedAppId: 'u-app', scopeValue: 'scope.one', authStatus: 'AUTHORIZED', pageSize: 50 }
      }],
      [{
        operation: 'app.permission.add',
        values: { unifiedAppId: 'u-app', scopeValues: ['scope.one', 'scope.two'] }
      }, {
        tool: 'apply_dev_app_permissions',
        arguments: { unifiedAppId: 'u-app', scopeValues: ['scope.one', 'scope.two'] }
      }],
      [{
        operation: 'app.event.list',
        values: { unifiedAppId: 'u-app', keyword: 'chatbot', pageSize: '100' }
      }, {
        tool: 'list_dev_app_events',
        arguments: { unifiedAppId: 'u-app', keyword: 'chatbot', pageSize: 100 }
      }],
      [{
        operation: 'app.event.subscribe',
        values: { unifiedAppId: 'u-app', eventCodes: ['chatbot_message'] }
      }, {
        tool: 'subscribe_dev_app_events',
        arguments: { unifiedAppId: 'u-app', eventCodes: ['chatbot_message'] }
      }],
      [{
        operation: 'app.version.create',
        values: { unifiedAppId: 'u-app', versionDescription: 'Rovai 自动发布' }
      }, {
        tool: 'create_dev_app_version',
        arguments: { unifiedAppId: 'u-app', desc: 'Rovai 自动发布' }
      }],
      [{
        operation: 'app.version.checkApproval',
        values: { unifiedAppId: 'u-app', versionId: 'version-1' }
      }, {
        tool: 'publish_dev_app_version',
        arguments: { unifiedAppId: 'u-app', versionId: 'version-1', precheckOnly: true }
      }],
      [{
        operation: 'app.version.publish',
        values: {
          unifiedAppId: 'u-app', versionId: 'version-1', approverUserId: 'owner-1',
          confirmedSensitive: true
        }
      }, {
        tool: 'publish_dev_app_version',
        arguments: {
          unifiedAppId: 'u-app', versionId: 'version-1', approverUserId: 'owner-1',
          confirmedSensitive: true, precheckOnly: false
        }
      }],
      [{
        operation: 'app.version.status',
        values: { unifiedAppId: 'u-app', versionId: 'version-1' }
      }, {
        tool: 'get_dev_app_version_status',
        arguments: { unifiedAppId: 'u-app', versionId: 'version-1' }
      }]
    ] as const

    for (const [request, expected] of cases) {
      expect(buildDingTalkDeveloperInvocation(request)).toEqual(expected)
    }
  })

  it('calls the official service directly and keeps the token out of the body', async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _request?: RequestInit
    ) => jsonResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { structuredContent: { unifiedAppId: 'u-app' } }
    }))
    const transport = new DingTalkDeveloperApiTransport({
      fetchImpl: fetchMock as unknown as typeof fetch
    })
    const gateway = new DingTalkDeveloperGateway({
      tokenProvider: { accessToken: async () => 'owner-access-token' },
      transport
    })

    await expect(gateway.execute({
      operation: 'app.create',
      values: { appName: '芝士', description: 'Rovai AI 队员' }
    })).resolves.toEqual({ unifiedAppId: 'u-app' })

    const [url, request] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://mcp-gw.dingtalk.com/server/op-app')
    expect(request?.method).toBe('POST')
    const headers = new Headers(request?.headers)
    expect(headers.get('authorization')).toBe('Bearer owner-access-token')
    expect(headers.get('x-user-access-token')).toBe('owner-access-token')
    const body = String(request?.body)
    expect(body).not.toContain('owner-access-token')
    expect(JSON.parse(body)).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'create_dev_app',
        arguments: { name: '芝士', desc: 'Rovai AI 队员' }
      }
    })
  })

  it('distinguishes definite remote rejection from an uncertain transport failure', async () => {
    const rejected = new DingTalkDeveloperApiTransport({
      fetchImpl: vi.fn(async () => jsonResponse({
        jsonrpc: '2.0', id: 1, result: { isError: true, content: [] }
      })) as unknown as typeof fetch
    })
    const uncertain = new DingTalkDeveloperApiTransport({
      fetchImpl: vi.fn(async () => { throw new TypeError('network lost') }) as unknown as typeof fetch
    })

    const rejectedError = await rejected.callDeveloperTool({
      accessToken: 'token', tool: 'create_dev_app', arguments: { name: '芝士' }
    }).catch((error: unknown) => error)
    const uncertainError = await uncertain.callDeveloperTool({
      accessToken: 'token', tool: 'create_dev_app', arguments: { name: '芝士' }
    }).catch((error: unknown) => error)

    expect(rejectedError).toBeInstanceOf(DingTalkDeveloperApiError)
    expect((rejectedError as DingTalkDeveloperApiError).definitelyRejected).toBe(true)
    expect(uncertainError).toBeInstanceOf(DingTalkDeveloperApiError)
    expect((uncertainError as DingTalkDeveloperApiError).definitelyRejected).toBe(false)
  })

  it('stops reading an undeclared oversized response at the transport boundary', async () => {
    const transport = new DingTalkDeveloperApiTransport({
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(2_000_001), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })) as unknown as typeof fetch
    })

    await expect(transport.callDeveloperTool({
      accessToken: 'token', tool: 'get_dev_app', arguments: { unifiedAppId: 'u-app' }
    })).rejects.toThrow('dingtalk_open_platform_response_too_large')
  })

  it('resolves the account identity through the official contact service fallback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              result: [{
                orgEmployeeModel: {
                  corpId: 'corp-1',
                  orgName: '星海科技',
                  userId: 'owner-1',
                  orgUserName: 'Murray'
                }
              }]
            })
          }]
        }
      }))
    const transport = new DingTalkDeveloperApiTransport({
      fetchImpl: fetchMock as unknown as typeof fetch
    })

    await expect(transport.resolveCurrentUser({
      accessToken: 'token'
    })).resolves.toEqual({
      corpId: 'corp-1',
      corpName: '星海科技',
      userId: 'owner-1',
      userName: 'Murray'
    })
    expect(fetchMock.mock.calls[1]?.[0]).toContain('mcp-gw.dingtalk.com/server/')
  })

  it('rejects unknown arguments and malformed values before network access', () => {
    expect(() => buildDingTalkDeveloperInvocation({
      operation: 'app.get',
      values: { unexpected: 'value' }
    })).toThrow('dingtalk_developer_argument_rejected:unexpected')
    expect(() => buildDingTalkDeveloperInvocation({
      operation: 'app.get',
      values: { unifiedAppId: ' ' }
    })).toThrow('dingtalk_developer_argument_invalid:unifiedAppId')
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
