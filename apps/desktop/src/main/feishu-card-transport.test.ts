import { createHash } from 'node:crypto'
import { createLarkChannel, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'
import { describe, expect, it, vi } from 'vitest'
import { FeishuExecutionPreviewService } from './feishu-execution-preview'

function sdkChannel() {
  return createLarkChannel({
    appId: 'cli_card_transport_fixture',
    appSecret: 'not-a-real-secret',
    transport: 'websocket',
    includeRawEvent: true,
    loggerLevel: LoggerLevel.error,
    safety: { dedup: { ttl: 600_000 }, chatQueue: { enabled: true } }
  })
}

describe('Feishu execution-card SDK transport', () => {
  it('does not report a resolved provider business failure as a successful card update', async () => {
    const channel = sdkChannel()
    const patch = vi.spyOn(channel.rawClient.im.v1.message, 'patch')
      .mockResolvedValue({ code: 230099, msg: 'upstream-private-response' })

    await expect(channel.updateCard('om_transport_failure', { schema: '2.0', body: { elements: [] } }))
      .rejects.toMatchObject({ message: 'feishu_card_update_failed', cause: { code: 230099 } })
    expect(patch).toHaveBeenCalledTimes(1)
    patch.mockResolvedValueOnce(undefined as never)
    await expect(channel.updateCard('om_transport_failure', {})).rejects.toThrow('feishu_card_update_failed')
  })

  it('allows distinct next / previous / next clicks while deduplicating a delivery of the same click', async () => {
    const channel = sdkChannel()
    const patch = vi.spyOn(channel.rawClient.im.v1.message, 'patch').mockResolvedValue({ code: 0 })
    const internals = channel as unknown as {
      registerDispatcherHandlers: () => void
      dispatcher: { invoke: (event: unknown, options: { needCheck: false }) => Promise<unknown> }
    }
    internals.registerDispatcherHandlers()
    channel.on('cardAction', async (event) => {
      const value = event.action.value as { pageIndex: number }
      await channel.updateCard(event.messageId, { schema: '2.0', body: {
        elements: [{ tag: 'markdown', content: `page ${value.pageIndex + 1}` }]
      } })
      return {}
    })
    const click = (eventId: string, pageIndex: number) => ({
      schema: '2.0',
      header: { event_type: 'card.action.trigger', event_id: eventId, app_id: 'cli_card_transport_fixture' },
      event: {
        context: { open_message_id: 'om_transport_round_trip', open_chat_id: 'oc_transport_round_trip' },
        operator: { open_id: 'ou_transport_owner' },
        action: { tag: 'button', value: { action: 'execution_console_page', agentRunId: 'run_transport',
          snapshotSequence: 1, pageIndex } }
      }
    })
    for (const [id, page] of [['click-next-1', 1], ['click-previous', 0], ['click-next-2', 1]] as const) {
      await internals.dispatcher.invoke(click(id, page), { needCheck: false })
    }
    expect(patch.mock.calls.map(([request]) => JSON.parse(request!.data!.content).body.elements[0].content))
      .toEqual(['page 2', 'page 1', 'page 2'])

    await internals.dispatcher.invoke(click('click-next-2', 1), { needCheck: false })
    expect(patch).toHaveBeenCalledTimes(3)
  })

  it('carries a preview page and a safe error through the actual SDK WebSocket ACK path', async () => {
    const channel = sdkChannel()
    const appId = 'cli_card_transport_fixture'
    const openId = 'ou_transport_owner'
    const requestId = 'bcf062f3-a1df-430e-82ca-cb27b7f38564'
    vi.spyOn(channel.rawClient.im.v1.message, 'create').mockResolvedValue({ code: 0, data: { message_id: 'om_wire_preview' } })
    vi.spyOn(channel.rawClient.im.v1.message, 'get').mockResolvedValue({ code: 0, data: { items: [{
      message_id: 'om_wire_preview', msg_type: 'interactive', sender: { id: appId, id_type: 'app_id', sender_type: 'app' }
    }] } })
    const patch = vi.spyOn(channel.rawClient.im.v1.message, 'patch').mockResolvedValue({ code: 0 })
    const report = vi.fn()
    const preview = new FeishuExecutionPreviewService({ requestId, agentId: 'agent-fixture', commandCounts: [31] }, {
      readOwner: () => ({ accountId: 'account-fixture', displayName: '惠', openId,
        openIdDigest: `sha256:${createHash('sha256').update(`feishu-open\0${openId}`).digest('hex')}` }),
      report
    })
    await preview.connected('agent-fixture', appId, channel)
    channel.on('cardAction', async event => await preview.handleCardAction(appId, event, channel) ?? {})
    const internals = channel as unknown as {
      registerDispatcherHandlers: () => void
      dispatcher: unknown
    }
    internals.registerDispatcherHandlers()
    // Exercise frame reassembly, dispatcher, normalization and callback response
    // encoding without opening a second real WebSocket or reading credentials.
    const transport = new WSClient({ appId, appSecret: 'not-a-real-secret', loggerLevel: LoggerLevel.error })
    type Frame = { headers: Array<{ key: string; value: string }>; payload: Uint8Array }
    const wire = transport as unknown as {
      eventDispatcher: unknown
      handleEventData: (frame: Frame) => Promise<void>
      sendMessage: (frame: Frame) => void
    }
    wire.eventDispatcher = internals.dispatcher
    const send = vi.spyOn(wire, 'sendMessage').mockImplementation(() => undefined)
    const click = async (id: string, pageIndex: number) => {
      await wire.handleEventData({
        headers: [{ key: 'type', value: 'event' }, { key: 'message_id', value: id },
          { key: 'sum', value: '1' }, { key: 'seq', value: '0' }],
        payload: Buffer.from(JSON.stringify({ schema: '2.0',
          header: { event_type: 'card.action.trigger', event_id: id, app_id: appId },
          event: { context: { open_message_id: 'om_wire_preview', open_chat_id: 'oc_wire_preview' },
            operator: { open_id: openId }, action: { tag: 'button', value: { action: 'execution_console_page',
              agentRunId: `feishu-preview:${requestId}:agent-fixture:31`, snapshotSequence: 1, pageIndex } } }
        }))
      })
      const ack = JSON.parse(Buffer.from(send.mock.calls.at(-1)![0].payload).toString())
      expect(ack.code).toBe(200)
      return JSON.parse(Buffer.from(ack.data, 'base64').toString())
    }
    try {
      expect(await click('wire-next', 1)).toEqual({})
      expect(patch).toHaveBeenCalledTimes(1)
      const card = JSON.parse(patch.mock.calls[0][0]!.data!.content)
      const outer = card.body.elements.find((element: { element_id?: string }) => element.element_id === 'execution_process')
      expect(outer.expanded).toBe(true)
      expect(outer.elements).toContainEqual({ tag: 'markdown', content: '第 2 / 3 页', text_align: 'center' })

      patch.mockResolvedValueOnce({ code: 230099, msg: 'private-provider-message' })
      expect(await click('wire-previous-fails', 0)).toEqual({ toast: {
        type: 'error', content: '执行记录暂时无法翻页，请稍后重试'
      } })
      expect(patch).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenCalledWith({ stage: 'page_failed', reason: 'card_update_failed', providerCode: 230099 })
      expect(JSON.stringify(report.mock.calls)).not.toContain('private-provider-message')
    } finally { transport.close() }
  })
})
