import { randomUUID } from 'node:crypto'

const DEFAULT_API_ORIGIN = 'https://api.dingtalk.com'
export const DINGTALK_AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema'

export class DingTalkOpenApiClient {
  readonly #appKey: string
  readonly #appSecret: string
  readonly #apiOrigin: string
  #accessToken: { value: string; expiresAt: number } | null = null

  constructor(input: { appKey: string; appSecret: string; apiOrigin?: string }) {
    this.#appKey = input.appKey
    this.#appSecret = input.appSecret
    this.#apiOrigin = input.apiOrigin ?? DEFAULT_API_ORIGIN
  }

  async uploadImage(bytes: Buffer, fileName: string): Promise<string> {
    const data = new FormData()
    data.append('media', new Blob([Uint8Array.from(bytes)], { type: 'image/png' }), fileName)
    const response = await this.#request('/v1.0/media/upload?mediaType=image', {
      method: 'POST',
      body: data
    })
    return requiredString(response, 'mediaId')
  }

  async groupRobotCodes(openConversationId: string): Promise<string[]> {
    const response = await this.#request('/v1.0/robot/getBotListInGroup', {
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
    atUserIds?: readonly string[]
  }): Promise<string> {
    const response = await this.#request('/v1.0/robot/orgGroupSend', {
      method: 'POST',
      body: JSON.stringify({
        openConversationId: input.openConversationId,
        robotCode: input.robotCode,
        msgKey: 'sampleMarkdown',
        msgParam: JSON.stringify({ title: input.title, text: input.text }),
        atUserIds: input.atUserIds ?? []
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

  async createAndDeliverCard(input: {
    outTrackId: string
    openSpaceId: string
    robotCode: string
    space: 'group' | 'p2p'
    cardParamMap: Record<string, string>
  }): Promise<string> {
    const expectedPrefix = input.space === 'group'
      ? 'dtv1.card//IM_GROUP.'
      : 'dtv1.card//IM_ROBOT.'
    if (!input.openSpaceId.startsWith(expectedPrefix)) {
      throw new Error('dingtalk_card_space_invalid')
    }
    await this.createCardInstance(input.outTrackId, input.cardParamMap)
    await this.#request('/v1.0/card/instances/deliver', {
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
    return input.outTrackId
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
    const token = await this.#token()
    const headers = new Headers(init.headers)
    if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json')
    headers.set('x-acs-dingtalk-access-token', token)
    const response = await fetch(new URL(path, this.#apiOrigin), {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000)
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`dingtalk_open_api_http_${response.status}`)
    }
    const value = body as Record<string, unknown>
    if (containsBusinessFailure(value)) {
      const code = optionalString(value, 'code') ?? optionalString(value, 'errorCode') ?? 'failed'
      throw new Error(`dingtalk_open_api_${code}`)
    }
    if (value.code && value.code !== '0' && value.code !== 0) {
      throw new Error(`dingtalk_open_api_${String(value.code)}`)
    }
    return value
  }

  async #token(): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now() + 60_000) {
      return this.#accessToken.value
    }
    const response = await fetch(new URL('/v1.0/oauth2/accessToken', this.#apiOrigin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: this.#appKey, appSecret: this.#appSecret }),
      signal: AbortSignal.timeout(20_000)
    })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || !body) throw new Error('dingtalk_app_access_token_failed')
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

export function dingtalkCardParams(input: {
  title: string
  content: string
  buttons?: Array<{ title: string; value: Record<string, unknown> }>
  flowStatus?: '1' | '2' | '3' | '5'
  streamingContent?: boolean
}): Record<string, string> {
  const buttons = input.buttons ?? []
  const contentKey = input.streamingContent ? 'msgContent' : 'staticMsgContent'
  return {
    flowStatus: input.flowStatus ?? '3',
    msgTitle: input.title,
    staticMsgContent: input.streamingContent ? '' : input.content,
    msgContent: input.streamingContent ? input.content : '',
    sys_full_json_obj: JSON.stringify({
      order: ['msgTitle', contentKey, 'msgButtons'],
      msgButtons: buttons.map((button) => ({
        title: button.title,
        action: { type: 'callback', value: JSON.stringify(button.value) }
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
