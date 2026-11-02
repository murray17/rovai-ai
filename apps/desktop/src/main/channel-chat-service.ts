import { createHash, randomUUID } from 'node:crypto'
import { ContactSearchError, type ChatContact, type ContactSearchErrorCode } from './feishu-contact-search'
import type { ChatBotView, CoreMethod } from '@contracts'

export type ChatCore = { request<T>(method: CoreMethod, params?: unknown): Promise<T> }

export type ChatSendOutcome = 'sent' | 'failed' | 'unknown'

export type ChatSendReceipt = { status: ChatSendOutcome; messageId: string | null }

export type ChatRuntime = {
  provider: 'feishu' | 'lark'
  appId: string
  core: ChatCore
  /** Sends to a chat id (group/p2p) or an open id for direct messages. */
  sendText: (target: string, text: string, targetKind: 'chat' | 'open_id', outboundId: string) => Promise<ChatSendReceipt>
  searchContacts?: (query: string, signal: AbortSignal) => Promise<ChatContact[]>
  isReady?: () => boolean | Promise<boolean>
  log?: (event: string, detail?: Record<string, unknown>) => void
}

export type ChatInboundInput = {
  chatId: string
  chatName: string | null
  conversationKind: 'p2p' | 'group' | 'topic'
  authorExternalId: string
  authorName: string
  isOwner: boolean
  body: string
  externalMessageId: string
  quoteMessageId: string | null
  mentions: Array<{ openId: string | null; name: string }>
}

export type ChatFlushResult = {
  id: string
  status: ChatSendOutcome
  messageId: string | null
  chatId: string
  source: string
  text: string
}

type TurnResult = { status: string; text: string | null; reason: string | null }

type PendingTurn = {
  chatId: string
  submittedAt: number
  waitingSince: number | null
}

type ClaimedOutbound = {
  id: string
  chatId: string
  text: string
  source: string
  attempts: number
  targetKind: 'chat_id' | 'open_id'
  leaseToken: string
}

const MAX_REPLY_BYTES = 8 * 1024
// A single 20s SDK mutation must finish inside the 30s Core lease.
const OUTBOUND_BATCH = 1
const TURN_TIMEOUT_MS = 30 * 60_000
const WAITING_NOTICE_MS = 10 * 60_000

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 40)
}

function truncateBytes(text: string, max: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.byteLength <= max) return text
  return buffer.subarray(0, max).toString('utf8').replace(/\uFFFD$/, '') + '…'
}

/**
 * Chat turns are ordinary Thread executions owned by Core. This service only
 * carries Feishu transport: it records the inbound message, asks Core to admit
 * one turn in the member's materials folder, waits for the Run to settle, and
 * delivers the assistant text through the existing outbound queue.
 */
export class ChannelChatService {
  readonly #runtime: ChatRuntime
  readonly #workerId: string
  readonly #pending = new Map<string, PendingTurn>()
  readonly #abort = new AbortController()
  #flushing = false
  #stopped = false

  constructor(runtime: ChatRuntime) {
    this.#runtime = runtime
    this.#workerId = 'chat-' + randomUUID()
  }

  stop(): void {
    this.#stopped = true
    this.#abort.abort()
    this.#pending.clear()
  }

