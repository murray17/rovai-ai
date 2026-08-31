import { createHash } from 'node:crypto'
import { LarkChannelError, type LarkChannel } from '@larksuiteoapi/node-sdk'

type MemberRecipient = { agentId: string; displayName: string; openId: string | null }
type OutputReply = { status: 'unavailable' } | {
  status: 'available'
  messageId: string
  authorDisplayName: string
  body: string
}
type OutputProjection = {
  presentationVersion: 1
  body: string
  mentionPrincipal: boolean
  memberRecipients: MemberRecipient[]
  reply: OutputReply | null
}
type OutputCard = {
  schema: '2.0'
  config: { update_multi: true }
  body: { elements: Array<{ tag: 'markdown'; content: string; text_size?: 'notation' }> }
}
type MessageClient = Pick<LarkChannel['rawClient']['im']['v1']['message'], 'create' | 'reply'>

const CARD_BYTE_BUDGET = 24_000
const FENCE_RESERVE = 1024
const validOpenId = (value: unknown): value is string =>
  typeof value === 'string' && /^ou_[A-Za-z0-9_-]{1,120}$/.test(value)

function outputProjection(payload: Record<string, unknown>): OutputProjection {
  const recipients = payload.memberRecipients
  const reply = payload.reply
  const validReply = reply == null || (typeof reply === 'object' && 'status' in reply
    && (reply.status === 'unavailable' || (reply.status === 'available'
      && 'messageId' in reply && typeof reply.messageId === 'string' && reply.messageId.length > 0
      && 'authorDisplayName' in reply && typeof reply.authorDisplayName === 'string'
      && Array.from(reply.authorDisplayName).length <= 120
      && 'body' in reply && typeof reply.body === 'string' && Array.from(reply.body).length <= 240
      && reply.body.split('\n').length <= 3)))
  if (payload.presentationVersion !== 1 || typeof payload.body !== 'string'
    || typeof payload.mentionPrincipal !== 'boolean' || !Array.isArray(recipients)
    || !validReply
    || recipients.length > 16 || !recipients.every((recipient) =>
      recipient && typeof recipient === 'object'
      && typeof recipient.agentId === 'string' && recipient.agentId.length > 0
      && typeof recipient.displayName === 'string' && recipient.displayName.length <= 256
      && (recipient.openId === null || typeof recipient.openId === 'string'))) {
    throw new Error('channel_output_projection_invalid')
  }
  // Earlier frozen v1 deliveries without a reply retain their original content.
  return { ...payload, reply: reply ?? null } as unknown as OutputProjection
}

function literalName(name: string): string {
  return name.replace(/[&<>\\`*_\[\]{}()!|#\r\n]/g,
    (character) => `&#${character.codePointAt(0)};`)
}

function recipientFooter(projection: OutputProjection, ownerOpenId?: string | null): string {
  const seen = new Set<string>()
  const recipients: string[] = []
  for (const recipient of projection.memberRecipients) {
    if (seen.has(recipient.agentId)) continue
    seen.add(recipient.agentId)
    recipients.push(validOpenId(recipient.openId)
      ? `<at id="${recipient.openId}"></at>`
      : `@${literalName(recipient.displayName || recipient.agentId)}`)
  }
  if (projection.mentionPrincipal) {
    recipients.push(validOpenId(ownerOpenId) ? `<at id="${ownerOpenId}"></at>` : '@Owner')
  }
  return recipients.length ? `发送给 ${recipients.join(' ')}` : ''
}

function replyQuote(reply: OutputReply | null): string {
  if (!reply) return ''
  if (reply.status === 'unavailable') return '> 回复的消息已不可用'
  // Static quote only: no native mention, nested Markdown, link or callback.
  const literal = (value: string): string => literalName(value).replace(/[~+.=\-]/g,
    (character) => `&#${character.codePointAt(0)};`)
  const author = literal(reply.authorDisplayName || '消息作者')
  const excerpt = (reply.body || '（无文本）').split('\n').map(literal).join('\n> ')
  return `> 回复 ${author}\n> ${excerpt}`
}

function card(body: string, footer: string, quote = ''): OutputCard {
  return {
    schema: '2.0',
    config: { update_multi: true },
    body: { elements: [
      ...(quote ? [{ tag: 'markdown' as const, content: quote, text_size: 'notation' as const }] : []),
      ...(body ? [{ tag: 'markdown' as const, content: body }] : []),
      ...(footer ? [{ tag: 'markdown' as const, content: footer, text_size: 'notation' as const }] : [])
    ] }
  }
}

const jsonTextBytes = (value: string): number => Buffer.byteLength(JSON.stringify(value)) - 2

// Keep the complete public body, including a single oversized line. Reopen code
// fences at card boundaries; every card still replies to the original Topic.
function splitMarkdown(body: string, budget: number): string[] {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  let fence: { opening: string; closing: string } | null = null
  const flush = (): void => {
    chunks.push(current + (fence ? `\n${fence.closing}` : ''))
    current = fence ? `${fence.opening}\n` : ''
    currentBytes = jsonTextBytes(current)
  }
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^ {0,3}(`{3,32}|~{3,32})([^`~\r\n]{0,80})\r?\n?$/.exec(line)
    if (marker) {
      if (currentBytes + jsonTextBytes(line) > budget) flush()
      current += line
      currentBytes += jsonTextBytes(line)
      if (!fence) {
        fence = { opening: line.replace(/\r?\n$/, ''), closing: marker[1] }
      } else if (marker[1][0] === fence.closing[0]
        && marker[1].length >= fence.closing.length && !marker[2].trim()) {
        fence = null
      }
      continue
    }
    if (currentBytes + jsonTextBytes(line) <= budget) {
      current += line
      currentBytes += jsonTextBytes(line)
      continue
    }
    // Prefer a line boundary, but do not drop or slice UTF-16 surrogate pairs.
    if (current && jsonTextBytes(line) <= budget) flush()
    for (const character of line) {
      const size = jsonTextBytes(character)
      if (currentBytes + size > budget) flush()
      current += character
      currentBytes += size
    }
  }
  if (current) chunks.push(current + (fence ? `\n${fence.closing}` : ''))
  return chunks
}

