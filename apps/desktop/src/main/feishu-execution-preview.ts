import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CardActionEvent, LarkChannel } from '@larksuiteoapi/node-sdk'
import { executionConsoleCard, executionConsolePageCount } from '../shared/execution-presentation/feishu-card'
import { feishuExecutionPreviewFixture } from './feishu-execution-preview-fixture'
import { feishuPageCardResponse, feishuPageFailure, withFeishuPageDeadline, type FeishuCardActionResponse } from './feishu-card-action'

const ARGUMENT = '--feishu-execution-preview='
const RUN_PREFIX = 'feishu-preview:'
const SESSION_LIFETIME_MS = 6 * 60 * 60_000

export type FeishuPreviewRequest = {
  requestId: string
  agentId: string
  commandCounts: number[]
}

export type FeishuPreviewOwner = {
  accountId: string
  displayName: string
  openId: string
  openIdDigest: string
}

type PreviewChannel = Pick<LarkChannel, 'rawClient'>
type PreviewResponse = FeishuCardActionResponse
type PreviewRecord = {
  appId: string
  owner: FeishuPreviewOwner
  messageId: string
  pages: Record<string, unknown>[]
  sequence: number
  expiresAt: number
}

export interface FeishuExecutionPreviewHost {
  connected(agentId: string, appId: string, channel: PreviewChannel): Promise<void>
  handleCardAction(appId: string, event: CardActionEvent): Promise<PreviewResponse | null>
}

export function parseFeishuPreviewRequest(argv: readonly string[]): FeishuPreviewRequest | null {
  const values = argv.filter(value => value.startsWith(ARGUMENT))
  if (values.length === 0) return null
  if (values.length !== 1) throw new Error('feishu_preview_request_invalid')
  const parts = values[0].slice(ARGUMENT.length).split('/')
  const [requestId, agentId, counts] = parts
  if (parts.length !== 3 || !/^[a-f0-9-]{36}$/u.test(requestId)
    || !/^[A-Za-z0-9_-]{1,128}$/u.test(agentId) || !/^\d{1,3}(,\d{1,3})?$/u.test(counts)) {
    throw new Error('feishu_preview_request_invalid')
  }
  const commandCounts = counts.split(',').map(Number)
  if (commandCounts.some(count => count < 1 || count > 200)
    || new Set(commandCounts).size !== commandCounts.length) throw new Error('feishu_preview_request_invalid')
  return { requestId, agentId, commandCounts }
}

/** Manual local preview only; ordinary launches neither read identities nor send a card. */
export function createFeishuExecutionPreviewHost(
  argv: readonly string[],
  coreDataPath: string | null
): FeishuExecutionPreviewHost | undefined {
  try {
    const request = parseFeishuPreviewRequest(argv)
    if (!request || !coreDataPath) return undefined
    return new FeishuExecutionPreviewService(request, {
      readOwner: (agentId, appId) => readFeishuPreviewOwner(join(coreDataPath, 'rovai.sqlite'), agentId, appId),
      report: fields => console.info('[feishu.execution_preview]', JSON.stringify(fields))
    })
  } catch {
    // A mistyped diagnostic flag must not prevent ordinary channels or the App starting.
    console.warn('[feishu.execution_preview] invalid_request')
    return undefined
  }
}

export function readFeishuPreviewOwner(databasePath: string, agentId: string, appId: string): FeishuPreviewOwner {
  // Never reads credentials, opens a second Core, or writes test facts into the daily store.
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('PRAGMA query_only = ON')
    const rows = db.prepare(`
      SELECT b.account_id, b.bot_display_name, p.external_id AS open_id, f.open_id_digest
      FROM feishu_member_bot b
      JOIN feishu_account a ON a.id = b.account_id
      JOIN feishu_owner_identity o ON o.account_id = b.account_id
      JOIN feishu_owner_app_identity f ON f.account_id = b.account_id AND f.app_id = b.app_id
      JOIN external_principal_app_identity p
        ON p.principal_id = o.canonical_owner_principal_id
        AND p.provider = 'feishu' AND p.app_id = b.app_id AND p.identity_kind = 'open_id'
      WHERE b.agent_id = ? AND b.app_id = ? AND b.status = 'published' AND a.brand = 'feishu'
      LIMIT 2
    `).all(agentId, appId)
    if (rows.length !== 1) throw new Error('feishu_preview_owner_unavailable')
    const row = rows[0]
    if (typeof row.account_id !== 'string' || typeof row.bot_display_name !== 'string'
      || typeof row.open_id !== 'string' || !/^ou_[A-Za-z0-9]+$/u.test(row.open_id)
      || row.open_id_digest !== openIdDigest(row.open_id)) throw new Error('feishu_preview_owner_unavailable')
    return { accountId: row.account_id, displayName: row.bot_display_name,
      openId: row.open_id, openIdDigest: row.open_id_digest }
  } finally { db.close() }
}

export class FeishuExecutionPreviewService implements FeishuExecutionPreviewHost {
  readonly #request: FeishuPreviewRequest
  readonly #readOwner: (agentId: string, appId: string) => FeishuPreviewOwner
  readonly #report: (fields: Record<string, string | number | boolean>) => void
  readonly #now: () => number
  readonly #records = new Map<string, PreviewRecord>()
  readonly #attemptedApps = new Set<string>()

