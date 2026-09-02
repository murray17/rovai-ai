import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DINGTALK_AI_CARD_TEMPLATE_ID,
  DingTalkOpenApiClient,
  decodeDingTalkCardActionId,
  dingtalkCardParams
} from './dingtalk-open-api'

describe('DingTalk OpenAPI client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a non-forwardable STREAM card and delivers it to a private Bot space', async () => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Response.json(url.endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : url.endsWith('/card/instances/deliver')
          ? { success: true, result: [{ success: true, carrierId: 'carrier-1' }] }
          : { success: true })
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })
    await expect(client.createAndDeliverCard({
      outTrackId: 'card-1',
      openSpaceId: 'dtv1.card//IM_ROBOT.owner-1',
      robotCode: 'ding-app',
      space: 'p2p',
      cardParamMap: dingtalkCardParams({ title: 'Rovai', content: '完成' })
    })).resolves.toEqual({ outTrackId: 'card-1', recallMessageId: 'carrier-1' })

    expect(calls[1]?.body).toMatchObject({
      cardTemplateId: DINGTALK_AI_CARD_TEMPLATE_ID,
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: false },
      imRobotOpenSpaceModel: { supportForward: false }
    })
    expect(calls[2]?.body).toMatchObject({
      outTrackId: 'card-1',
      openSpaceId: 'dtv1.card//IM_ROBOT.owner-1',
      imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT' }
    })
    expect(calls[2]?.body.imRobotOpenDeliverModel).not.toHaveProperty('robotCode')
  })

  it.each([
    ['group', '/v1.0/robot/groupMessages/recall', { openConversationId: 'group-1' }],
    ['p2p', '/v1.0/robot/otoMessages/batchRecall', {}]
  ] as const)('recalls a delivered %s card by its carrier identity', async (
    conversationKind,
    path,
    expectedTarget
  ) => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Response.json(url.endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { successResult: ['carrier-1'], failedResult: {} })
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await client.recallRobotMessage({
      conversationKind,
      chatId: 'group-1',
      robotCode: 'robot-1',
      recallMessageId: 'carrier-1'
    })

    expect(calls[1]?.url).toContain(path)
    expect(calls[1]?.body).toEqual({
      processQueryKeys: ['carrier-1'],
      robotCode: 'robot-1',
      ...expectedTarget
    })
  })

  it('rejects a partial recall response instead of treating it as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => Response.json(
      String(input).endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { successResult: [], failedResult: { 'carrier-1': 'SYSTEM_ERROR' } }
    )))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.recallRobotMessage({
      conversationKind: 'p2p',
      chatId: 'owner-1',
      robotCode: 'robot-1',
      recallMessageId: 'carrier-1'
    })).rejects.toThrow('dingtalk_open_api_recall_failed')
  })

  it('rejects a card space whose type does not match the delivery model', async () => {
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })
    await expect(client.createAndDeliverCard({
      outTrackId: 'card-1',
      openSpaceId: 'dtv1.card//IM_GROUP.group-1',
      robotCode: 'ding-app',
      space: 'p2p',
      cardParamMap: {}
    })).rejects.toThrow('dingtalk_card_space_invalid')
  })

  it('rejects a delivery result that has a carrier but no explicit success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => Response.json(
      String(input).endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : String(input).endsWith('/card/instances/deliver')
          ? { result: [{ carrierId: 'carrier-1' }] }
          : { success: true }
    )))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.createAndDeliverCard({
      outTrackId: 'card-1',
      openSpaceId: 'dtv1.card//IM_ROBOT.owner-1',
      robotCode: 'robot-1',
      space: 'p2p',
      cardParamMap: dingtalkCardParams({ title: 'Rovai', content: '完成' })
    })).rejects.toThrow('dingtalk_open_api_card_delivery_failed')
  })

  it('rejects nested per-target business failures returned with HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => Response.json(
      String(input).endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { success: true, result: [{ success: false, errorCode: 'space.invalid' }] }
    )))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })
    await expect(client.sendPrivateMarkdown({
      robotCode: 'ding-app',
      userId: 'owner-1',
      title: 'Rovai',
      text: 'hello'
    })).rejects.toThrow('dingtalk_open_api_failed')
  })

  it('does not fabricate a successful Markdown delivery identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => Response.json(
      String(input).endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { success: true }
    )))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.sendGroupMarkdown({
      openConversationId: 'group-1',
      robotCode: 'ding-app',
      title: 'Rovai',
      text: 'hello'
    })).rejects.toThrow('dingtalk_open_api_delivery_identity_missing')
  })

  it('sends group Markdown through the official group message endpoint', async () => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Response.json(url.endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { processQueryKey: 'delivery-1' })
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.sendGroupMarkdown({
      openConversationId: 'group-1',
      robotCode: 'ding-app',
      title: 'Rovai',
      text: 'hello'
    })).resolves.toBe('delivery-1')

    expect(calls[1]).toEqual({
      url: 'https://api.dingtalk.com/v1.0/robot/groupMessages/send',
      body: {
        openConversationId: 'group-1',
        robotCode: 'ding-app',
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ title: 'Rovai', text: 'hello' })
      }
    })
  })

  it('reads the official chatbotInstanceVOList roster response', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input)
      calls.push(url)
      return Response.json(
        url.endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : {
            chatbotInstanceVOList: [
              { robotCode: 'ding-b' },
              { robotCode: 'ding-a', appKey: 'must-not-replace-robot-code' },
              { robotCode: 'ding-a' }
            ]
          }
      )
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.groupRobotCodes('cid-group')).resolves.toEqual(['ding-a', 'ding-b'])
    expect(calls[1]).toBe('https://api.dingtalk.com/v1.0/robot/groups/robots/query')
  })

  it('finalizes failed streaming cards with a unique guid and error marker', async () => {
    const calls: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Response.json(url.endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : { success: true })
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await client.streamCard('card-1', '执行失败', true, true)

    expect(calls[1]?.body).toMatchObject({
      outTrackId: 'card-1',
      key: 'msgContent',
      content: '执行失败',
      isFull: true,
      isFinalize: true,
      isError: true
    })
    expect(calls[1]?.body.guid).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('keeps streaming and terminal card fields distinct', () => {
    const streaming = dingtalkCardParams({
      title: '执行中', content: '正在处理', flowStatus: '1', streamingContent: true
    })
    const terminal = dingtalkCardParams({
      title: '完成', content: '结果', flowStatus: '3'
    })

    expect(streaming).toMatchObject({
      flowStatus: '1', msgContent: '正在处理', staticMsgContent: ''
    })
    expect(JSON.parse(streaming.sys_full_json_obj).order).toEqual([
      'msgTitle', 'msgContent', 'msgButtons'
    ])
    expect(terminal).toMatchObject({
      flowStatus: '3', msgContent: '', staticMsgContent: '结果'
    })
    expect(JSON.parse(terminal.sys_full_json_obj).order).toEqual([
      'msgTitle', 'staticMsgContent', 'msgButtons'
    ])
  })

  it('keeps callback values separate from a direct LAN execution URL', () => {
    const url = 'http://192.168.1.23:8765/execution/run-1#t=grant-token'
    const params = dingtalkCardParams({
      title: '爱丽丝 · 执行中',
      content: null,
      buttons: [
        { title: '显示最近输出', value: { action: 'execution_recent_output', agentRunId: 'run-1' } },
        { title: '打开执行台', url },
        {
          title: '停止执行',
          color: 'red',
          value: { action: 'execution_stop', agentRunId: 'run-1' }
        }
      ]
    })
    const system = JSON.parse(params.sys_full_json_obj) as {
      order: string[]
      msgButtons: Array<{
        text: string
        color: string
        id?: string
        request?: boolean
        url?: string
        iosUrl?: string
      }>
    }

    expect(system.order).toEqual(['msgTitle', 'msgButtons'])
    expect(system.msgButtons).toHaveLength(3)
    expect(system.msgButtons[0]).toMatchObject({
      text: '显示最近输出', color: 'gray', request: true
    })
    expect(decodeDingTalkCardActionId(system.msgButtons[0].id ?? '')).toEqual({
      action: 'execution_recent_output', agentRunId: 'run-1'
    })
    expect(system.msgButtons[1]).toEqual({
      text: '打开执行台', color: 'blue', url, iosUrl: url
    })
    expect(system.msgButtons[2]).toMatchObject({
      text: '停止执行', color: 'red', request: true
    })
  })

  it('rejects malformed or oversized dynamic card action ids', () => {
    expect(decodeDingTalkCardActionId('rovai.v1.not+base64')).toBeNull()
    expect(decodeDingTalkCardActionId('rovai.v1.W10')).toBeNull()
    expect(() => dingtalkCardParams({
      title: 'Rovai',
      buttons: [{ title: '操作', value: { payload: 'x'.repeat(4_096) } }]
    })).toThrow('dingtalk_card_action_too_large')
  })
})
