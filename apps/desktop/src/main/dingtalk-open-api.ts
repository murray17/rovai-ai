import { randomUUID } from 'node:crypto'

const DEFAULT_API_ORIGIN = 'https://api.dingtalk.com'
const DEFAULT_OAPI_ORIGIN = 'https://oapi.dingtalk.com'
export const DINGTALK_AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema'
const DINGTALK_CARD_ACTION_PREFIX = 'rovai.v1.'
const MAX_DINGTALK_CARD_ACTION_BYTES = 4_096
export const MAX_DINGTALK_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024

export type DingTalkCardDeliveryIdentity = {
  outTrackId: string
  recallMessageId: string
}

export type DingTalkRobotAttachment =
  | { kind: 'image'; mediaId: string }
  | { kind: 'file'; mediaId: string; fileName: string }

const DINGTALK_ROBOT_FILE_TYPES = new Set(['xlsx', 'pdf', 'zip', 'rar', 'doc', 'docx'])

export function isSupportedDingTalkRobotFileName(fileName: string): boolean {
  const fileType = fileName.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase()
  return Boolean(fileType && DINGTALK_ROBOT_FILE_TYPES.has(fileType))
}

export function isSupportedDingTalkRobotImage(fileName: string, mediaType: string): boolean {
  const extension = fileName.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase()
  switch (mediaType.toLowerCase()) {
    case 'image/jpeg': return extension === 'jpg' || extension === 'jpeg'
    case 'image/png': return extension === 'png'
    case 'image/gif': return extension === 'gif'
    case 'image/bmp': return extension === 'bmp'
    default: return false
  }
}

function attachmentMessage(attachment: DingTalkRobotAttachment): {
  msgKey: 'sampleImageMsg' | 'sampleFile'
  msgParam: Record<string, string>
} {
  if (attachment.kind === 'image') {
    return { msgKey: 'sampleImageMsg', msgParam: { photoURL: attachment.mediaId } }
  }
  const fileType = attachment.fileName.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase()
  if (!fileType || !isSupportedDingTalkRobotFileName(attachment.fileName)) {
    throw new Error('dingtalk_attachment_type_unsupported')
  }
  return {
    msgKey: 'sampleFile',
    msgParam: { mediaId: attachment.mediaId, fileName: attachment.fileName, fileType }
  }
}

export class DingTalkOpenApiError extends Error {
  constructor(message: string, readonly status: number, readonly remoteCode: string | null = null) {
    super(message)
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
      || this.remoteCode === '90002' || this.remoteCode === '15' || this.remoteCode === '88'
  }
}

export class DingTalkOpenApiClient {
  readonly #appKey: string
  readonly #appSecret: string
  readonly #apiOrigin: string
  readonly #oapiOrigin: string
  #accessToken: { value: string; expiresAt: number } | null = null

  constructor(input: { appKey: string; appSecret: string; apiOrigin?: string; oapiOrigin?: string }) {
    this.#appKey = input.appKey
    this.#appSecret = input.appSecret
    this.#apiOrigin = input.apiOrigin ?? DEFAULT_API_ORIGIN
    this.#oapiOrigin = input.oapiOrigin ?? DEFAULT_OAPI_ORIGIN
  }

