import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DINGTALK_AI_CARD_TEMPLATE_ID,
  DingTalkOpenApiClient,
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
        : { success: true })
    }))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })
    await client.createAndDeliverCard({
      outTrackId: 'card-1',
      openSpaceId: 'dtv1.card//IM_ROBOT.owner-1',
      robotCode: 'ding-app',
      space: 'p2p',
      cardParamMap: dingtalkCardParams({ title: 'Rovai', content: '完成' })
    })

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

  it('reads the official chatbotInstanceVOList roster response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => Response.json(
      String(input).endsWith('/oauth2/accessToken')
        ? { accessToken: 'token', expireIn: 7200 }
        : {
            chatbotInstanceVOList: [
              { robotCode: 'ding-b' },
              { robotCode: 'ding-a', appKey: 'must-not-replace-robot-code' },
              { robotCode: 'ding-a' }
            ]
          }
    )))
    const client = new DingTalkOpenApiClient({ appKey: 'ding-app', appSecret: 'secret' })

    await expect(client.groupRobotCodes('cid-group')).resolves.toEqual(['ding-a', 'ding-b'])
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
    expect(dingtalkCardParams({
      title: '执行中', content: '正在处理', flowStatus: '1', streamingContent: true
    })).toMatchObject({
      flowStatus: '1', msgContent: '正在处理', staticMsgContent: ''
    })
    expect(dingtalkCardParams({
      title: '完成', content: '结果', flowStatus: '3'
    })).toMatchObject({
      flowStatus: '3', msgContent: '', staticMsgContent: '结果'
    })
  })

  it('keeps callback values separate from a direct LAN execution URL', () => {
    const url = 'http://192.168.1.23:8765/execution/run-1#t=grant-token'
    const params = dingtalkCardParams({
      title: '爱丽丝 · 执行中',
      content: null,
      buttons: [
        { title: '显示最近输出', value: { action: 'execution_recent_output', agentRunId: 'run-1' } },
        { title: '打开执行台', url },
        { title: '停止执行', value: { action: 'execution_stop', agentRunId: 'run-1' } }
      ]
    })
    const system = JSON.parse(params.sys_full_json_obj) as {
      order: string[]
      msgButtons: Array<{ title: string; action: { type: string; value: string } }>
    }

    expect(system.order).toEqual(['msgTitle', 'msgButtons'])
    expect(system.msgButtons).toHaveLength(3)
    expect(system.msgButtons[0].action).toEqual({
      type: 'callback',
      value: JSON.stringify({ action: 'execution_recent_output', agentRunId: 'run-1' })
    })
    expect(system.msgButtons[1].action).toEqual({ type: 'url', value: url })
    expect(system.msgButtons[2].action.type).toBe('callback')
  })
})
