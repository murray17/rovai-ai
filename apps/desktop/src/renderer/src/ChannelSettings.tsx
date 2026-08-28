import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  ChannelAccountView,
  ChannelMemberBotView,
  ChannelProviderView,
  ChannelSettingsSnapshot,
  MemberBotProvisioningView
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'

export function visibleChannelMembers(agents: readonly AgentProfile[]): AgentProfile[] {
  return agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
}

export function ChannelSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ChannelSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [publishAgentId, setPublishAgentId] = useState<string | null>(null)
  const [publishBoundAppId, setPublishBoundAppId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.rovai.channels.get()
      setSnapshot(assertChannelSettingsSnapshot(next))
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return window.rovai.channels.onChanged((next) => {
      try {
        setSnapshot(assertChannelSettingsSnapshot(next))
      } catch (nextError) {
        setError(channelErrorMessage(nextError))
      }
    })
  }, [load])

  const run = useCallback(async (
    key: string,
    action: () => Promise<ChannelSettingsSnapshot>
  ): Promise<boolean> => {
    if (busy) return false
    setBusy(key)
    setError(null)
    try {
      setSnapshot(assertChannelSettingsSnapshot(await action()))
      return true
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
      return false
    } finally {
      setBusy(null)
    }
  }, [busy])

  const cancelQrAttempt = useCallback(async (attemptId: string): Promise<void> => {
    setError(null)
    try {
      setSnapshot(assertChannelSettingsSnapshot(
        await window.rovai.channels.cancelQrAttempt(attemptId)
      ))
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
    }
  }, [])

  const channel = snapshot?.channels.find((candidate) => candidate.kind === 'feishu') ?? null

  return (
    <>
      <ChannelSettingsView
        agents={agents}
        snapshot={snapshot}
        loading={loading}
        busy={busy}
        error={error}
        onRetry={() => void load()}
        onConnect={() => void run('connect', () => window.rovai.channels.connect())}
        onDisconnect={() => void run('disconnect', () => window.rovai.channels.disconnect())}
        onPublish={(provider, agent) => {
          setError(null)
          setPublishBoundAppId(
            provider.memberBots.find((bot) => bot.agentId === agent.agentId)?.appId ?? null
          )
          setPublishAgentId(agent.agentId)
        }}
        onRetryPublish={(_, agent) => void run(
          `retry:${agent.agentId}`,
          () => window.rovai.channels.retryMemberBot(agent.agentId)
        )}
      />

      <QrDialog
        snapshot={snapshot}
        busy={busy !== null}
        onClose={(attemptId) => void cancelQrAttempt(attemptId)}
      />

      <PublishBotDialog
        agent={agents.find((candidate) => candidate.agentId === publishAgentId) ?? null}
        account={channel?.connection.account ?? null}
        boundAppId={publishBoundAppId}
        provisioning={snapshot?.activeProvisioning?.agentId === publishAgentId
          ? snapshot.activeProvisioning
          : null}
        busy={busy !== null}
        error={error}
        onClose={() => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
        }}
        onReconnect={() => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
          void run('connect', () => window.rovai.channels.connect())
        }}
        onPublish={(agentId) => {
          void run(`publish:${agentId}`, () => window.rovai.channels.publishMemberBot(agentId))
            .then((completed) => {
              if (completed) {
                setPublishAgentId(null)
                setPublishBoundAppId(null)
              }
            })
        }}
      />

    </>
  )
}

