import { randomUUID } from 'node:crypto'
import type { CoreClient } from './core-client'

export interface FeishuAppCredential {
  appId: string
  appSecret: string
}

export interface DingTalkAppCredential {
  appKey: string
  appSecret: string
  robotCode: string
}

export type PublishedChannelCredential = {
  agentId: string
  credentialRef: string
  provider: 'feishu' | 'dingtalk'
  remoteAppId: string
  credential: FeishuAppCredential | DingTalkAppCredential
  revision: number
}

export interface DingTalkCredentialStore {
  readDingTalk(credentialRef: string): Promise<DingTalkAppCredential | null>
  deleteDingTalk(credentialRef: string): Promise<void>
  listPublished(): Promise<readonly PublishedChannelCredential[]>
}

export interface ChannelCredentialStore {
  read(credentialRef: string): Promise<FeishuAppCredential | null>
  delete(credentialRef: string): Promise<void>
  listPublished(): Promise<readonly PublishedChannelCredential[]>
}

export type StoredChannelDeveloperSession<TIdentity, TSession> = {
  provider: 'feishu' | 'dingtalk'
  accountId: string
  identity: TIdentity
  session: TSession
  revision: number
}

export class SqliteChannelCredentialStore
implements ChannelCredentialStore, DingTalkCredentialStore {
  readonly #core: Pick<CoreClient, 'request'>
  #publishedLoad: Promise<readonly PublishedChannelCredential[]> | null = null

  constructor(core: Pick<CoreClient, 'request'>) {
    this.#core = core
  }

  read(credentialRef: string): Promise<FeishuAppCredential | null> {
    return this.#read(credentialRef, 'feishu')
  }

  readDingTalk(credentialRef: string): Promise<DingTalkAppCredential | null> {
    return this.#read(credentialRef, 'dingtalk')
  }

  delete(credentialRef: string): Promise<void> {
    return this.#delete(credentialRef, 'feishu')
  }

  deleteDingTalk(credentialRef: string): Promise<void> {
    return this.#delete(credentialRef, 'dingtalk')
  }

  listPublished(): Promise<readonly PublishedChannelCredential[]> {
    this.#publishedLoad ??= this.#core.request<unknown>(
      'channels.credentials.listPublished',
      {}
    ).then(parsePublishedCredentials).catch((error) => {
      this.#publishedLoad = null
      throw error
    })
    return this.#publishedLoad
  }

  async #read(
    credentialRef: string,
    provider: 'feishu'
  ): Promise<FeishuAppCredential | null>
  async #read(
    credentialRef: string,
    provider: 'dingtalk'
  ): Promise<DingTalkAppCredential | null>
  async #read(
    credentialRef: string,
    provider: 'feishu' | 'dingtalk'
  ): Promise<FeishuAppCredential | DingTalkAppCredential | null> {
    const stored = await this.#core.request<unknown>('channels.credentials.get', {
      credentialRef,
      provider
    })
    if (stored === null) return null
    return parseCredentialRecord(stored, provider).credential
  }

  async #delete(
    credentialRef: string,
    provider: 'feishu' | 'dingtalk'
  ): Promise<void> {
    const result = await this.#core.request<StoredCommandResult>(
      'channels.credentials.delete',
      {
        commandId: randomUUID(),
        command: { provider, credentialRef }
      }
    )
    requireApplied(result)
    this.#publishedLoad = null
  }
}

export class SqliteChannelDeveloperSessionStore {
  readonly #core: Pick<CoreClient, 'request'>

  constructor(core: Pick<CoreClient, 'request'>) {
    this.#core = core
  }