  async messageFileDownloadUrl(input: {
    robotCode: string
    downloadCode: string
    signal: AbortSignal
  }): Promise<string> {
    const response = await this.#request('/v1.0/robot/messageFiles/download', {
      method: 'POST',
      body: JSON.stringify({ robotCode: input.robotCode, downloadCode: input.downloadCode }),
      signal: input.signal
    })
    return requiredString(response, 'downloadUrl')
  }

  async uploadImage(bytes: Buffer, fileName: string, mediaType: string): Promise<string> {
    return this.#uploadMedia(bytes, fileName, mediaType, 'image')
  }

  async uploadFile(bytes: Buffer, fileName: string, mediaType: string): Promise<string> {
    return this.#uploadMedia(bytes, fileName, mediaType, 'file')
  }

  async #uploadMedia(
    bytes: Buffer, fileName: string, mediaType: string, kind: 'image' | 'file'
  ): Promise<string> {
    if (bytes.byteLength > MAX_DINGTALK_MEDIA_UPLOAD_BYTES) {
      throw new Error('dingtalk_attachment_size_unsupported')
    }
    const token = await this.#token()
    const data = new FormData()
    data.append('media', new Blob([Uint8Array.from(bytes)], { type: mediaType }), fileName)
    const url = new URL('/media/upload', this.#oapiOrigin)
    url.searchParams.set('access_token', token)
    url.searchParams.set('type', kind)
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST', body: data, signal: AbortSignal.timeout(30_000)
      })
    } catch {
      throw new DingTalkOpenApiError('dingtalk_media_upload_network', 0)
    }
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw new DingTalkOpenApiError(`dingtalk_media_upload_http_${response.status}`, response.status)
    }
    const value = body as Record<string, unknown>
    if (value.errcode !== 0) {
      const remoteCode = typeof value.errcode === 'number' || typeof value.errcode === 'string'
        ? String(value.errcode)
        : null
      const retryCode = remoteCode === '88' && value.sub_code ? null : remoteCode
      throw new DingTalkOpenApiError('dingtalk_media_upload_failed', response.status, retryCode)
    }
    const mediaId = requiredString(value, 'media_id')
    return mediaId.startsWith('@') ? mediaId : `@${mediaId}`
  }

  async groupRobotCodes(openConversationId: string): Promise<string[]> {
    const response = await this.#request('/v1.0/robot/groups/robots/query', {
      method: 'POST',
      body: JSON.stringify({ openConversationId })
    })
    const items = Array.isArray(response.chatbotInstanceVOList)
      ? response.chatbotInstanceVOList
      : Array.isArray(response.robotList)
        ? response.robotList
        : Array.isArray(response.result) ? response.result : []
    return [...new Set(items.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      const robotCode = optionalString(value, 'robotCode') ?? optionalString(value, 'appKey')
      return robotCode ? [robotCode] : []
    }))].sort()
  }

  async sendGroupMarkdown(input: {
    openConversationId: string
    robotCode: string
    title: string
    text: string
  }): Promise<string> {
    const response = await this.#request('/v1.0/robot/groupMessages/send', {
      method: 'POST',
      body: JSON.stringify({
        openConversationId: input.openConversationId,
        robotCode: input.robotCode,
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ title: input.title, text: input.text })
      })
    })
    return deliveryIdentity(response)
  }

  async sendPrivateMarkdown(input: {
    robotCode: string
    userId: string
    title: string
    text: string
  }): Promise<string> {
    const response = await this.#request('/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      body: JSON.stringify({
        robotCode: input.robotCode,
        userIds: [input.userId],
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ title: input.title, text: input.text })
      })
    })
    return deliveryIdentity(response)
  }

  async sendGroupAttachment(input: {
    openConversationId: string
    robotCode: string
    attachment: DingTalkRobotAttachment
  }): Promise<string> {
    const { msgKey, msgParam } = attachmentMessage(input.attachment)
    const response = await this.#request('/v1.0/robot/groupMessages/send', {
      method: 'POST',
      body: JSON.stringify({
        openConversationId: input.openConversationId,
        robotCode: input.robotCode,
        msgKey,
        msgParam: JSON.stringify(msgParam)
      })
    })
    return deliveryIdentity(response)
  }

  async sendPrivateAttachment(input: {
    robotCode: string
    userId: string
    attachment: DingTalkRobotAttachment
  }): Promise<string> {
    const { msgKey, msgParam } = attachmentMessage(input.attachment)
    const response = await this.#request('/v1.0/robot/oToMessages/batchSend', {
      method: 'POST',
      body: JSON.stringify({
        robotCode: input.robotCode,
        userIds: [input.userId],
        msgKey,
        msgParam: JSON.stringify(msgParam)
      })
    })
    return deliveryIdentity(response)
  }

  async createAndDeliverCard(input: {
    outTrackId: string
    openSpaceId: string
    robotCode: string
    space: 'group' | 'p2p'
    cardParamMap: Record<string, string>
  }): Promise<DingTalkCardDeliveryIdentity> {
    const expectedPrefix = input.space === 'group'
      ? 'dtv1.card//IM_GROUP.'
      : 'dtv1.card//IM_ROBOT.'
    if (!input.openSpaceId.startsWith(expectedPrefix)) {
      throw new Error('dingtalk_card_space_invalid')
    }
    await this.createCardInstance(input.outTrackId, input.cardParamMap)
    const response = await this.#request('/v1.0/card/instances/deliver', {
      method: 'POST',
      body: JSON.stringify({
        outTrackId: input.outTrackId,
        openSpaceId: input.openSpaceId,
        userIdType: 1,
        ...(input.space === 'group'
          ? { imGroupOpenDeliverModel: { robotCode: input.robotCode } }
          : {
              imRobotOpenDeliverModel: {
                spaceType: 'IM_ROBOT'
              }
            })
      })
    })
    const result = singleDeliveryResult(response)
    if (result.success !== true) throw new Error('dingtalk_open_api_card_delivery_failed')
    return {
      outTrackId: input.outTrackId,
      recallMessageId: requiredString(result, 'carrierId')
    }
  }

  async recallRobotMessage(input: {
    conversationKind: 'group' | 'p2p'
    chatId: string
    robotCode: string
    recallMessageId: string
  }): Promise<void> {
    const response = await this.#request(input.conversationKind === 'group'
      ? '/v1.0/robot/groupMessages/recall'
      : '/v1.0/robot/otoMessages/batchRecall', {
      method: 'POST',
      body: JSON.stringify({
        processQueryKeys: [input.recallMessageId],
        robotCode: input.robotCode,
        ...(input.conversationKind === 'group'
          ? { openConversationId: input.chatId }
          : {})
      })
    })
    const failed = response.failedResult
    if (failed && typeof failed === 'object' && !Array.isArray(failed)
      && Object.keys(failed).length > 0) {
      throw new Error('dingtalk_open_api_recall_failed')
    }
    const succeeded = response.successResult
    if (!Array.isArray(succeeded) || !succeeded.includes(input.recallMessageId)) {
      throw new Error('dingtalk_open_api_recall_identity_missing')
    }
  }

  async createCardInstance(
    outTrackId: string,
    cardParamMap: Record<string, string>
  ): Promise<void> {
    await this.#request('/v1.0/card/instances', {
      method: 'POST',
      body: JSON.stringify({
        cardTemplateId: DINGTALK_AI_CARD_TEMPLATE_ID,
        outTrackId,
        cardData: { cardParamMap },
        callbackType: 'STREAM',
        imGroupOpenSpaceModel: { supportForward: false },
        imRobotOpenSpaceModel: { supportForward: false }
      })
    })
  }

  async updateCard(outTrackId: string, cardParamMap: Record<string, string>): Promise<void> {
    await this.#request('/v1.0/card/instances', {
      method: 'PUT',
      body: JSON.stringify({
        outTrackId,
        cardData: { cardParamMap }
      })
    })
  }

  async streamCard(
    outTrackId: string,
    content: string,
    isFinalize: boolean,
    isError = false
  ): Promise<void> {
    await this.#request('/v1.0/card/streaming', {
      method: 'PUT',
      body: JSON.stringify({
        outTrackId,
        guid: randomUUID(),
        key: 'msgContent',
        content,
        isFull: true,
        isFinalize,
        isError
      })
    })
  }

  async #request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const token = await this.#token(init.signal ?? undefined)
    const headers = new Headers(init.headers)
    if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json')
    headers.set('x-acs-dingtalk-access-token', token)
    let response: Response
    try {
      response = await fetch(new URL(path, this.#apiOrigin), {
        ...init,
        headers,
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(init.signal ? [init.signal] : [])])
      })
    } catch (error) {
      if (init.signal?.aborted) throw error
      throw new DingTalkOpenApiError('dingtalk_open_api_network', 0)
    }
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw new DingTalkOpenApiError(`dingtalk_open_api_http_${response.status}`, response.status)
    }
    const value = body as Record<string, unknown>
    if (containsBusinessFailure(value)) {
      const code = optionalString(value, 'code') ?? optionalString(value, 'errorCode') ?? 'failed'
      throw new DingTalkOpenApiError('dingtalk_open_api_failed', response.status, code)
    }
    if (value.code && value.code !== '0' && value.code !== 0) {
      throw new DingTalkOpenApiError('dingtalk_open_api_failed', response.status, String(value.code))
    }
    return value
  }

  async #token(signal?: AbortSignal): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now() + 60_000) {
      return this.#accessToken.value
    }
    let response: Response
    try {
      response = await fetch(new URL('/v1.0/oauth2/accessToken', this.#apiOrigin), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appKey: this.#appKey, appSecret: this.#appSecret }),
        signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])])
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new DingTalkOpenApiError('dingtalk_app_access_token_network', 0)
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || !body) throw new DingTalkOpenApiError('dingtalk_app_access_token_failed', response.status)
    const value = requiredString(body, 'accessToken')
    const expiresIn = typeof body.expireIn === 'number' ? body.expireIn : 7_200
    this.#accessToken = { value, expiresAt: Date.now() + expiresIn * 1_000 }
    return value
  }
}

