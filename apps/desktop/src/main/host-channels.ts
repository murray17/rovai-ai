import type { ChannelKind, ChannelSettingsSnapshot, MemberBotProvisioningView } from '@contracts'
import type { ChannelSettingsCoordinator } from './channel-settings-coordinator'
import { LARK_PROVIDER_PROFILE, presentProviderMessage } from './channel-provider-profile'

export type HostChannelRequest = { operation: 'get' }
  | { operation: 'publish'; kind: ChannelKind; agentId: string }
  | { operation: 'retry'; kind: ChannelKind; agentId: string }
  | { operation: 'selectApprover'; kind: 'dingtalk'; agentId: string; userId: string }
export type HostChannelReply = { result: ChannelSettingsSnapshot; error: null }
  | { error: 'channel_session_expired' | 'channel_native_interaction' | 'channel_operation_failed' }

export function parseHostChannelRequest(value: unknown): HostChannelRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  const keys = Object.keys(request).sort().join(',')
  const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= 256 && !/[\u0000-\u001f\u007f]/u.test(value)
  if (request.operation === 'get' && keys === 'operation') return { operation: 'get' }
  if (!['feishu', 'lark', 'dingtalk'].includes(String(request.kind)) || !id(request.agentId)) return null
  if (['publish', 'retry'].includes(String(request.operation)) && keys === 'agentId,kind,operation') {
    return { operation: request.operation as 'publish' | 'retry', kind: request.kind as ChannelKind, agentId: request.agentId }
  }
  if (request.operation === 'selectApprover' && request.kind === 'dingtalk' && id(request.userId)
    && keys === 'agentId,kind,operation,userId') {
    return { operation: 'selectApprover', kind: 'dingtalk', agentId: request.agentId, userId: request.userId }
  }
  return null
}

// Explicit projection, not object spread: newly added native fields or platform
// session objects cannot silently cross this boundary. Login QR stays native.
export function projectHostChannels(snapshot: ChannelSettingsSnapshot): ChannelSettingsSnapshot {
  return {
    schemaVersion: 4,
    channels: snapshot.channels.map(provider => ({
      kind: provider.kind, displayName: provider.displayName, hostStatus: provider.hostStatus,
      connection: {
        status: provider.connection.status, sessionStatus: provider.connection.sessionStatus ?? 'unknown',
        account: provider.connection.account ? {
          accountId: provider.connection.account.accountId,
          userName: provider.connection.account.userName,
          tenantName: provider.connection.account.tenantName,
          email: provider.connection.account.email,
          brand: provider.connection.account.brand,
          connectedAt: provider.connection.account.connectedAt,
          lastVerifiedAt: provider.connection.account.lastVerifiedAt
        } : null
      },
      memberBots: provider.memberBots.map(bot => ({
        agentId: bot.agentId, publicationStatus: bot.publicationStatus, published: bot.published,
        connectionStatus: bot.connectionStatus ?? 'unknown', botDisplayName: bot.botDisplayName,
        appId: bot.appId, managementUrl: managementUrl(bot.managementUrl), failureCode: bot.failureCode
      })),
      provisioning: provider.provisioning === undefined ? undefined : projectProvisioning(provider.provisioning),
      pendingBindingCount: provider.pendingBindingCount, bindingIssueCount: provider.bindingIssueCount
    })),
    pendingBindingCount: snapshot.pendingBindingCount, bindingIssueCount: snapshot.bindingIssueCount,
    activeQrAttempt: null,
    activeProvisioning: projectProvisioning(snapshot.activeProvisioning)
  }
}

function projectProvisioning(active: MemberBotProvisioningView | null): MemberBotProvisioningView | null {
  return active ? {
      kind: active.kind, publicationIntentId: active.publicationIntentId, agentId: active.agentId,
      stage: active.stage, detail: active.detail, remoteAppId: active.remoteAppId, failureCode: active.failureCode,
      approvalCandidates: active.approvalCandidates?.map(candidate => ({ userId: candidate.userId, displayName: candidate.displayName }))
  } : null
}

function managementUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
      && ['open.feishu.cn', 'open.larksuite.com', 'open-dev.dingtalk.com'].includes(url.hostname) ? value : null
  } catch { return null }
}

const feishuReconnectFailures = [
  '飞书登录已过期，请先重新连接账号。', '飞书登录已过期或账号已变化，请先重新连接账号。',
  '请先连接最初发布该队员应用的飞书账号。', 'feishu_session_expired',
  'feishu_developer_session_expired', 'feishu_developer_identity_changed'
]
// Lark failures are the Feishu ones as presented by the Lark instance; neither leaks into the other.
const reconnectFailures = new Set([
  ...feishuReconnectFailures,
  ...feishuReconnectFailures.map(failure => presentProviderMessage(LARK_PROVIDER_PROFILE, failure)),
  '请先连接最初发布该队员应用的钉钉账号。',
  '请先连接钉钉开发者账号。', '钉钉账号已变化，请重新连接。',
  'dingtalk_developer_session_expired', 'dingtalk_legacy_session_requires_reconnect',
  'dingtalk_account_identity_changed'
])
const nativeInteractionFailures = new Set([
  'feishu_login_interaction_required', 'lark_login_interaction_required',
  'dingtalk_login_interaction_required'
])

export function createHostChannelHandler(service: Pick<ChannelSettingsCoordinator,
  'get' | 'publishMemberBot' | 'retryMemberBot' | 'selectPublicationApprover'
>): (request: HostChannelRequest) => Promise<HostChannelReply> {
  return async request => {
    try {
      const snapshot = request.operation === 'get' ? await service.get()
        : request.operation === 'publish' ? await service.publishMemberBot(request.agentId, request.kind)
          : request.operation === 'retry' ? await service.retryMemberBot(request.agentId, request.kind)
            : await service.selectPublicationApprover(request.agentId, request.userId, request.kind)
      return { result: projectHostChannels(snapshot), error: null }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return { error: reconnectFailures.has(code) ? 'channel_session_expired'
        : nativeInteractionFailures.has(code) ? 'channel_native_interaction' : 'channel_operation_failed' }
    }
  }
}