  constructor(request: FeishuPreviewRequest, dependencies: {
    readOwner: (agentId: string, appId: string) => FeishuPreviewOwner
    report?: (fields: Record<string, string | number | boolean>) => void
    now?: () => number
  }) {
    this.#request = { ...request, commandCounts: [...request.commandCounts] }
    this.#readOwner = dependencies.readOwner
    this.#report = dependencies.report ?? (() => undefined)
    this.#now = dependencies.now ?? Date.now
  }

  async connected(agentId: string, appId: string, channel: PreviewChannel): Promise<void> {
    if (agentId !== this.#request.agentId || this.#attemptedApps.has(appId)) return
    this.#attemptedApps.add(appId)
    const owner = this.#readOwner(agentId, appId)
    for (const count of this.#request.commandCounts) {
      try {
        const runId = `${RUN_PREFIX}${this.#request.requestId}:${agentId}:${count}`
        const snapshot = feishuExecutionPreviewFixture(runId, owner.displayName, count)
        const pageCount = executionConsolePageCount(snapshot)
        const pages = Array.from({ length: pageCount }, (_, pageIndex) => executionConsoleCard(snapshot, { pageIndex, outerExpanded: true }))
        const initialCard = executionConsoleCard(snapshot)
        const sent = await channel.rawClient.im.v1.message.create({
          params: { receive_id_type: 'open_id' },
          data: { receive_id: owner.openId, msg_type: 'interactive', content: JSON.stringify(initialCard),
            uuid: createHash('sha256').update(`${appId}:${runId}`).digest('hex').slice(0, 32) }
        })
        const messageId = sent.data?.message_id
        if (sent.code !== 0 || !messageId?.startsWith('om_')) throw new Error('feishu_preview_send_failed')
        this.#records.set(runId, { appId, owner: { ...owner }, messageId, pages,
          sequence: snapshot.sequence, expiresAt: this.#now() + SESSION_LIFETIME_MS })
        const readback = await channel.rawClient.im.v1.message.get({ path: { message_id: messageId } })
        const item = readback.data?.items?.find(value => value.message_id === messageId)
        if (readback.code !== 0 || !item || item.deleted || item.msg_type !== 'interactive'
          || item.sender?.id !== appId) throw new Error('feishu_preview_readback_failed')
        this.#report({ stage: 'sent', commandCount: count, pageCount,
          messageIdDigest: identityDigest(messageId), readBackConfirmed: true })
      } catch {
        this.#report({ stage: 'send_failed', commandCount: count })
      }
    }
  }

  async handleCardAction(appId: string, event: CardActionEvent): Promise<PreviewResponse | null> {
    const value = event.action.value
    if (!isRecord(value) || value.action !== 'execution_console_page'
      || typeof value.agentRunId !== 'string' || !value.agentRunId.startsWith(RUN_PREFIX)) return null
    const record = this.#records.get(value.agentRunId)
    if (!record || record.appId !== appId || record.messageId !== event.messageId
      || this.#now() >= record.expiresAt || value.snapshotSequence !== record.sequence
      || typeof value.pageIndex !== 'number' || !Number.isSafeInteger(value.pageIndex)
      || value.pageIndex < 0 || value.pageIndex >= record.pages.length) return unavailable()
    const pageIndex = value.pageIndex
    try {
      return await withFeishuPageDeadline(async (checkDeadline) => {
        const raw = isRecord(event.raw) ? event.raw : {}
        const rawOperator = isRecord(raw.operator) ? raw.operator.open_id : undefined
        const operatorOpenId = event.operator.openId
        if (!operatorOpenId || (rawOperator !== undefined && rawOperator !== operatorOpenId)
          || openIdDigest(operatorOpenId) !== record.owner.openIdDigest
          || (raw.app_id !== undefined && raw.app_id !== appId)) return unavailable()
        // Current local publication/Owner binding must still agree with the frozen preview recipient.
        const owner = this.#readOwner(this.#request.agentId, appId)
        if (owner.accountId !== record.owner.accountId || owner.openIdDigest !== record.owner.openIdDigest
          || owner.openId !== operatorOpenId) return unavailable()
        // One response-card update, no competing PATCH or Core page/view state.
        checkDeadline()
        const response = feishuPageCardResponse(structuredClone(record.pages[pageIndex]))
        checkDeadline()
        this.#report({ stage: 'page_response_ready', pageIndex, pageCount: record.pages.length,
          messageIdDigest: identityDigest(record.messageId), responseCards: 1 })
        return response
      })
    } catch (error) {
      const { response, ...diagnostic } = feishuPageFailure(error)
      this.#report({ stage: 'page_failed', ...diagnostic })
      return response
    }
  }
}

function unavailable(): PreviewResponse {
  return { toast: { type: 'warning', content: '此预览不可用，请让 Owner 重新发起预览' } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function openIdDigest(value: string): string {
  return identityDigest(`feishu-open\0${value}`)
}

function identityDigest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
