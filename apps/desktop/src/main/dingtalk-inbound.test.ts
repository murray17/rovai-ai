import { describe, expect, it } from 'vitest'
import { hasCanonicalSingleDingTalkBotTarget } from './dingtalk-channel-settings'
import { normalizeDingTalkRobotMessage } from './dingtalk-inbound'

const binding = { appKey: 'ding-app-a', robotCode: 'ding-app-a' }

describe('DingTalk inbound normalization', () => {
  it('normalizes the official group callback identity, quote, and explicit mention', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-1',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      senderNick: 'Murray',
      conversationType: '2',
      conversationId: 'cid-group',
      conversationTitle: '协作群',
      chatbotUserId: 'ding-bot-user-a',
      isInAtList: true,
      atUsers: [{ dingtalkId: 'ding-bot-user-a' }],
      robotCode: 'ding-app-a',
      msgtype: 'text',
      text: { content: '检查登录模块' },
      repliedMsg: {
        senderNick: 'Alice',
        msgType: 'text',
        content: { text: '引用内容' }
      }
    }, binding)

    expect(message).toMatchObject({
      appId: 'ding-app-a',
      tenantKey: 'ding-corp',
      senderUserId: 'owner-user',
      conversationKind: 'group',
      chatId: 'cid-group',
      body: '检查登录模块',
      explicitlyAtBot: true,
      chatbotUserId: 'ding-bot-user-a',
      atUsers: [{ staffId: null, dingtalkId: 'ding-bot-user-a' }],
      quote: { senderDisplayName: 'Alice', body: '引用内容' }
    })
  })

  it('uses the exact receiving App and isInAtList even when provider Bot IDs disagree', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-group-bot-proof',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      senderNick: 'Murray',
      conversationType: '2',
      openConversationId: 'cid-group',
      // DingTalk documents chatbotUserId as opaque and ignorable. Real Stream
      // callbacks can encode it differently from the Bot entry in atUsers.
      chatbotUserId: '$:LWCP_v1:bot-user-a',
      isInAtList: true,
      atUsers: [
        { dingtalkId: '$:LW]bot-user-a' },
        { staffId: 'colleague-user' }
      ],
      robotCode: 'ding-app-a',
      msgtype: 'text',
      text: { content: '请和同事一起检查' }
    }, binding)

    expect(message).toMatchObject({
      chatbotUserId: '$:LWCP_v1:bot-user-a',
      explicitlyAtBot: true
    })
    expect(hasCanonicalSingleDingTalkBotTarget(message)).toBe(true)
  })

  it('accepts the legacy senderStaff field and summarizes a private file', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-2',
      senderCorpId: 'ding-corp',
      senderStaff: 'owner-user',
      senderNick: 'Murray',
      conversationType: '1',
      conversationId: 'cid-private',
      robotCode: 'ding-app-a',
      msgtype: 'file',
      content: { fileName: 'report.pdf', contentType: 'application/pdf' }
    }, binding)

    expect(message.conversationKind).toBe('p2p')
    expect(message.body).toBe('[附件：report.pdf]')
    expect(message.attachmentSummaries).toEqual([{
      name: 'report.pdf',
      mediaType: 'application/pdf'
    }])
    expect(message.explicitlyAtBot).toBe(true)
  })

  it('does not mistake private callback routing metadata for a group topic', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-private-thread-metadata',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      senderNick: 'Murray',
      conversationType: '1',
      conversationId: 'cid-private',
      openConvThreadId: 'private-routing-id',
      robotCode: 'ding-app-a',
      msgtype: 'text',
      text: { content: 'hello' }
    }, binding)

    expect(message).toMatchObject({
      conversationKind: 'p2p',
      chatId: 'cid-private',
      body: 'hello'
    })
  })

  it('does not substitute the Bot tenant for a missing sender tenant', () => {
    expect(() => normalizeDingTalkRobotMessage({
      msgId: 'msg-external',
      chatbotCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '1',
      conversationId: 'cid-private',
      robotCode: 'ding-app-a',
      text: { content: 'hello' }
    }, binding)).toThrow('dingtalk_inbound_senderCorpId_missing')
  })

  it('does not mistake ordinary group routing metadata for a topic', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-group-routing-metadata',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '2',
      conversationId: 'cid-group',
      openConvThreadId: 'group-routing-id',
      openThreadId: 'group-open-routing-id',
      isInAtList: true,
      robotCode: 'ding-app-a',
      text: { content: 'hello group' }
    }, binding)

    expect(message).toMatchObject({
      conversationKind: 'group',
      chatId: 'cid-group',
      body: 'hello group',
      explicitlyAtBot: true
    })
  })

  it('fails closed for explicit topic identity and mismatched robot identity', () => {
    expect(() => normalizeDingTalkRobotMessage({
      msgId: 'msg-topic',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '2',
      conversationId: 'cid-group',
      topicId: 'topic-1',
      robotCode: 'ding-app-a',
      text: { content: 'thread' }
    }, binding)).toThrow('dingtalk_topic_not_supported')

    expect(() => normalizeDingTalkRobotMessage({
      msgId: 'msg-spoof',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '1',
      conversationId: 'cid-private',
      robotCode: 'ding-other-app',
      text: { content: 'hello' }
    }, binding)).toThrow('dingtalk_inbound_robot_identity_mismatch')
  })

  it('fails closed on malformed or unbounded canonical atUsers', () => {
    const base = {
      msgId: 'msg-at-users',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '2',
      conversationId: 'cid-group',
      isInAtList: true,
      robotCode: 'ding-app-a',
      text: { content: 'hello' }
    }
    expect(() => normalizeDingTalkRobotMessage({ ...base, atUsers: [{}] }, binding))
      .toThrow('dingtalk_inbound_atUsers_invalid')
    expect(() => normalizeDingTalkRobotMessage({
      ...base,
      atUsers: Array.from({ length: 65 }, () => ({ dingtalkId: 'ding-app-a' }))
    }, binding)).toThrow('dingtalk_inbound_atUsers_invalid')
  })

  it('uses deterministic quote text when DingTalk returns encrypted reply content', () => {
    const message = normalizeDingTalkRobotMessage({
      msgId: 'msg-encrypted-quote',
      senderCorpId: 'ding-corp',
      senderStaffId: 'owner-user',
      conversationType: '1',
      conversationId: 'cid-private',
      robotCode: 'ding-app-a',
      text: { content: '继续' },
      repliedMsg: {
        msgType: 'text',
        content: {
          text: `${'VGhpcy1pcy1lbmNyeXB0ZWQtY29udGVudA=='.repeat(5)}||3||1||132`
        }
      }
    }, binding)

    expect(message.quote?.body).toBe('[引用的钉钉消息不可读取]')
  })
})
