import { describe, expect, it, vi } from 'vitest'
import { ContactSearchError } from './feishu-contact-search'
import type { ChatBotView, CoreMethod } from '@contracts'
import {
  ChannelChatService,
  type ChatCore,
  type ChatInboundInput,
  type ChatSendReceipt
} from './channel-chat-service'

type TurnState = 'pending' | 'running' | 'completed' | 'failed' | 'waiting'

type State = {
  config: ChatBotView
  duplicate: boolean
  turn: { status: TurnState; text: string | null }
  submitted: string[]
  pending: Array<{ campMessageId: string; chatId: string; submittedAt: number }>
  enqueueKeys: Record<string, string>
  outbound: Array<{ id: string; chatId: string; text: string; source: string; attempts: number; targetKind: 'chat_id' | 'open_id'; leaseToken: string }>
  settled: Array<{ id: string; status: string }>
  appended: string[]
  sent: Array<{ target: string; text: string }>
}

function fakeCore(state: State): ChatCore {
  let outboundSeq = 0
  return ({
    request: async (method: CoreMethod, params?: unknown): Promise<unknown> => {
      const payload = (params ?? {}) as Record<string, any>
      switch (method) {
        case 'channels.chat.inbound':
          return { mode: state.config.mode, duplicate: state.duplicate, owner: false }
        case 'channels.chat.snapshot':
          return state.config
        case 'channels.chat.pending':
          return state.pending
        case 'channels.chat.submit': {
          if (state.duplicate && state.submitted.length) return { campMessageId: state.submitted[0], duplicate: true }
          const id = 'msg-' + (state.submitted.length + 1)
          state.submitted.push(id)
          state.pending.push({ campMessageId: id, chatId: payload.chatId, submittedAt: Date.now() })
          return { campId: 'camp-1', campMessageId: id, duplicate: false }
        }
        case 'channels.chat.result':
          return { status: state.turn.status, text: state.turn.text, reason: null }
        case 'channels.chat.outbound.enqueue': {
          const existing = state.enqueueKeys[payload.command.idempotencyKey]
          if (existing) return { outboundId: existing, duplicate: true }
          if (payload.command.completeTurn) state.pending = state.pending.filter((turn) => turn.campMessageId !== payload.command.campMessageId)
          const id = 'out-' + (outboundSeq += 1)
          state.enqueueKeys[payload.command.idempotencyKey] = id
          state.outbound.push({
            id,
            chatId: payload.command.chatId,
            text: payload.command.text,
            source: payload.command.source,
            attempts: 0,
            targetKind: 'chat_id',
            leaseToken: 'lease-' + id
          })
          return { outboundId: id, duplicate: false }
        }
        case 'channels.chat.outbound.claim': {
          const claimable = state.outbound.filter(
            (candidate) => !state.settled.some((settled) => settled.id === candidate.id)
          )
          for (const candidate of claimable) candidate.attempts += 1
          return claimable
        }
        case 'channels.chat.outbound.settle': {
          state.settled.push({ id: payload.command.outboundId, status: payload.command.status })
          return { settled: true }
        }
        case 'channels.chat.turn.append':
          state.appended.push(payload.command.body)
          return { appended: true }
        default:
          throw new Error('unexpected core method ' + method)
      }
    }
  }) as ChatCore
}

function chatConfig(overrides: Partial<ChatBotView> = {}): ChatBotView {
  return {
    agentId: 'agent-1',
    ownerOnly: false,
    mode: 'chat',
    materialsPath: 'C:/materials',
    ...overrides
  }
}

function baseState(overrides: Partial<State> = {}): State {
  return {
    config: chatConfig(),
    duplicate: false,
    turn: { status: 'completed', text: '好的，已记下。' },
    submitted: [],
    pending: [],
    enqueueKeys: {},
    outbound: [],
    settled: [],
    appended: [],
    sent: [],
    ...overrides
  }
}

function inbound(overrides: Partial<ChatInboundInput> = {}): ChatInboundInput {
  return {
    chatId: 'oc_test',
    chatName: '项目群',
    conversationKind: 'group',
    authorExternalId: 'ou_colleague',
    authorName: '同事',
    isOwner: false,
    body: '帮我记一条备忘',
    externalMessageId: 'om_1',
    quoteMessageId: null,
    mentions: [],
    ...overrides
  }
}

function harness(state: State): ChannelChatService {
  return new ChannelChatService({
    provider: 'feishu',
    appId: 'cli_test',
    core: fakeCore(state),
    sendText: async (target, text): Promise<ChatSendReceipt> => {
      state.sent.push({ target, text })
      return { status: 'sent', messageId: 'om_sent' }
    }
  })
}