function containsBusinessFailure(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsBusinessFailure(item, seen))
  const record = value as Record<string, unknown>
  if (record.success === false || record.ok === false) return true
  return Object.values(record).some((item) => containsBusinessFailure(item, seen))
}

export type DingTalkCardButton =
  | { title: string; color?: 'gray' | 'red'; value: Record<string, unknown> }
  | { title: string; url: string }

export function encodeDingTalkCardActionId(value: Record<string, unknown>): string {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > MAX_DINGTALK_CARD_ACTION_BYTES) {
    throw new Error('dingtalk_card_action_too_large')
  }
  return `${DINGTALK_CARD_ACTION_PREFIX}${Buffer.from(json, 'utf8').toString('base64url')}`
}

export function decodeDingTalkCardActionId(value: string): Record<string, unknown> | null {
  if (!value.startsWith(DINGTALK_CARD_ACTION_PREFIX)) return null
  const encoded = value.slice(DINGTALK_CARD_ACTION_PREFIX.length)
  if (!encoded || encoded.length > Math.ceil(MAX_DINGTALK_CARD_ACTION_BYTES * 4 / 3) + 4
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return null
  try {
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.byteLength > MAX_DINGTALK_CARD_ACTION_BYTES) return null
    const parsed = JSON.parse(bytes.toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function dingtalkCardParams(input: {
  title: string
  content?: string | null
  buttons?: DingTalkCardButton[]
  flowStatus?: '1' | '2' | '3' | '5'
  streamingContent?: boolean
}): Record<string, string> {
  const buttons = input.buttons ?? []
  const content = input.content ?? ''
  const contentKey = input.streamingContent ? 'msgContent' : 'staticMsgContent'
  const order = content
    ? ['msgTitle', contentKey, 'msgButtons']
    : ['msgTitle', 'msgButtons']
  return {
    flowStatus: input.flowStatus ?? '3',
    msgTitle: input.title,
    staticMsgContent: input.streamingContent ? '' : content,
    msgContent: input.streamingContent ? content : '',
    sys_full_json_obj: JSON.stringify({
      order,
      msgButtons: buttons.map((button) => ({
        text: button.title,
        color: 'url' in button ? 'blue' : button.color ?? 'gray',
        ...('url' in button
          ? { url: button.url, iosUrl: button.url }
          : { id: encodeDingTalkCardActionId(button.value), request: true })
      }))
    })
  }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = optionalString(value, key)
  if (!result) throw new Error(`dingtalk_open_api_response_missing:${key}`)
  return result
}

function optionalString(value: Record<string, unknown>, key: string): string | null {
  const result = value[key]
  return typeof result === 'string' && result.trim() ? result.trim() : null
}

function deliveryIdentity(value: Record<string, unknown>): string {
  const identity = optionalString(value, 'processQueryKey')
    ?? optionalString(value, 'messageId')
  if (!identity) throw new Error('dingtalk_open_api_delivery_identity_missing')
  return identity
}

function singleDeliveryResult(value: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(value.result) || value.result.length !== 1) {
    throw new Error('dingtalk_open_api_card_delivery_result_missing')
  }
  const result = value.result[0]
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('dingtalk_open_api_card_delivery_result_missing')
  }
  return result as Record<string, unknown>
}