export function ChannelSettingsView({
  agents,
  snapshot,
  loading = false,
  busy = null,
  error = null,
  onRetry = () => undefined,
  onConnect,
  onDisconnect,
  onPublish,
  onRetryPublish
}: {
  agents: AgentProfile[]
  snapshot: ChannelSettingsSnapshot | null
  loading?: boolean
  busy?: string | null
  error?: string | null
  onRetry?(): void
  onConnect?(channel: ChannelProviderView): void
  onDisconnect?(channel: ChannelProviderView): void
  onPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onRetryPublish?(channel: ChannelProviderView, agent: AgentProfile): void
}): React.JSX.Element {
  const members = useMemo(() => visibleChannelMembers(agents), [agents])
  const channel = snapshot?.channels.find((candidate) => candidate.kind === 'feishu') ?? null

  return (
    <div className="channel-settings">
      <SettingsPageHeader
        eyebrow="Settings / Channels"
        title="渠道"
        description="在本机连接飞书并逐一发布队员 Bot。只有 Rovai 主人可以从飞书触发队员；群聊和话题的项目在首次使用时私密选择。"
        aside={<span className="settings-page-note">主人本机</span>}
      />

      {loading && !snapshot && <ChannelSettingsState label="正在读取渠道状态…" />}

      {!loading && !snapshot && (
        <ChannelSettingsState
          label={error ?? '渠道状态暂时不可用。'}
          tone="error"
          action={<button className="quiet-button compact" type="button" onClick={onRetry}>重试</button>}
        />
      )}

      {snapshot && !channel && <ChannelSettingsState label="当前版本没有可用的渠道。" tone="empty" />}

      {channel && snapshot && (
        <div className="channel-settings-body">
          {error && (
            <div className="channel-settings-inline-error" role="alert">
              <span>{error}</span>
              <button className="quiet-button compact" type="button" onClick={onRetry}>重新读取</button>
            </div>
          )}

          <section className="channel-settings-section" aria-labelledby="channel-provider-heading">
            <ChannelSectionHeading
              id="channel-provider-heading"
              title="渠道"
              description="一期只接入飞书。所有连接和配置都留在这台设备。"
              summary={`${snapshot.channels.length} 个渠道`}
            />
            <div className="channel-provider-strip" role="tablist" aria-label="渠道">
              <button className="channel-provider-tab" type="button" role="tab" aria-selected="true">
                <ChannelMark />
                <span>
                  <strong>{channel.displayName}</strong>
                  <small>{channel.hostStatus === 'ready' ? connectionLabel(channel) : '待接入'}</small>
                </span>
              </button>
            </div>
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-connection-heading">
            <ChannelSectionHeading
              id="channel-connection-heading"
              title="飞书连接"
              description="连接只决定后续 Bot 的发布目标；切换连接不会迁移或停用已发布 Bot。"
            />
            <ChannelConnectionRow
              channel={channel}
              busy={busy}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
            <p className="channel-owner-note">
              <OwnerShieldIcon />
              <span>飞书中的主人消息仍是外部消息身份，不获得本机管理权限。项目绝对路径不会发送到飞书。</span>
            </p>
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-member-bots-heading">
            <ChannelSectionHeading
              id="channel-member-bots-heading"
              title="队员 Bot"
              description="每次只发布一名队员。每名队员拥有独立 Bot 身份和隔离的长连接。"
              summary={memberSummary(members, channel.memberBots)}
            />
            <ChannelMemberBotTable
              channel={channel}
              members={members}
              busy={busy}
              onPublish={onPublish}
              onRetryPublish={onRetryPublish}
            />
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-binding-diagnostics-heading">
            <ChannelSectionHeading
              id="channel-binding-diagnostics-heading"
              title="会话接入"
              description="私聊自动进入 Quick Chat；群聊和话题首次由主人 @ 后，在飞书私密卡片中选择一次项目。"
              summary={`${snapshot.pendingBindingCount} 个待选择`}
            />
            <div className="channel-binding-diagnostics" role="status">
              <span><strong>{snapshot.pendingBindingCount}</strong><small>待处理绑定</small></span>
              <span className={snapshot.bindingIssueCount > 0 ? 'is-warning' : undefined}>
                <strong>{snapshot.bindingIssueCount}</strong><small>绑定异常</small>
              </span>
              <p>项目绑定完成后不可换绑；需要另一个项目时，请新建飞书群或话题。</p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ChannelSettingsState({
  label,
  tone = 'loading',
  action
}: {
  label: string
  tone?: 'loading' | 'empty' | 'error'
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`channel-settings-state is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true" />
      <p>{label}</p>
      {action}
    </div>
  )
}

function ChannelSectionHeading({
  id,
  title,
  description,
  summary
}: {
  id: string
  title: string
  description: string
  summary?: string
}): React.JSX.Element {
  return (
    <div className="channel-section-heading">
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      {summary && <span>{summary}</span>}
    </div>
  )
}

function ChannelConnectionRow({
  channel,
  busy,
  onConnect,
  onDisconnect
}: {
  channel: ChannelProviderView
  busy: string | null
  onConnect?: (channel: ChannelProviderView) => void
  onDisconnect?: (channel: ChannelProviderView) => void
}): React.JSX.Element {
  const account = channel.connection.account
  const connected = channel.connection.status === 'connected' && account !== null
  const hostReady = channel.hostStatus === 'ready'
  return (
    <div className="channel-connection-row">
      <ChannelMark />
      <div className="channel-connection-label">
        <strong>飞书开放平台</strong>
        <span>{hostReady ? '开发者账号会话 · 本机加密保存' : '渠道宿主尚未就绪'}</span>
      </div>
      {connected ? (
        <div className="channel-account-summary">
          <span className="channel-account-avatar" aria-hidden="true">{firstGrapheme(account.userName)}</span>
          <span>
            <strong>{account.userName}</strong>
            <small>{account.email ? `${account.email} · ` : ''}{account.tenantName} · {account.brand === 'lark' ? 'Lark' : '飞书'}</small>
          </span>
        </div>
      ) : (
        <span className="channel-account-empty">{hostReady ? '还没有连接飞书账号' : '连接能力尚未开放'}</span>
      )}
      <span className={`channel-connection-status${connected ? ' is-connected' : ''}`}>
        {connected ? '已连接' : channel.connection.status === 'session_expired' ? '需重新连接' : '未连接'}
      </span>
      <div className="channel-connection-actions">
        {connected && (
          <button
            className="channel-row-action"
            type="button"
            disabled={busy !== null || !onDisconnect}
            onClick={() => onDisconnect?.(channel)}
          >
            {busy === 'disconnect' ? '断开中…' : '断开'}
          </button>
        )}
        <button
          className="quiet-button compact"
          type="button"
          disabled={!hostReady || busy !== null || !onConnect}
          title={!hostReady ? '飞书渠道宿主尚未接入' : undefined}
          onClick={() => onConnect?.(channel)}
        >
          {busy === 'connect' ? '等待扫码…' : connected ? '切换账号' : hostReady ? '登录开放平台' : '尚未开放'}
        </button>
      </div>
    </div>
  )
}

function ChannelMemberBotTable({
  channel,
  members,
  busy,
  onPublish,
  onRetryPublish
}: {
  channel: ChannelProviderView
  members: AgentProfile[]
  busy: string | null
  onPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
  onRetryPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
}): React.JSX.Element {
  const bots = new Map(channel.memberBots.map((bot) => [bot.agentId, bot]))
  const connected = channel.hostStatus === 'ready'
    && channel.connection.status === 'connected'
    && channel.connection.account !== null
  if (members.length === 0) {
    return <div className="channel-member-bots-empty"><strong>还没有可发布的队员</strong><span>先在队员页创建或恢复一名队员。</span></div>
  }
  return (
    <div className="channel-member-bot-table" role="table" aria-label="队员 Bot">
      <div className="channel-member-bot-grid channel-member-bot-head" role="row">
        <span role="columnheader">队员</span><span role="columnheader">飞书身份</span><span role="columnheader">状态</span><span role="columnheader" aria-label="操作" />
      </div>
      <div role="rowgroup">
        {members.map((agent) => {
          const bot = bots.get(agent.agentId)
          const status = bot?.publicationStatus ?? 'unpublished'
          const published = status === 'published'
          const failed = status === 'failed'
          const disabled = status === 'disabled'
          const provisioning = status === 'provisioning'
          const action = failed ? onRetryPublish : onPublish
          const actionBusy = busy === `publish:${agent.agentId}` || busy === `retry:${agent.agentId}`
          return (
            <div className="channel-member-bot-grid channel-member-bot-row" role="row" key={agent.agentId}>
              <div className="channel-member-identity" role="cell">
                <MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="workspace" decorative />
                <span><strong>{agent.displayName}</strong><small>{agent.teamRole || '未设置队内职责'}</small></span>
              </div>
              <div className="channel-bot-identity" role="cell">
                {bot?.botDisplayName
                  ? <><strong>{bot.botDisplayName}</strong><small>独立 Bot 身份</small></>
                  : <span>名称沿用队员；应用图标由 Rovai 配置</span>}
              </div>
              <span className={`channel-publication-status is-${status}`} role="cell">
                <span>{publicationLabel(status)}</span>
              </span>
              <div className="channel-member-action" role="cell">
                {published && bot?.managementUrl ? (
                  <a
                    className="channel-row-action"
                    href={bot.managementUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`在飞书开放平台管理 ${agent.displayName}`}
                  >
                    飞书管理
                  </a>
                ) : (
                  <button
                    className="channel-row-action"
                    type="button"
                    disabled={!connected || busy !== null || provisioning || !action || published}
                    onClick={() => action?.(channel, agent)}
                  >
                    {actionBusy || provisioning
                      ? '处理中…'
                      : published
                        ? '管理不可用'
                        : failed
                          ? bot?.appId ? '继续核对' : '重试'
                          : connected
                            ? disabled ? '重新发布' : '发布'
                            : '等待连接'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QrDialog({
  snapshot,
  busy,
  onClose
}: {
  snapshot: ChannelSettingsSnapshot | null
  busy: boolean
  onClose: (attemptId: string) => void
}): React.JSX.Element {
  const attempt = snapshot?.activeQrAttempt ?? null
  if (!attempt) return <></>
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(attempt.attemptId) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="channel-qr-dialog">
          <AppDialogHeader
            title="登录飞书开放平台"
            description="使用飞书扫码登录开发者平台。本次不会创建应用、读取 App Secret 或发布 Bot。"
            icon="shield"
            closeDisabled={busy && attempt.stage !== 'failed'}
          />
          <AppDialogBody className="channel-qr-body">
            <div className={`channel-qr-frame is-${attempt.stage}`}>
              {attempt.qrDataUrl
                ? <img src={attempt.qrDataUrl} alt="飞书连接二维码" />
                : <span aria-hidden="true"><ChannelMark /></span>}
            </div>
            <strong>{attempt.detail}</strong>
            <small>{attempt.expiresAt
              ? `二维码有效期至 ${formatLocalTime(attempt.expiresAt)}`
              : '开发者会话只会保存到本机系统安全存储。'}</small>
          </AppDialogBody>
          <AppDialogFooter note="登录后，后续发布会复用同一开发者会话。">
            <button className="quiet-button" type="button" onClick={() => onClose(attempt.attemptId)}>
              {attempt.stage === 'failed' ? '关闭' : '取消'}
            </button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PublishBotDialog({
  agent,
  account,
  boundAppId,
  provisioning,
  busy,
  error,
  onClose,
  onReconnect,
  onPublish
}: {
  agent: AgentProfile | null
  account: ChannelAccountView | null
  boundAppId: string | null
  provisioning: MemberBotProvisioningView | null
  busy: boolean
  error: string | null
  onClose: () => void
  onReconnect: () => void
  onPublish: (agentId: string) => void
}): React.JSX.Element {
  if (!agent || !account) return <></>
  const terminal = provisioning
    ? ['completed', 'failed', 'unknown_remote_state'].includes(provisioning.stage)
    : false
  const effectiveAppId = boundAppId ?? provisioning?.remoteAppId ?? null
  const retryLocked = provisioning?.stage === 'unknown_remote_state'
    && provisioning.remoteAppId === null
  const connectionFailed = provisioning?.failureCode === 'feishu_connection_error'
  const sessionUnavailable = Boolean(error && /登录已过期|账号已变化|重新连接账号/.test(error))
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && (!busy || terminal)) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="channel-publish-dialog">
          <AppDialogHeader
            title={boundAppId
              ? `重新发布「${agent.displayName}」飞书 Bot`
              : `发布「${agent.displayName}」为飞书 Bot`}
            description={boundAppId
              ? 'Rovai 会核对并恢复这名队员已经绑定的飞书应用。App ID 保持不变，不会创建或换绑其他应用。'
              : 'Rovai 会复用当前开发者会话，在后台创建、配置并发布这名队员的独立应用。正常流程不会打开飞书创建确认页，也不需要再次扫码。'}
            icon="server"
            closeDisabled={busy && !terminal}
          />
          <AppDialogBody>
            <div className="channel-publish-identity">
              <MemberAvatar
                agentId={agent.agentId}
                avatarRef={agent.avatarRef}
                displayName={agent.displayName}
                size="workspace"
                decorative
              />
              <span><strong>{agent.displayName}</strong><small>{agent.teamRole || '协作者'}</small></span>
              <span className="channel-publish-arrow" aria-hidden="true">→</span>
              <ChannelMark />
              <span><strong>独立飞书 Bot</strong><small>权限、事件与长连接彼此隔离</small></span>
            </div>
            <div className="channel-dialog-fact"><span>发布账号</span><strong>{account.userName}</strong></div>
            <div className="channel-dialog-fact"><span>所属租户</span><strong>{account.tenantName}</strong></div>
            {effectiveAppId && <div className="channel-dialog-fact"><span>绑定应用</span><code>{effectiveAppId}</code></div>}
            <div className="channel-dialog-fact"><span>应用说明</span><strong>Rovai AI 队员 · {agent.teamRole || '协作者'}</strong></div>
            {error && <div className="channel-dialog-error" role="alert">{error}</div>}
            {provisioning ? (
              <div className={`channel-provisioning-state is-${provisioning.stage}`} role="status">
                <span className="channel-provisioning-dot" aria-hidden="true" />
                <span>
                  <strong>{provisioningLabel(
                    provisioning.stage,
                    Boolean(effectiveAppId)
                  )}</strong>
                  <small>{provisioning.detail}</small>
                  {provisioning.remoteAppId && <code>{provisioning.remoteAppId}</code>}
                  {terminal && provisioning.failureCode && (
                    <code>{provisioning.failureCode}</code>
                  )}
                </span>
              </div>
            ) : (
              <p className="channel-publish-note">
                {boundAppId
                  ? '该队员的飞书身份已冻结到此应用；重新发布只恢复原应用的配置、版本和连接。'
                  : '创建前会再次校验账号和租户；一旦身份变化或会话过期，发布会停止并提示重新连接。'}
              </p>
            )}
          </AppDialogBody>
          <AppDialogFooter note={connectionFailed
            ? effectiveAppId
              ? '已保留原应用绑定；关闭后可以稍后重试。'
              : '飞书连接异常；关闭后可以稍后重试。'
            : retryLocked
              ? '创建结果无法确认。Rovai 已锁定再次创建，避免产生重复应用。'
            : effectiveAppId
              ? '重新发布始终复用已绑定应用，不提供换绑入口。'
              : '发布只使用当前开发者会话，不会打开平台创建确认页。'}>
            <button className="quiet-button" type="button" disabled={busy && !terminal} onClick={onClose}>取消</button>
            {sessionUnavailable ? (
              <button className="primary-button" type="button" disabled={busy} onClick={onReconnect}>
                重新连接飞书
              </button>
            ) : !retryLocked && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => onPublish(agent.agentId)}>
                {busy
                  ? effectiveAppId ? '核对中…' : '发布中…'
                  : provisioning?.stage === 'failed' && effectiveAppId
                    ? '继续核对'
                    : boundAppId
                      ? '确认重新发布'
                      : provisioning?.stage === 'failed'
                        ? '重新发布'
                        : '确认发布'}
              </button>
            )}
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ChannelMark(): React.JSX.Element {
  return <span className="channel-mark channel-mark-feishu" aria-hidden="true">飞</span>
}

function OwnerShieldIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.8 8.3 7 10 4.2-1.7 7-5.2 7-10V6Z" /><path d="m9 12 2 2 4-4" /></svg>
}

function connectionLabel(channel: ChannelProviderView): string {
  if (channel.connection.status === 'connected') return '已连接'
  if (channel.connection.status === 'session_expired') return '需重新连接'
  return '未连接'
}

function memberSummary(members: readonly AgentProfile[], bots: readonly ChannelMemberBotView[]): string {
  const visibleMemberIds = new Set(members.map((member) => member.agentId))
  const published = bots.filter((bot) => visibleMemberIds.has(bot.agentId) && bot.publicationStatus === 'published').length
  return `${published} 已发布 · ${members.length - published} 未发布`
}

function publicationLabel(status: ChannelMemberBotView['publicationStatus'] | 'unpublished'): string {
  switch (status) {
    case 'provisioning': return '发布中'
    case 'published': return '已发布'
    case 'failed': return '需处理'
    case 'disabled': return '已停用'
    default: return '未发布'
  }
}

function provisioningLabel(
  stage: MemberBotProvisioningView['stage'],
  recoveringFrozenApp = false
): string {
  switch (stage) {
    case 'verifying_session': return '正在校验发布账号…'
    case 'creating_app': return recoveringFrozenApp ? '正在核对已绑定应用…' : '正在创建独立应用…'
    case 'activating_app': return '正在启用应用…'
    case 'configuring_permissions': return '正在配置权限和事件…'
    case 'waiting_configuration': return '正在等待配置生效…'
    case 'publishing_version': return '正在发布最终配置…'
    case 'verifying_configuration': return '正在核对在线配置…'
    case 'connecting_bot': return '正在建立 Bot 长连接…'
    case 'completed': return '发布完成'
    case 'unknown_remote_state': return '远端创建结果待核对'
    default: return '发布尚未完成'
  }
}

function firstGrapheme(value: string): string {
  return Array.from(value.trim())[0] ?? '飞'
}

function formatLocalTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function assertChannelSettingsSnapshot(value: ChannelSettingsSnapshot): ChannelSettingsSnapshot {
  if (
    value.schemaVersion !== 4
    || !Array.isArray(value.channels)
    || !Number.isInteger(value.pendingBindingCount)
    || !Number.isInteger(value.bindingIssueCount)
  ) throw new Error('渠道状态数据版本不兼容。')
  return value
}

export function channelErrorMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    .trim()
  if (message === 'feishu_console_remote_app_unavailable') {
    return '原飞书应用已删除或当前账号无权访问，无法按原 App ID 重试。'
  }
  if (message === 'feishu_connection_error') {
    return '飞书连接异常，请稍后重试。'
  }
  const provisioningFailures: Record<string, string> = {
    feishu_console_event_verification_failed:
      '飞书事件与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_update_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_callback_verification_failed:
      '飞书回调与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_version_not_published:
      '飞书应用版本尚未确认发布；原应用已保留，可以稍后继续核对。'
  }
  if (provisioningFailures[message]) return provisioningFailures[message]
  if (/^feishu_console_/u.test(message)) {
    return '飞书开放平台操作尚未完成；请查看下方状态，排除问题后重试。'
  }
  return message || '渠道操作失败。'
}