describe('ChannelChatService', () => {
  it('recovers an admitted turn after Host restart without receiving inbound again', async () => {
    const state = baseState()
    const first = harness(state)
    await first.handleInbound(inbound())
    first.stop()
    await harness(state).flush()
    expect(state.submitted).toHaveLength(1)
    expect(state.sent).toHaveLength(1)
    expect(state.pending).toHaveLength(0)
    await harness(state).flush()
    expect(state.sent).toHaveLength(1)
  })

  it('retains the turn after enqueue failure and replays the same durable key', async () => {
    const state = baseState({ pending: [{ campMessageId: 'msg-recovered', chatId: 'oc_test', submittedAt: Date.now() }] })
    const base = fakeCore(state)
    let fail = true
    const request = vi.fn(async (method: CoreMethod, params?: unknown) => {
      if (method === 'channels.chat.outbound.enqueue' && fail) { fail = false; throw new Error('offline') }
      return base.request(method, params)
    })
    const sendText = vi.fn(async () => ({ status: 'sent' as const, messageId: 'om_sent' }))
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText })
    await service.flush()
    expect(state.pending).toHaveLength(1)
    expect(sendText).not.toHaveBeenCalled()
    await service.flush()
    expect(state.pending).toHaveLength(0)
    const enqueues = request.mock.calls.filter(([method]) => method === 'channels.chat.outbound.enqueue')
    expect(enqueues[0][1]).toEqual(enqueues[1][1])
    expect(enqueues[1][1]).toMatchObject({ command: { campMessageId: 'msg-recovered', completeTurn: true } })
  })

  it('keeps waiting notices pending, preserves the waiting clock and sends the later final reply', async () => {
    vi.useFakeTimers()
    try {
      const state = baseState({ turn: { status: 'waiting', text: null } })
      const service = harness(state)
      await service.handleInbound(inbound())
      await service.flush()
      await vi.advanceTimersByTimeAsync(9 * 60_000)
      await service.flush()
      expect(state.sent).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(60_000)
      await service.flush()
      expect(state.sent).toHaveLength(1)
      expect(state.pending).toHaveLength(1)
      await service.flush()
      expect(state.sent).toHaveLength(1)
      state.turn = { status: 'completed', text: '确认后完成了。' }
      await service.flush()
      expect(state.sent.map((sent) => sent.text)).toEqual(['这条消息需要在应用里确认后才能继续。', '确认后完成了。'])
      expect(state.pending).toHaveLength(0)
    } finally { vi.useRealTimers() }
  })

  it('uses persisted submittedAt for timeout notices without completing the turn', async () => {
    const state = baseState({ turn: { status: 'running', text: null }, pending: [{ campMessageId: 'old', chatId: 'oc_test', submittedAt: Date.now() - 31 * 60_000 }] })
    const service = harness(state)
    await service.flush()
    expect(state.sent[0].text).toContain('处理时间过长')
    expect(state.pending).toHaveLength(1)
    await service.flush()
    expect(state.sent).toHaveLength(1)
    state.turn = { status: 'completed', text: '最终结果' }
    await service.flush()
    expect(state.sent).toHaveLength(2)
  })

  it('delivers ordinary replies while a contact search is hung', async () => {
    vi.useFakeTimers()
    try {
      const state = baseState({ pending: [{ campMessageId: 'ready', chatId: 'oc_test', submittedAt: Date.now() }] })
      const base = fakeCore(state)
      const request = vi.fn(async (method: CoreMethod, params?: unknown) => {
        if (method === 'channels.chat.tools.claim') return [{ requestId: 'req', leaseToken: 'lease', query: 'name' }]
        if (method === 'channels.chat.tools.settle') return { settled: true }
        return base.request(method, params)
      })
      const sendText = vi.fn(async () => ({ status: 'sent' as const, messageId: 'om_sent' }))
      const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText, searchContacts: () => new Promise(() => {}) })
      const flushing = service.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(sendText).toHaveBeenCalledTimes(1)
      expect(request.mock.calls.some(([method]) => method === 'channels.chat.tools.settle')).toBe(false)
      await vi.advanceTimersByTimeAsync(15_001)
      await flushing
      expect(request).toHaveBeenCalledWith('channels.chat.tools.settle', expect.objectContaining({ errorCode: 'unavailable' }))
    } finally { vi.useRealTimers() }
  })

  it('does not treat an unavailable pending RPC as an empty recovered state', async () => {
    const sendText = vi.fn()
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request: vi.fn(async () => { throw new Error('unavailable') }) }, sendText })
    await expect(service.flush()).rejects.toThrow('unavailable')
    expect(sendText).not.toHaveBeenCalled()
  })

  it('records bounded mentions and submits the external message identity', async () => {
    const state = baseState()
    const request = vi.fn(fakeCore(state).request)
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText: vi.fn() })
    await service.handleInbound(inbound({ mentions: [{ openId: null, name: 'unknown' }, ...Array.from({ length: 25 }, (_, i) => ({ openId: 'ou_' + i, name: 'name' }))] }))
    const observed = request.mock.calls.find(([method]) => method === 'channels.chat.inbound')![1] as any
    expect(observed.command.mentions).toHaveLength(20)
    expect(request).toHaveBeenCalledWith('channels.chat.submit', expect.objectContaining({ externalMessageId: 'om_1' }))
  })

  it('claims searches, sanitizes contacts and settles the exact worker lease', async () => {
    const searchContacts = vi.fn(async () => Array.from({ length: 25 }, (_, i) => ({ openId: 'ou_' + i, name: '同事', appSecret: 'private' })))
    const request = vi.fn(async (method: string) => method === 'channels.chat.tools.claim'
      ? [{ requestId: 'req', leaseToken: 'lease', query: '同事' }] : (method === 'channels.chat.outbound.claim' || method === 'channels.chat.pending') ? [] : { settled: false })
    const service = new ChannelChatService({ provider: 'lark', appId: 'cli_test', core: { request } as ChatCore, searchContacts, sendText: vi.fn() })
    await service.flush()
    expect(searchContacts).toHaveBeenCalledWith('同事', expect.any(AbortSignal))
    const claim = request.mock.calls.find(([method]) => method === 'channels.chat.tools.claim') as unknown as [string, any]
    const settle = request.mock.calls.find(([method]) => method === 'channels.chat.tools.settle') as unknown as [string, any]
    expect(settle[1]).toMatchObject({ provider: 'lark', appId: 'cli_test', workerId: claim[1].workerId, requestId: 'req', leaseToken: 'lease', errorCode: null })
    expect(settle[1].contacts).toHaveLength(20)
    expect(JSON.stringify(settle)).not.toContain('private')
    expect(searchContacts).toHaveBeenCalledTimes(1)
  })

  it.each([new ContactSearchError('permission_denied', 'private token'), new Error('private token')])('settles only closed error codes', async (error) => {
    const request = vi.fn(async (method: string) => method === 'channels.chat.tools.claim'
      ? [{ requestId: 'req', leaseToken: 'lease', query: '同事' }] : (method === 'channels.chat.outbound.claim' || method === 'channels.chat.pending') ? [] : { settled: true })
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore,
      searchContacts: async () => { throw error }, sendText: vi.fn() })
    await service.flush()
    expect(request).toHaveBeenCalledWith('channels.chat.tools.settle', expect.objectContaining({ contacts: [], errorCode: error instanceof ContactSearchError ? 'permission_denied' : 'unavailable' }))
    expect(JSON.stringify(request.mock.calls)).not.toContain('private token')
  })

  it('bounds a hung search and honors cancellation without late settlement', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn(async (method: string) => method === 'channels.chat.tools.claim'
        ? [{ requestId: 'req', leaseToken: 'lease', query: '同事' }] : (method === 'channels.chat.outbound.claim' || method === 'channels.chat.pending') ? [] : { settled: true })
      const searchContacts = vi.fn(async () => new Promise<never>(() => {}))
      const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, searchContacts, sendText: vi.fn() })
      const flush = service.flush()
      await vi.advanceTimersByTimeAsync(15_001)
      await flush
      expect(request).toHaveBeenCalledWith('channels.chat.tools.settle', expect.objectContaining({ errorCode: 'unavailable' }))
      request.mockClear()
      const stopped = service.flush()
      await vi.advanceTimersByTimeAsync(0)
      service.stop()
      await stopped
      expect(request.mock.calls.some(([method]) => method === 'channels.chat.tools.settle')).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('does not claim work while disconnected or stopped', async () => {
    const request = vi.fn()
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request }, isReady: () => false, searchContacts: vi.fn(), sendText: vi.fn() })
    await service.flush()
    service.stop()
    await service.flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('uses the claimed target kind, persisted outbound identity and matching lease receipt', async () => {
    const state = baseState({ outbound: [{ id: 'durable-out', chatId: 'ou_not_a_dm', targetKind: 'chat_id', text: 'hello', source: 'runtime_tool', attempts: 0, leaseToken: 'lease-a' }] })
    const request = vi.fn(fakeCore(state).request)
    const sendText = vi.fn(async () => ({ status: 'sent' as const, messageId: 'om_sent' }))
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText })
    await service.flush()
    await service.flush()
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith('ou_not_a_dm', 'hello', 'chat', 'durable-out')
    expect(request).toHaveBeenCalledWith('channels.chat.outbound.settle', expect.objectContaining({ commandId: 'chat-settle-durable-out-lease-a', command: expect.objectContaining({ outboundId: 'durable-out', workerId: expect.any(String), leaseToken: 'lease-a' }) }))
  })

  it('records an in-flight send with its original lease after stop and never starts the next send', async () => {
    const state = baseState({ outbound: [
      { id: 'first', chatId: 'ou_person', targetKind: 'open_id', text: 'hello', source: 'runtime_tool', attempts: 0, leaseToken: 'lease-first' },
      { id: 'next', chatId: 'ou_other', targetKind: 'open_id', text: 'next', source: 'runtime_tool', attempts: 0, leaseToken: 'lease-next' }
    ] })
    const request = vi.fn(fakeCore(state).request)
    let finish!: (receipt: ChatSendReceipt) => void
    const sendText = vi.fn(() => new Promise<ChatSendReceipt>((resolve) => { finish = resolve }))
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText })
    const flushing = service.flush()
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1))
    const claim = request.mock.calls.find(([method]) => method === 'channels.chat.outbound.claim')![1] as any
    service.stop()
    finish({ status: 'sent', messageId: 'om_delivered' })
    await flushing
    expect(request).toHaveBeenCalledWith('channels.chat.outbound.settle', expect.objectContaining({ command: expect.objectContaining({ outboundId: 'first', workerId: claim.workerId, leaseToken: 'lease-first', status: 'sent' }) }))
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('does not append assistant history for duplicate or stale receipts', async () => {
    const state = baseState({ outbound: [{ id: 'durable-out', chatId: 'oc_group', targetKind: 'chat_id', text: 'hello', source: 'reply', attempts: 0, leaseToken: 'stale' }] })
    const base = fakeCore(state)
    const request = vi.fn(async (method: CoreMethod, params?: unknown) => method === 'channels.chat.outbound.settle' ? { settled: false } : base.request(method, params))
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: { request } as ChatCore, sendText: async () => ({ status: 'sent', messageId: 'om_sent' }) })
    expect(await service.flush()).toEqual([])
    expect(state.appended).toEqual([])
  })

  it('does not blindly retry sends with an unknown mutation outcome', async () => {
    const state = baseState({ outbound: [{ id: 'durable-out', chatId: 'ou_person', targetKind: 'open_id', text: 'hello', source: 'runtime_tool', attempts: 0, leaseToken: 'lease-a' }] })
    const sendText = vi.fn(async () => { throw new Error('private-token') })
    const service = new ChannelChatService({ provider: 'feishu', appId: 'cli_test', core: fakeCore(state), sendText })
    expect((await service.flush())[0].status).toBe('unknown')
    await service.flush()
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(state.settled).toEqual([{ id: 'durable-out', status: 'unknown' }])
  })

  it('submits one turn and delivers the assistant text from Core', async () => {
    const state = baseState()
    const service = harness(state)

    await service.handleInbound(inbound())
    expect(state.submitted).toHaveLength(1)
    expect(state.sent).toHaveLength(0)

    const results = await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '好的，已记下。' }])
    expect(results[0]?.status).toBe('sent')
    expect(state.appended).toEqual(['好的，已记下。'])
  })

  it('resubmits duplicate inbound idempotently and ignores work-mode Bots', async () => {
    const duplicate = baseState({ duplicate: true })
    const service = harness(duplicate)
    await service.handleInbound(inbound())
    await service.handleInbound(inbound())
    expect(duplicate.submitted).toHaveLength(1)

    const work = baseState({ config: chatConfig({ ownerOnly: true, mode: 'work' }) })
    await harness(work).handleInbound(inbound())
    expect(work.submitted).toHaveLength(0)
  })

  it('keeps polling while the Run is live and replies once it settles', async () => {
    const state = baseState({ turn: { status: 'pending', text: null } })
    const service = harness(state)

    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toHaveLength(0)

    state.turn = { status: 'completed', text: '已经写好了。' }
    await service.flush()
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '已经写好了。' }])
  })

  it('explains a failed Run instead of staying silent', async () => {
    const state = baseState({ turn: { status: 'failed', text: null } })
    const service = harness(state)
    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '暂时无法回复，请稍后再试。' }])
  })

  it('reports an empty assistant message instead of sending nothing', async () => {
    const state = baseState({ turn: { status: 'completed', text: '   ' } })
    const service = harness(state)
    await service.handleInbound(inbound())
    await service.flush()
    expect(state.sent).toEqual([{ target: 'oc_test', text: '这条消息没有生成可发送的回复。' }])
  })
})