  async handleInbound(input: ChatInboundInput): Promise<void> {
    if (this.#stopped) return
    const recorded = await this.#runtime.core.request<{
      mode: string
      duplicate: boolean
      owner: boolean
    }>('channels.chat.inbound', {
      commandId: 'chat-inbound-' + digest(this.#runtime.appId + '\0' + input.externalMessageId),
      command: {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        externalMessageId: input.externalMessageId,
        chatId: input.chatId,
        conversationKind: input.conversationKind,
        chatName: input.chatName,
        authorExternalId: input.authorExternalId,
        authorName: input.authorName,
        authorIsOwner: input.isOwner,
        body: input.body,
        quoteMessageId: input.quoteMessageId,
        mentions: input.mentions.filter((mention) => typeof mention.openId === 'string'
          && mention.openId.startsWith('ou_') && mention.openId.length <= 128)
          .slice(0, 20).map((mention) => ({ openId: mention.openId, name: mention.name.slice(0, 200) }))
      }
    })
    if (this.#stopped || recorded.mode !== 'chat') return
    const config = await this.snapshot()
    if (this.#stopped || config.ownerOnly) return
    const turn = await this.#runtime.core.request<{ campMessageId: string }>(
      'channels.chat.submit',
      {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        chatId: input.chatId,
        conversationKind: input.conversationKind,
        chatName: input.chatName,
        authorName: input.authorName,
        body: input.body,
        externalMessageId: input.externalMessageId
      }
    )
    if (this.#stopped || this.#pending.has(turn.campMessageId)) return
    this.#pending.set(turn.campMessageId, {
      chatId: input.chatId,
      submittedAt: Date.now(),
      waitingSince: null
    })
  }

  async snapshot(): Promise<ChatBotView> {
    return this.#runtime.core.request<ChatBotView>('channels.chat.snapshot', {
      provider: this.#runtime.provider,
      appId: this.#runtime.appId
    })
  }

  /** Polls admitted turns, then drains the outbound queue. */
  async flush(): Promise<ChatFlushResult[]> {
    if (this.#stopped || this.#flushing) return []
    this.#flushing = true
    try {
      if (!await this.#ready()) return []
      const [, results] = await Promise.allSettled([
        this.#searchContacts().catch(() => this.#log('contacts.worker_failed', { code: 'unavailable' })),
        (async () => {
          await this.#hydratePending()
          if (!await this.#ready()) return []
          await this.#pollTurns()
          return this.#flushOutbound()
        })()
      ])
      if (results.status === 'rejected') throw results.reason
      return results.value
    } finally {
      this.#flushing = false
    }
  }

  async #ready(): Promise<boolean> {
    return !this.#stopped && (await this.#runtime.isReady?.() ?? true) && !this.#stopped
  }

  async #searchContacts(): Promise<void> {
    if (!this.#runtime.searchContacts) return
    const claimed = await this.#runtime.core.request<Array<{ requestId: string; leaseToken: string; query: string }>>(
      'channels.chat.tools.claim', {
        provider: this.#runtime.provider, appId: this.#runtime.appId,
        workerId: this.#workerId, limit: 1
      }
    )
    for (const request of claimed) {
      if (!await this.#ready()) return
      let contacts: ChatContact[] = []
      let errorCode: ContactSearchErrorCode | null = null
      const deadline = new AbortController()
      const timer = setTimeout(() => deadline.abort(), 15_000)
      const signal = AbortSignal.any([this.#abort.signal, deadline.signal])
      let abort: (() => void) | undefined
      try {
        const found = await Promise.race([
          this.#runtime.searchContacts(request.query, signal),
          new Promise<never>((_, reject) => {
            abort = () => reject(new ContactSearchError('unavailable'))
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
        ])
        if (!Array.isArray(found)) throw new ContactSearchError('invalid_response')
        contacts = found.slice(0, 20).map((item) => {
          if (typeof item?.openId !== 'string' || !item.openId.startsWith('ou_') || item.openId.length > 128
            || typeof item.name !== 'string' || !item.name.trim()) throw new ContactSearchError('invalid_response')
          return { openId: item.openId, name: item.name.slice(0, 200),
            ...(typeof item.department === 'string' ? { department: item.department.slice(0, 300) } : {}) }
        })
      } catch (error) {
        contacts = []
        errorCode = error instanceof ContactSearchError ? error.code : 'unavailable'
      } finally {
        clearTimeout(timer)
        if (abort) signal.removeEventListener('abort', abort)
      }
      if (!await this.#ready()) return
      await this.#runtime.core.request('channels.chat.tools.settle', {
        provider: this.#runtime.provider, appId: this.#runtime.appId,
        workerId: this.#workerId, requestId: request.requestId,
        leaseToken: request.leaseToken, contacts, errorCode
      })
    }
  }

  async #hydratePending(): Promise<void> {
    const pending = await this.#runtime.core.request<Array<{ campMessageId: string; chatId: string; submittedAt: number }>>(
      'channels.chat.pending', { provider: this.#runtime.provider, appId: this.#runtime.appId, limit: 50 }
    )
    if (this.#stopped) return
    for (const turn of pending) {
      if (!this.#pending.has(turn.campMessageId)) {
        this.#pending.set(turn.campMessageId, { chatId: turn.chatId, submittedAt: turn.submittedAt, waitingSince: null })
      }
    }
  }

  async #pollTurns(): Promise<void> {
    for (const [campMessageId, turn] of [...this.#pending]) {
      if (!await this.#ready()) return
      let result: TurnResult
      try {
        result = await this.#runtime.core.request<TurnResult>('channels.chat.result', {
          provider: this.#runtime.provider,
          appId: this.#runtime.appId,
          campMessageId
        })
      } catch (error) {
        this.#log('turn.result_failed', { code: 'unavailable' })
        continue
      }
      const now = Date.now()
      if (result.status === 'completed') {
        const text = result.text?.trim()
        if (text) {
          await this.#enqueue(campMessageId, turn.chatId, truncateBytes(text, MAX_REPLY_BYTES), 'reply')
        } else {
          this.#log('turn.empty_result')
          await this.#enqueue(campMessageId, turn.chatId, '这条消息没有生成可发送的回复。', 'notice')
        }
        continue
      }
      if (result.status === 'waiting') {
        if (turn.waitingSince === null) {
          turn.waitingSince = now
          continue
        }
        if (now - turn.waitingSince < WAITING_NOTICE_MS) continue
        await this.#enqueue(
          campMessageId,
          turn.chatId,
          '这条消息需要在应用里确认后才能继续。',
          'notice',
          false
        )
        continue
      }
      if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'unknown') {
        this.#log('turn.failed', { status: result.status })
        await this.#enqueue(campMessageId, turn.chatId, '暂时无法回复，请稍后再试。', 'notice')
        continue
      }
      if (now - turn.submittedAt > TURN_TIMEOUT_MS) {
        this.#log('turn.timeout', { status: result.status })
        await this.#enqueue(campMessageId, turn.chatId, '这条消息处理时间过长，请稍后再试。', 'notice', false)
      }
    }
  }

  async #flushOutbound(): Promise<ChatFlushResult[]> {
    if (!await this.#ready()) return []
    const claimed = await this.#runtime.core.request<ClaimedOutbound[]>(
      'channels.chat.outbound.claim',
      {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        workerId: this.#workerId,
        limit: OUTBOUND_BATCH
      }
    )
    const results: ChatFlushResult[] = []
    for (const outbound of claimed) {
      if (!await this.#ready()) break
      let receipt: ChatSendReceipt = { status: 'unknown', messageId: null }
      let failureCode: string | null = null
      try {
        receipt = await this.#runtime.sendText(
          outbound.chatId,
          outbound.text,
          outbound.targetKind === 'open_id' ? 'open_id' : 'chat',
          outbound.id
        )
      } catch (error) {
        receipt = { status: 'unknown', messageId: null }
        failureCode = 'unavailable'
      }
      const settled = await this.#runtime.core.request<{ settled: boolean }>('channels.chat.outbound.settle', {
        commandId: 'chat-settle-' + outbound.id + '-' + outbound.leaseToken,
        command: {
          outboundId: outbound.id,
          workerId: this.#workerId,
          leaseToken: outbound.leaseToken,
          status: receipt.status,
          externalMessageId: receipt.messageId,
          failureCode
        }
      })
      if (!settled.settled) continue
      if (outbound.source === 'reply' && receipt.status === 'sent') {
        await this.#rememberAssistant(outbound.chatId, outbound.text).catch(() => undefined)
      }
      results.push({
        id: outbound.id,
        status: receipt.status,
        messageId: receipt.messageId,
        chatId: outbound.chatId,
        source: outbound.source,
        text: outbound.text
      })
    }
    return results
  }

  async #enqueue(campMessageId: string, chatId: string, text: string, source: string, completeTurn = true): Promise<void> {
    if (!await this.#ready()) return
    const key = digest([this.#runtime.provider, this.#runtime.appId, campMessageId, source, text].join('\0'))
    try {
      await this.#runtime.core.request('channels.chat.outbound.enqueue', {
        commandId: 'chat-outbound-' + key,
        command: {
          provider: this.#runtime.provider,
          appId: this.#runtime.appId,
          chatId,
          text,
          source,
          idempotencyKey: key,
          usesMaterials: false,
          campMessageId,
          completeTurn
        }
      })
      if (completeTurn) this.#pending.delete(campMessageId)
    } catch (error) {
      this.#log('outbound.enqueue_failed', { code: 'unavailable' })
    }
  }

  async #rememberAssistant(chatId: string, text: string): Promise<void> {
    await this.#runtime.core.request('channels.chat.turn.append', {
      commandId: 'chat-turn-' + digest(chatId + '|' + text),
      command: {
        provider: this.#runtime.provider,
        appId: this.#runtime.appId,
        chatId,
        role: 'assistant',
        body: text,
        materialsOnly: false
      }
    })
  }

  #log(event: string, detail?: Record<string, unknown>): void {
    this.#runtime.log?.(event, detail)
  }
}
