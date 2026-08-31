import { describe, expect, it, vi } from 'vitest'
import { feishuAgentOutputCards, sendFeishuAgentOutput } from './feishu-agent-output-card'

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    presentationVersion: 1, body: '请核对检查结果。', mentionPrincipal: false,
    memberRecipients: [], reply: null, ...overrides
  }
}

function client() {
  return {
    create: vi.fn(async () => ({ code: 0, data: { message_id: 'om_created' } })),
    reply: vi.fn(async () => ({ code: 0, data: { message_id: 'om_reply' } }))
  }
}

describe('Feishu permanent Agent output cards', () => {
  it('places canonical recipients under the body, space-separated with no title or callback', () => {
    const cards = feishuAgentOutputCards(payload({
      mentionPrincipal: true,
      memberRecipients: [
        { agentId: 'agent_7', displayName: '雾切响子', openId: 'ou_kyoko' },
        { agentId: 'agent_1', displayName: '爱丽丝', openId: 'ou_alice' },
        { agentId: 'agent_7', displayName: '重复身份', openId: 'ou_kyoko' }
      ]
    }), 'ou_murray')
    expect(cards).toEqual([{
      schema: '2.0', config: { update_multi: true }, body: { elements: [
        { tag: 'markdown', content: '请核对检查结果。' },
        { tag: 'markdown', text_size: 'notation', content:
          '发送给 <at id="ou_kyoko"></at> <at id="ou_alice"></at> <at id="ou_murray"></at>' }
      ] }
    }])
    expect(JSON.stringify(cards)).not.toMatch(/header|button|callback|@你|Owner：|A2A 对象/)
  })

  it('does not invent recipients for public-only prose or turn literal markup into mentions', () => {
    const body = '正文保留 @你。示例：<at id="all"></at>，<AT email="x@y">人</AT>。'
    const cards = feishuAgentOutputCards(payload({ body }))
    expect(cards[0].body.elements).toEqual([{ tag: 'markdown', content:
      '正文保留 @你。示例：&lt;at id="all"&gt;&lt;/at&gt;，&lt;AT email="x@y"&gt;人&lt;/AT&gt;。' }])
    expect(JSON.stringify(cards)).not.toContain('发送给')
  })

  it('uses a literal identity fallback, never a guessed or injected native recipient', () => {
    const cards = feishuAgentOutputCards(payload({ mentionPrincipal: true, memberRecipients: [
      { agentId: 'agent_7', displayName: '响子<at id=all>', openId: 'ou_bad"><at id=all>' },
      { agentId: 'agent_1', displayName: '爱丽丝', openId: null }
    ] }), 'all')
    expect(cards[0].body.elements[1].content).toBe('发送给 @响子&#60;at id=all&#62; @爱丽丝 @Owner')
    expect(JSON.stringify(cards)).not.toContain('<at ')
  })

  it('places the true reply above the body, without notifying or linking to its author', () => {
    const cards = feishuAgentOutputCards(payload({
      reply: { status: 'available', messageId: 'cm_a2a', authorDisplayName: '药师寺惠',
        body: '你想找响子。\n请她帮忙检查。' },
      mentionPrincipal: true
    }), 'ou_murray')
    expect(cards[0].body.elements).toEqual([
      { tag: 'markdown', text_size: 'notation', content: '> 回复 药师寺惠\n> 你想找响子。\n> 请她帮忙检查。' },
      { tag: 'markdown', content: '请核对检查结果。' },
      { tag: 'markdown', text_size: 'notation', content: '发送给 <at id="ou_murray"></at>' }
    ])
    expect(JSON.stringify(cards)).not.toMatch(/cm_a2a|om_root|callback|button/)
    const [quote] = feishuAgentOutputCards(payload({ reply: {
      status: 'available', messageId: 'cm_user', authorDisplayName: '<at id=all>',
      body: '<at id="all"></at>\n[链接](https://example.com) **文字**'
    } }))[0].body.elements
    expect(quote.content).not.toMatch(/<at |\[链接\]|\*\*文字\*\*/)
    expect(quote.content).toContain('&#60;')
    expect(quote.content.split('\n').every((line) => line.startsWith('> '))).toBe(true)
  })

  it('omits an absent reply and uses a static placeholder for an unavailable or empty parent', () => {
    for (const reply of [null, undefined]) {
      expect(feishuAgentOutputCards(payload({ reply }))[0].body.elements)
        .toEqual([{ tag: 'markdown', content: '请核对检查结果。' }])
    }
    expect(feishuAgentOutputCards(payload({ reply: { status: 'unavailable' } }))[0].body.elements[0])
      .toEqual({ tag: 'markdown', text_size: 'notation', content: '> 回复的消息已不可用' })
    expect(feishuAgentOutputCards(payload({ reply: {
      status: 'available', messageId: 'cm_empty', authorDisplayName: 'Murray', body: ''
    } }))[0].body.elements[0].content).toBe('> 回复 Murray\n> （无文本）')
  })

  it('keeps a long Unicode body complete, with the reply only first and mentions only last', () => {
    const body = '正文😀"\\'.repeat(8_000)
    const cards = feishuAgentOutputCards(payload({ body, mentionPrincipal: true, reply: {
      status: 'available', messageId: 'cm_parent', authorDisplayName: '药师寺惠', body: '原消息摘要。'
    } }), 'ou_murray')
    expect(cards.length).toBeGreaterThan(1)
    expect(cards.flatMap((card) => card.body.elements.filter((element) => !element.text_size))
      .map((element) => element.content).join('')).toBe(body)
    expect(cards.every((card) => Buffer.byteLength(JSON.stringify(card)) <= 24_000)).toBe(true)
    expect(cards[0].body.elements[0].content).toBe('> 回复 药师寺惠\n> 原消息摘要。')
    expect(cards.slice(1).every((card) => !JSON.stringify(card).includes('> 回复'))).toBe(true)
    expect(cards.slice(0, -1).every((card) => !JSON.stringify(card).includes('发送给'))).toBe(true)
    expect(cards.at(-1)!.body.elements[1].content).toBe('发送给 <at id="ou_murray"></at>')
  })

  it('reopens fenced results across bounded cards without dropping any complete lines', () => {
    const lines = Array.from({ length: 800 }, (_, index) => `line-${index}: ${'结果'.repeat(20)}`)
    const body = `前言\n\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n\n结论`
    const cards = feishuAgentOutputCards(payload({ body }))
    expect(cards.length).toBeGreaterThan(1)
    const projected = cards.map((card) => card.body.elements[0].content)
    for (const chunk of projected) {
      expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0)
    }
    for (const line of lines) expect(projected.filter((chunk) => chunk.includes(line))).toHaveLength(1)
    expect(projected[0]).toContain('前言')
    expect(projected.at(-1)).toContain('结论')
    expect(cards.every((card) => Buffer.byteLength(JSON.stringify(card)) <= 24_000)).toBe(true)
  })

  it('requires the Core presentation revision instead of stripping legacy display strings', () => {
    expect(() => feishuAgentOutputCards({ body: '@你 旧正文', mentionPrincipal: true }))
      .toThrow('channel_output_projection_invalid')
    expect(() => feishuAgentOutputCards(payload({ body: ' ' }))).toThrow('channel_output_empty')
    expect(feishuAgentOutputCards(payload({ body: '', mentionPrincipal: true }), 'ou_owner')[0]
      .body.elements).toEqual([{ tag: 'markdown', text_size: 'notation', content: '发送给 <at id="ou_owner"></at>' }])
    for (const reply of [
      { status: 'unknown' },
      { status: 'available', messageId: 'cm_parent', authorDisplayName: '惠', body: '😀'.repeat(241) },
      { status: 'available', messageId: 'cm_parent', authorDisplayName: '惠', body: '1\n2\n3\n4' }
    ]) {
      expect(() => feishuAgentOutputCards(payload({ reply }))).toThrow('channel_output_projection_invalid')
    }
  })

  it('replies every part in the same Topic and reuses provider dedupe IDs after a partial failure', async () => {
    const api = client()
    api.reply.mockResolvedValueOnce({ code: 0, data: { message_id: 'om_first' } })
      .mockRejectedValueOnce(new Error('private-provider-response'))
    const input = {
      deliveryId: 'delivery-fixed', chatId: 'oc_group', topicKey: 'om_root',
      payload: payload({ body: '测试😀'.repeat(8_000), mentionPrincipal: true }), ownerOpenId: 'ou_owner'
    }
    await expect(sendFeishuAgentOutput(api, input)).rejects.toThrow('feishu_output_send_failed')
    const attempted = api.reply.mock.calls.map((call) => (call as unknown as [{ data: { uuid: string } }])[0].data.uuid)
    await sendFeishuAgentOutput(api, input)
    const calls = api.reply.mock.calls as unknown as Array<[{ path: { message_id: string }; data: {
      uuid: string; reply_in_thread: boolean; content: string; msg_type: string
    } }]>
    expect(calls[2][0].data.uuid).toBe(attempted[0])
    expect(calls[3][0].data.uuid).toBe(attempted[1])
    expect(calls.every(([request]) => request.path.message_id === 'om_root'
      && request.data.reply_in_thread && request.data.msg_type === 'interactive'
      && request.data.uuid.length === 50)).toBe(true)
    expect(api.create).not.toHaveBeenCalled()
  })

  it('creates a fresh permanent card without patching, and rejects business errors', async () => {
    const api = client()
    const input = { deliveryId: 'delivery-1', chatId: 'oc_dm', topicKey: '', payload: payload() }
    await expect(sendFeishuAgentOutput(api, input)).resolves.toBe('om_created')
    expect(api.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: 'oc_dm', msg_type: 'interactive', content: expect.any(String), uuid: expect.any(String) }
    })
    expect(api.reply).not.toHaveBeenCalled()
    api.create.mockResolvedValueOnce({ code: 230025, data: { message_id: 'om_not_success' } })
    await expect(sendFeishuAgentOutput(api, input)).rejects.toMatchObject({ code: 'format_error' })
  })
})
