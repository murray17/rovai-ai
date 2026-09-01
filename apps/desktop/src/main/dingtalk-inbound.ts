export type DingTalkInboundMessage = {
  provider: 'dingtalk'
  appId: string
  robotCode: string
  externalMessageId: string
  tenantKey: string
  chatId: string
  conversationKind: 'p2p' | 'group'
  conversationDisplayName: string
  senderExternalUserId: string
  senderUserId: string
  senderDisplayName: string
  body: string
  attachmentSummaries: Array<{ name: string; mediaType: string | null }>
  explicitlyAtBot: boolean
  chatbotUserId: string | null
  atUsers: Array<{ staffId: string | null; dingtalkId: string | null }>
  quote: {
    senderDisplayName: string
    body: string
    attachmentSummaries: Array<{ name: string; mediaType: string | null }>
  } | null
}

export function normalizeDingTalkRobotMessage(
  raw: unknown,
  binding: { appKey: string; robotCode: string }
): DingTalkInboundMessage {
  const value = object(raw)
  // Robot Stream callbacks expose the Owner identity as senderStaffId /
  // senderCorpId. Older payloads used senderStaff for the user, but the Bot's
  // chatbotCorpId is never a substitute for the sender tenant in an external
  // group. Never fall back to encrypted senderId either: it cannot be matched
  // to the OAuth profile's stable userId.
  const senderStaffId = first(value, 'senderStaffId', 'senderStaff')
  if (!senderStaffId) throw new Error('dingtalk_inbound_senderStaffId_missing')
  const corpId = first(value, 'senderCorpId')
  if (!corpId) throw new Error('dingtalk_inbound_senderCorpId_missing')
  const messageId = first(value, 'msgId', 'messageId')
  if (!messageId) throw new Error('dingtalk_inbound_message_id_missing')
  const conversationType = String(value.conversationType ?? value.conversationKind ?? '')
  const group = conversationType === '2'
    || conversationType.toLowerCase() === 'group'
    || typeof value.openConversationId === 'string'
  if (group && ['openConvThreadId', 'openThreadId', 'threadId', 'topicId', 'topicKey']
    .some((key) => first(value, key) !== null)) {
    throw new Error('dingtalk_topic_not_supported')
  }
  const chatId = group
    ? first(value, 'openConversationId', 'conversationId')
    : first(value, 'conversationId') ?? `${binding.appKey}:${senderStaffId}`
  if (!chatId) throw new Error('dingtalk_inbound_conversation_missing')
  const callbackRobotCode = first(value, 'robotCode')
  if (callbackRobotCode
    && callbackRobotCode !== binding.robotCode
    && callbackRobotCode !== binding.appKey) {
    throw new Error('dingtalk_inbound_robot_identity_mismatch')
  }
  const body = messageText(value) ?? summarizeMessage(value)
  const chatbotUserId = first(value, 'chatbotUserId')
  if (chatbotUserId && chatbotUserId.length > 512) {
    throw new Error('dingtalk_inbound_chatbotUserId_invalid')
  }
  const atUsers = normalizeAtUsers(value.atUsers)
  return {
    provider: 'dingtalk',
    appId: binding.appKey,
    robotCode: callbackRobotCode ?? binding.robotCode,
    externalMessageId: messageId,
    tenantKey: corpId,
    chatId,
    conversationKind: group ? 'group' : 'p2p',
    conversationDisplayName: first(value, 'conversationTitle')
      ?? (group ? '钉钉群聊' : first(value, 'senderNick') ?? '钉钉私聊'),
    senderExternalUserId: senderStaffId,
    senderUserId: senderStaffId,
    senderDisplayName: first(value, 'senderNick') ?? '钉钉用户',
    body: body.trim(),
    attachmentSummaries: messageAttachmentSummaries(value),
    explicitlyAtBot: !group || value.isInAtList === true || value.isInAtList === 'true',
    chatbotUserId,
    atUsers,
    quote: normalizeQuote(value)
  }
}

function normalizeAtUsers(
  value: unknown
): Array<{ staffId: string | null; dingtalkId: string | null }> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error('dingtalk_inbound_atUsers_invalid')
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('dingtalk_inbound_atUsers_invalid')
    }
    const item = candidate as Record<string, unknown>
    const staffId = first(item, 'staffId')
    const dingtalkId = first(item, 'dingtalkId')
    if ((!staffId && !dingtalkId) || [staffId, dingtalkId].some((id) => id && id.length > 512)) {
      throw new Error('dingtalk_inbound_atUsers_invalid')
    }
    return { staffId, dingtalkId }
  })
}

function normalizeQuote(value: Record<string, unknown>): DingTalkInboundMessage['quote'] {
  const raw = value.repliedMsg ?? value.originalMsg ?? value.quote ?? value.replyMessage
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const quote = raw as Record<string, unknown>
  const rawBody = messageText(quote) ?? summarizeMessage(quote)
  const attachmentSummaries = messageAttachmentSummaries(quote)
  const body = quoteBodyReadable(rawBody)
    ? rawBody
    : '[引用的钉钉消息不可读取]'
  return {
    senderDisplayName: first(quote, 'senderNick', 'senderName') ?? '引用消息',
    body: body.slice(0, 8_000),
    attachmentSummaries
  }
}

function quoteBodyReadable(value: string): boolean {
  const body = value.trim()
  if (!body) return false
  if (/\|\|\d+\|\|\d+\|\|\d+$/u.test(body)) return false
  const compact = body.replace(/\s+/gu, '')
  if (compact.length >= 160 && /^[A-Za-z0-9+/=]+$/u.test(compact)) return false
  return true
}

function messageText(value: Record<string, unknown>): string | null {
  const text = objectOrEmpty(value.text)
  const content = objectOrEmpty(value.content)
  return first(text, 'content', 'text')
    ?? first(content, 'text', 'content')
    ?? first(value, 'content')
}

function summarizeMessage(value: Record<string, unknown>): string {
  const msgType = first(value, 'msgtype', 'msgType', 'messageType')?.toLowerCase()
  if (!msgType || msgType === 'text') return ''
  const summaries = messageAttachmentSummaries(value)
  if (summaries.length > 0) return summaries.map((item) => `[附件：${item.name}]`).join('\n')
  return `[钉钉消息：${msgType}]`
}

function messageAttachmentSummaries(
  value: Record<string, unknown>
): Array<{ name: string; mediaType: string | null }> {
  const content = objectOrEmpty(value.content)
  const msgType = first(value, 'msgtype', 'msgType', 'messageType')?.toLowerCase() ?? ''
  const name = first(value, 'fileName', 'filename', 'name')
    ?? first(content, 'fileName', 'filename', 'name')
  if (!name && !['file', 'image', 'audio', 'video', 'picture', 'photo'].includes(msgType)) return []
  const fallback = msgType === 'image' || msgType === 'picture' || msgType === 'photo'
    ? '图片'
    : msgType === 'audio' ? '音频'
      : msgType === 'video' ? '视频' : '附件'
  const mediaType = first(value, 'contentType', 'mediaType')
    ?? first(content, 'contentType', 'mediaType')
  return [{ name: name ?? fallback, mediaType }]
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dingtalk_inbound_payload_invalid')
  }
  return value as Record<string, unknown>
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function required(value: Record<string, unknown>, key: string): string {
  const result = first(value, key)
  if (!result) throw new Error(`dingtalk_inbound_${key}_missing`)
  return result
}

function first(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}