  async read<TIdentity, TSession>(
    provider: 'feishu' | 'dingtalk'
  ): Promise<StoredChannelDeveloperSession<TIdentity, TSession> | null> {
    const value = await this.#core.request<unknown>('channels.developerSession.get', {
      provider
    })
    if (value === null) return null
    return parseDeveloperSession<TIdentity, TSession>(value, provider)
  }

  async replace<TIdentity, TSession>(input: {
    provider: 'feishu' | 'dingtalk'
    accountId: string
    identity: TIdentity
    session: TSession
    expectedRevision: number | null
  }): Promise<number> {
    const result = await this.#core.request<StoredCommandResult>(
      'channels.developerSession.replace',
      {
        commandId: randomUUID(),
        command: input
      }
    )
    requireApplied(result)
    const revision = asPositiveInteger(asRecord(result.payload)?.revision)
    if (revision === null) throw new Error('channel_developer_session_response_invalid')
    return revision
  }

  async delete(provider: 'feishu' | 'dingtalk'): Promise<void> {
    const result = await this.#core.request<StoredCommandResult>(
      'channels.developerSession.delete',
      {
        commandId: randomUUID(),
        command: { provider }
      }
    )
    requireApplied(result)
  }
}

type StoredCommandResult = {
  status: 'applied' | 'accepted' | 'rejected'
  code: string
  payload?: unknown
}

function requireApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') throw new Error(result.code)
  if (result.status !== 'applied') throw new Error('channel_storage_command_not_applied')
}

function parsePublishedCredentials(value: unknown): readonly PublishedChannelCredential[] {
  if (!Array.isArray(value)) throw new Error('channel_credential_response_invalid')
  const seen = new Set<string>()
  return value.map((entry) => {
    const record = asRecord(entry)
    const provider = providerAt(record, 'provider')
    const parsed = parseCredentialRecord(record, provider)
    const agentId = stringAt(record, 'agentId')
    if (!agentId || seen.has(parsed.credentialRef)) {
      throw new Error('channel_credential_response_invalid')
    }
    seen.add(parsed.credentialRef)
    return { agentId, ...parsed }
  })
}

function parseCredentialRecord(
  value: unknown,
  expectedProvider: 'feishu' | 'dingtalk'
): Omit<PublishedChannelCredential, 'agentId'> {
  const record = asRecord(value)
  const provider = providerAt(record, 'provider')
  const credentialRef = stringAt(record, 'credentialRef')
  const remoteAppId = stringAt(record, 'remoteAppId')
  const revision = asPositiveInteger(record?.revision)
  const payload = asRecord(record?.payload)
  const appSecret = stringAt(payload, 'appSecret')
  if (
    provider !== expectedProvider
    || !credentialRef
    || !remoteAppId
    || revision === null
    || !appSecret
  ) throw new Error('channel_credential_response_invalid')
  if (provider === 'feishu') {
    return {
      credentialRef,
      provider,
      remoteAppId,
      revision,
      credential: { appId: remoteAppId, appSecret }
    }
  }
  const robotCode = stringAt(payload, 'robotCode')
  if (!robotCode) throw new Error('channel_credential_response_invalid')
  return {
    credentialRef,
    provider,
    remoteAppId,
    revision,
    credential: { appKey: remoteAppId, appSecret, robotCode }
  }
}

function parseDeveloperSession<TIdentity, TSession>(
  value: unknown,
  expectedProvider: 'feishu' | 'dingtalk'
): StoredChannelDeveloperSession<TIdentity, TSession> {
  const record = asRecord(value)
  const provider = providerAt(record, 'provider')
  const accountId = stringAt(record, 'accountId')
  const revision = asPositiveInteger(record?.revision)
  if (
    provider !== expectedProvider
    || !accountId
    || revision === null
    || !asRecord(record?.identity)
    || !asRecord(record?.session)
  ) throw new Error('channel_developer_session_response_invalid')
  return {
    provider,
    accountId,
    identity: record!.identity as TIdentity,
    session: record!.session as TSession,
    revision
  }
}

function providerAt(
  value: Record<string, unknown> | null,
  key: string
): 'feishu' | 'dingtalk' {
  const provider = value?.[key]
  if (provider !== 'feishu' && provider !== 'dingtalk') {
    throw new Error('channel_storage_provider_invalid')
  }
  return provider
}

function stringAt(value: Record<string, unknown> | null, key: string): string | null {
  const candidate = value?.[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
}

function asPositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