export function feishuAgentOutputCards(
  payload: Record<string, unknown>, ownerOpenId?: string | null
): OutputCard[] {
  const projection = outputProjection(payload)
  const footer = recipientFooter(projection, ownerOpenId)
  const quote = replyQuote(projection.reply)
  // Only the Core-derived footer can create native mentions. Literal markup in
  // public prose (including code examples) must not acquire notification powers.
  const body = projection.body.trim().replace(/<\/?at\b[^>]*>/gi,
    (tag) => tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  if (!body && !footer) throw new Error('channel_output_empty')
  const whole = card(body, footer, quote)
  if (Buffer.byteLength(JSON.stringify(whole)) <= CARD_BYTE_BUDGET) return [whole]
  const budget = CARD_BYTE_BUDGET - Buffer.byteLength(JSON.stringify(card('', footer, quote))) - FENCE_RESERVE
  if (budget < FENCE_RESERVE) throw new Error('channel_output_recipients_too_large')
  const chunks = splitMarkdown(body, budget)
  return chunks.map((chunk, index) => card(
    chunk, index === chunks.length - 1 ? footer : '', index === 0 ? quote : ''
  ))
}

export async function sendFeishuAgentOutput(
  client: MessageClient,
  input: { deliveryId: string; chatId: string; topicKey: string; payload: Record<string, unknown>; ownerOpenId?: string | null }
): Promise<string> {
  const cards = feishuAgentOutputCards(input.payload, input.ownerOpenId)
  let firstMessageId = ''
  for (const [index, outputCard] of cards.entries()) {
    // Provider deduplication also covers a lost response or a partial multi-card
    // send retried by the existing bounded Core Outbox. No new local view state.
    const uuid = createHash('sha256').update(`feishu-output-v1\0${input.deliveryId}\0${index}`)
      .digest('hex').slice(0, 50)
    const data = { msg_type: 'interactive', content: JSON.stringify(outputCard), uuid }
    let response
    try {
      response = input.topicKey
        ? await client.reply({ path: { message_id: input.topicKey }, data: { ...data, reply_in_thread: true } })
        : await client.create({ params: { receive_id_type: 'chat_id' }, data: { ...data, receive_id: input.chatId } })
    } catch {
      throw new LarkChannelError('unknown', 'feishu_output_send_failed')
    }
    if (response?.code !== 0 || !response.data?.message_id) {
      const code = response?.code
      const kind = code === 230020 || code === 230017 ? 'target_revoked'
        : code === 230025 ? 'format_error' : 'unknown'
      throw new LarkChannelError(kind, 'feishu_output_send_failed')
    }
    firstMessageId ||= response.data.message_id
  }
  return firstMessageId
}
