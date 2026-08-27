import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AgentProfile,
  ChannelMemberBotView,
  ChannelProviderView,
  ChannelSettingsSnapshot
} from '@contracts'
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

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.rovai.channels.get()
      setSnapshot(assertChannelSettingsSnapshot(next))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ChannelSettingsView
      agents={agents}
      snapshot={snapshot}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    />
  )
}

export function ChannelSettingsView({
  agents,
  snapshot,
  loading = false,
  error = null,
  onRetry = () => undefined,
  onConnect,
  onPublish,
  onManage
}: {
  agents: AgentProfile[]
  snapshot: ChannelSettingsSnapshot | null
  loading?: boolean
  error?: string | null
  onRetry?(): void
  onConnect?(channel: ChannelProviderView): void
  onPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onManage?(channel: ChannelProviderView, agent: AgentProfile): void
}): React.JSX.Element {
  const members = useMemo(() => visibleChannelMembers(agents), [agents])
  const channel = snapshot?.channels.find((candidate) => candidate.kind === 'feishu') ?? null

  return (
    <div className="channel-settings">
      <SettingsPageHeader
        eyebrow="Settings / Channels"
        title="渠道"
        description="由主人在本机连接渠道，并逐一为队员发布独立 Bot。绑定后的会话成员可以通过显式 @ 使用 Agent，但不获得项目配置权限。"
        aside={<span className="settings-page-note">本机配置</span>}
      />

      {loading && !snapshot && (
        <ChannelSettingsState label="正在读取渠道状态…" />
      )}

      {!loading && !snapshot && (
        <ChannelSettingsState
          label={error ?? '渠道状态暂时不可用。'}
          tone="error"
          action={<button className="quiet-button compact" type="button" onClick={onRetry}>重试</button>}
        />
      )}

      {snapshot && !channel && (
        <ChannelSettingsState
          label="当前版本没有可用的渠道。"
          tone="empty"
        />
      )}

      {channel && (
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
              description="一期仅接入飞书，连接与队员 Bot 状态均由本机宿主管理。"
              summary={`${snapshot?.channels.length ?? 0} 个渠道`}
            />
            <div className="channel-provider-strip" role="tablist" aria-label="渠道">
              <button
                className="channel-provider-tab"
                type="button"
                role="tab"
                aria-selected="true"
              >
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
              description="连接只决定后续 Bot 的发布目标；切换连接不会自动迁移已发布 Bot。"
            />
            <ChannelConnectionRow channel={channel} onConnect={onConnect} />
            <p className="channel-owner-note">
              <OwnerShieldIcon />
              <span>渠道连接、项目绑定与项目路径只能由主人在 Rovai 本机维护。消息作者只作为上下文来源和回复目标，不继承本地管理能力。</span>
            </p>
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-member-bots-heading">
            <ChannelSectionHeading
              id="channel-member-bots-heading"
              title="队员 Bot"
              description="每次只发布一名队员；名称与头像是该队员在飞书中的独立身份。"
              summary={memberSummary(members, channel.memberBots)}
            />
            <ChannelMemberBotTable
              channel={channel}
              members={members}
              onPublish={onPublish}
              onManage={onManage}
            />
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
    <div
      className={`channel-settings-state is-${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
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
  onConnect
}: {
  channel: ChannelProviderView
  onConnect?: (channel: ChannelProviderView) => void
}): React.JSX.Element {
  const account = channel.connection.account
  const connected = channel.connection.status === 'connected' && account !== null
  const hostReady = channel.hostStatus === 'ready'
  return (
    <div className="channel-connection-row">
      <ChannelMark />
      <div className="channel-connection-label">
        <strong>飞书开放平台</strong>
        <span>{hostReady ? '企业自建应用' : '渠道宿主尚未就绪'}</span>
      </div>
      {connected ? (
        <div className="channel-account-summary">
          <span className="channel-account-avatar" aria-hidden="true">
            {firstGrapheme(account.displayName)}
          </span>
          <span>
            <strong>{account.displayName}</strong>
            <small>{account.tenantName}</small>
          </span>
        </div>
      ) : (
        <span className="channel-account-empty">
          {hostReady ? '还没有连接飞书账号' : '连接能力尚未开放'}
        </span>
      )}
      <span className={`channel-connection-status${connected ? ' is-connected' : ''}`}>
        {connected
          ? '已连接'
          : channel.connection.status === 'session_expired'
            ? '需重新连接'
            : '未连接'}
      </span>
      <button
        className="quiet-button compact"
        type="button"
        disabled={!hostReady || !onConnect}
        title={!hostReady ? '飞书渠道宿主尚未接入' : undefined}
        onClick={() => onConnect?.(channel)}
      >
        {connected ? '切换连接' : hostReady ? '连接飞书' : '尚未开放'}
      </button>
    </div>
  )
}

function ChannelMemberBotTable({
  channel,
  members,
  onPublish,
  onManage
}: {
  channel: ChannelProviderView
  members: AgentProfile[]
  onPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
  onManage?: (channel: ChannelProviderView, agent: AgentProfile) => void
}): React.JSX.Element {
  const bots = new Map(channel.memberBots.map((bot) => [bot.agentId, bot]))
  const connected = channel.hostStatus === 'ready'
    && channel.connection.status === 'connected'
    && channel.connection.account !== null

  if (members.length === 0) {
    return (
      <div className="channel-member-bots-empty">
        <strong>还没有可发布的队员</strong>
        <span>先在队员页创建或恢复一名队员。</span>
      </div>
    )
  }

  return (
    <div className="channel-member-bot-table" role="table" aria-label="队员 Bot">
      <div className="channel-member-bot-grid channel-member-bot-head" role="row">
        <span role="columnheader">队员</span>
        <span role="columnheader">飞书身份</span>
        <span role="columnheader">状态</span>
        <span role="columnheader" aria-label="操作" />
      </div>
      <div role="rowgroup">
        {members.map((agent) => {
          const bot = bots.get(agent.agentId)
          const published = bot?.publicationStatus === 'published'
          const action = published ? onManage : onPublish
          return (
            <div className="channel-member-bot-grid channel-member-bot-row" role="row" key={agent.agentId}>
              <div className="channel-member-identity" role="cell">
                <MemberAvatar
                  agentId={agent.agentId}
                  avatarRef={agent.avatarRef}
                  displayName={agent.displayName}
                  size="workspace"
                  decorative
                />
                <span>
                  <strong>{agent.displayName}</strong>
                  <small>{agent.teamRole || '未设置队内职责'}</small>
                </span>
              </div>
              <div className="channel-bot-identity" role="cell">
                {published ? (
                  <>
                    <strong>{bot.botDisplayName ?? agent.displayName}</strong>
                    <small>独立 Bot 身份</small>
                  </>
                ) : (
                  <span>默认沿用队员名称与头像</span>
                )}
              </div>
              <span
                className={`channel-publication-status${published ? ' is-published' : ''}`}
                role="cell"
              >
                {published ? '已发布' : '未发布'}
              </span>
              <div className="channel-member-action" role="cell">
                <button
                  className="channel-row-action"
                  type="button"
                  disabled={!connected || !action}
                  onClick={() => action?.(channel, agent)}
                >
                  {published ? '管理' : connected ? '发布' : '等待连接'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChannelMark(): React.JSX.Element {
  return <span className="channel-mark channel-mark-feishu" aria-hidden="true">飞</span>
}

function OwnerShieldIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.8 2.8 8.3 7 10 4.2-1.7 7-5.2 7-10V6Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function connectionLabel(channel: ChannelProviderView): string {
  if (channel.connection.status === 'connected') return '已连接'
  if (channel.connection.status === 'session_expired') return '需重新连接'
  return '未连接'
}

function memberSummary(
  members: readonly AgentProfile[],
  bots: readonly ChannelMemberBotView[]
): string {
  const visibleMemberIds = new Set(members.map((member) => member.agentId))
  const published = bots.filter((bot) =>
    visibleMemberIds.has(bot.agentId) && bot.publicationStatus === 'published'
  ).length
  return `${published} 已发布 · ${members.length - published} 未发布`
}

function firstGrapheme(value: string): string {
  return Array.from(value.trim())[0] ?? '飞'
}

function assertChannelSettingsSnapshot(value: ChannelSettingsSnapshot): ChannelSettingsSnapshot {
  if (value.schemaVersion !== 1 || !Array.isArray(value.channels)) {
    throw new Error('渠道状态数据版本不兼容。')
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '渠道状态读取失败。'
}
