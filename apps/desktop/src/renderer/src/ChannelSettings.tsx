import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  ChannelMemberBotView,
  ChannelProviderView,
  ChannelSettingsSnapshot,
  ProjectBindingView
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
  const [manageAgentId, setManageAgentId] = useState<string | null>(null)
  const [editingBinding, setEditingBinding] = useState<ProjectBindingView | null>(null)

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
  ): Promise<void> => {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      setSnapshot(assertChannelSettingsSnapshot(await action()))
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
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
        onPublish={(_, agent) => void run(
          `publish:${agent.agentId}`,
          () => window.rovai.channels.publishMemberBot(agent.agentId)
        )}
        onRetryPublish={(_, agent) => void run(
          `retry:${agent.agentId}`,
          () => window.rovai.channels.retryMemberBot(agent.agentId)
        )}
        onManage={(_, agent) => setManageAgentId(agent.agentId)}
        onCreateBinding={(displayName, bindingKind, canonicalPath) => void run(
          'create-binding',
          () => window.rovai.channels.createProjectBinding({
            commandId: crypto.randomUUID(),
            displayName,
            bindingKind,
            canonicalPath
          })
        )}
        onEditBinding={setEditingBinding}
        onArchiveBinding={(binding) => void run(
          `archive:${binding.projectBindingId}`,
          () => window.rovai.channels.archiveProjectBinding({
            commandId: crypto.randomUUID(),
            projectBindingId: binding.projectBindingId,
            expectedVersion: binding.version
          })
        )}
        onBindConversation={(channelConversationId, projectBindingId, version) => void run(
          `bind:${channelConversationId}`,
          () => window.rovai.channels.bindConversation({
            commandId: crypto.randomUUID(),
            channelConversationId,
            projectBindingId,
            expectedConversationVersion: version
          })
        )}
      />

      <QrDialog
        snapshot={snapshot}
        busy={busy !== null}
        onClose={(attemptId) => void cancelQrAttempt(attemptId)}
      />

      <ManageBotDialog
        agent={agents.find((candidate) => candidate.agentId === manageAgentId) ?? null}
        bot={channel?.memberBots.find((candidate) => candidate.agentId === manageAgentId) ?? null}
        busy={busy !== null}
        onClose={() => setManageAgentId(null)}
        onDisable={(agentId) => {
          void run(`disable:${agentId}`, () => window.rovai.channels.disableMemberBot(agentId))
            .then(() => setManageAgentId(null))
        }}
      />

      <RenameBindingDialog
        binding={editingBinding}
        busy={busy !== null}
        onClose={() => setEditingBinding(null)}
        onSave={(binding, displayName) => {
          void run(`rename:${binding.projectBindingId}`, () => window.rovai.channels.updateProjectBinding({
            commandId: crypto.randomUUID(),
            projectBindingId: binding.projectBindingId,
            displayName,
            expectedVersion: binding.version
          })).then(() => setEditingBinding(null))
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
  onPublish,
  onRetryPublish,
  onManage,
  onCreateBinding,
  onEditBinding,
  onArchiveBinding,
  onBindConversation
}: {
  agents: AgentProfile[]
  snapshot: ChannelSettingsSnapshot | null
  loading?: boolean
  busy?: string | null
  error?: string | null
  onRetry?(): void
  onConnect?(channel: ChannelProviderView): void
  onPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onRetryPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onManage?(channel: ChannelProviderView, agent: AgentProfile): void
  onCreateBinding?(displayName: string, bindingKind: 'quick_chat' | 'directory', path: string): void
  onEditBinding?(binding: ProjectBindingView): void
  onArchiveBinding?(binding: ProjectBindingView): void
  onBindConversation?(conversationId: string, projectBindingId: string, version: number): void
}): React.JSX.Element {
  const members = useMemo(() => visibleChannelMembers(agents), [agents])
  const channel = snapshot?.channels.find((candidate) => candidate.kind === 'feishu') ?? null

  return (
    <div className="channel-settings">
      <SettingsPageHeader
        eyebrow="Settings / Channels"
        title="渠道"
        description="由主人在本机连接渠道、登记项目，并逐一为队员发布独立 Bot。会话成员只负责发消息，不获得任何本地配置权限。"
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
            />
            <p className="channel-owner-note">
              <OwnerShieldIcon />
              <span>项目路径、绑定、切换和 Bot 发布只能由主人在 Rovai 本机完成。飞书消息作者仅作为上下文来源和回复目标。</span>
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
              onManage={onManage}
            />
          </section>

          <ProjectBindingSection
            bindings={snapshot.projectBindings}
            busy={busy}
            onCreate={onCreateBinding}
            onEdit={onEditBinding}
            onArchive={onArchiveBinding}
          />

          <ConversationBindingSection
            snapshot={snapshot}
            busy={busy}
            onBind={onBindConversation}
          />
        </div>
      )}
    </div>
  )
}

function ProjectBindingSection({
  bindings,
  busy,
  onCreate,
  onEdit,
  onArchive
}: {
  bindings: ProjectBindingView[]
  busy: string | null
  onCreate?: (displayName: string, bindingKind: 'quick_chat' | 'directory', path: string) => void
  onEdit?: (binding: ProjectBindingView) => void
  onArchive?: (binding: ProjectBindingView) => void
}): React.JSX.Element {
  const active = bindings.filter((binding) => binding.status === 'active')
  const hasQuickChat = active.some((binding) => binding.bindingKind === 'quick_chat')
  const [draft, setDraft] = useState<{ name: string; path: string } | null>(null)

  const chooseDirectory = async (): Promise<void> => {
    const path = await window.rovai.channels.selectProjectDirectory()
    if (!path) return
    setDraft({ name: projectName(path), path })
  }

  return (
    <section className="channel-settings-section" aria-labelledby="channel-project-bindings-heading">
      <ChannelSectionHeading
        id="channel-project-bindings-heading"
        title="项目目录"
        description="先把安全的项目名登记到 Core。飞书只会拿到不透明的 Project Binding ID，不会看到本机路径。"
        summary={`${active.length} 个可用项目`}
      />
      <div className="channel-project-toolbar">
        <button
          className="quiet-button compact"
          type="button"
          disabled={busy !== null || !onCreate || hasQuickChat}
          title={hasQuickChat ? 'Quick Chat 已登记' : undefined}
          onClick={() => onCreate?.('Quick Chat', 'quick_chat', '')}
        >
          {hasQuickChat ? 'Quick Chat 已添加' : '添加 Quick Chat'}
        </button>
        <button
          className="primary-button compact"
          type="button"
          disabled={busy !== null || !onCreate}
          onClick={() => void chooseDirectory()}
        >
          添加项目目录
        </button>
      </div>

      {active.length === 0 ? (
        <div className="channel-empty-row">还没有可绑定项目。添加后，未绑定的飞书会话会出现在下方。</div>
      ) : (
        <div className="channel-project-list">
          {active.map((binding) => (
            <div className="channel-project-row" key={binding.projectBindingId}>
              <span className="channel-project-glyph" aria-hidden="true">{binding.bindingKind === 'quick_chat' ? 'Q' : '⌁'}</span>
              <span className="channel-project-copy">
                <strong>{binding.displayName}</strong>
                <small>{binding.bindingKind === 'quick_chat' ? 'Rovai 托管目录' : binding.canonicalPath}</small>
              </span>
              <span className="channel-project-kind">{binding.bindingKind === 'quick_chat' ? 'Quick Chat' : 'Directory'}</span>
              <button className="channel-row-action" type="button" disabled={busy !== null || !onEdit} onClick={() => onEdit?.(binding)}>重命名</button>
              <button className="channel-row-action is-danger" type="button" disabled={busy !== null || !onArchive} onClick={() => onArchive?.(binding)}>归档</button>
            </div>
          ))}
        </div>
      )}

      <CreateBindingDialog
        draft={draft}
        busy={busy !== null}
        onClose={() => setDraft(null)}
        onCreate={(name, path) => {
          onCreate?.(name, 'directory', path)
          setDraft(null)
        }}
      />
    </section>
  )
}

function ConversationBindingSection({
  snapshot,
  busy,
  onBind
}: {
  snapshot: ChannelSettingsSnapshot
  busy: string | null
  onBind?: (conversationId: string, projectBindingId: string, version: number) => void
}): React.JSX.Element {
  const projects = snapshot.projectBindings.filter((binding) => binding.status === 'active')
  const [selections, setSelections] = useState<Record<string, string>>({})
  const total = snapshot.unboundConversations.length + snapshot.conversationBindings.length

  return (
    <section className="channel-settings-section" aria-labelledby="channel-conversations-heading">
      <ChannelSectionHeading
        id="channel-conversations-heading"
        title="会话绑定"
        description="未绑定消息不会创建 Camp、CampMessage、CampTurn 或 AgentRun。主人完成绑定后，发送者需要重新发送。"
        summary={`${snapshot.unboundConversations.length} 个待绑定 · ${snapshot.conversationBindings.length} 个已绑定`}
      />
      {total === 0 ? (
        <div className="channel-empty-row">收到第一条有效私聊或显式 @ 消息后，会话会显示在这里。</div>
      ) : (
        <div className="channel-conversation-list">
          {snapshot.unboundConversations.map((conversation) => {
            const selected = selections[conversation.channelConversationId] ?? projects[0]?.projectBindingId ?? ''
            return (
              <div className="channel-conversation-row is-unbound" key={conversation.channelConversationId}>
                <span className="channel-conversation-state" aria-hidden="true" />
                <span className="channel-project-copy">
                  <strong>{conversation.displayName}</strong>
                  <small>{conversationKindLabel(conversation.conversationKind)} · 最近由 {conversation.lastSenderDisplayName} 发起</small>
                </span>
                <span className="channel-binding-state">待绑定</span>
                <select
                  aria-label={`为 ${conversation.displayName} 选择项目`}
                  value={selected}
                  disabled={projects.length === 0 || busy !== null}
                  onChange={(event) => setSelections({
                    ...selections,
                    [conversation.channelConversationId]: event.target.value
                  })}
                >
                  {projects.length === 0 && <option value="">先添加项目</option>}
                  {projects.map((project) => <option value={project.projectBindingId} key={project.projectBindingId}>{project.displayName}</option>)}
                </select>
                <button
                  className="primary-button compact"
                  type="button"
                  disabled={!selected || busy !== null || !onBind}
                  onClick={() => onBind?.(conversation.channelConversationId, selected, conversation.version)}
                >
                  绑定
                </button>
              </div>
            )
          })}
          {snapshot.conversationBindings.map((conversation) => {
            const selected = selections[conversation.channelConversationId] ?? conversation.projectBindingId
            return (
              <div className="channel-conversation-row" key={conversation.channelConversationId}>
                <span className="channel-conversation-state is-bound" aria-hidden="true" />
                <span className="channel-project-copy">
                  <strong>{conversation.displayName}</strong>
                  <small>{conversationKindLabel(conversation.conversationKind)}{conversation.campId ? ' · Camp 已建立' : ' · 等待下一条消息建立 Camp'}</small>
                </span>
                <span className="channel-binding-state is-bound">已绑定</span>
                <select
                  aria-label={`切换 ${conversation.displayName} 的项目`}
                  value={selected}
                  disabled={projects.length === 0 || busy !== null}
                  onChange={(event) => setSelections({
                    ...selections,
                    [conversation.channelConversationId]: event.target.value
                  })}
                >
                  {projects.map((project) => <option value={project.projectBindingId} key={project.projectBindingId}>{project.displayName}</option>)}
                </select>
                <button
                  className="quiet-button compact"
                  type="button"
                  disabled={selected === conversation.projectBindingId || busy !== null || !onBind}
                  onClick={() => onBind?.(conversation.channelConversationId, selected, conversation.version)}
                >
                  切换
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
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
  onConnect
}: {
  channel: ChannelProviderView
  busy: string | null
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
        <span>{hostReady ? '企业自建应用 · WebSocket' : '渠道宿主尚未就绪'}</span>
      </div>
      {connected ? (
        <div className="channel-account-summary">
          <span className="channel-account-avatar" aria-hidden="true">{firstGrapheme(account.displayName)}</span>
          <span><strong>{account.displayName}</strong><small>{account.tenantName}</small></span>
        </div>
      ) : (
        <span className="channel-account-empty">{hostReady ? '还没有连接飞书账号' : '连接能力尚未开放'}</span>
      )}
      <span className={`channel-connection-status${connected ? ' is-connected' : ''}`}>
        {connected ? '已连接' : channel.connection.status === 'session_expired' ? '需重新连接' : '未连接'}
      </span>
      <button
        className="quiet-button compact"
        type="button"
        disabled={!hostReady || busy !== null || !onConnect}
        title={!hostReady ? '飞书渠道宿主尚未接入' : undefined}
        onClick={() => onConnect?.(channel)}
      >
        {busy === 'connect' ? '等待扫码…' : connected ? '切换连接' : hostReady ? '连接飞书' : '尚未开放'}
      </button>
    </div>
  )
}

function ChannelMemberBotTable({
  channel,
  members,
  busy,
  onPublish,
  onRetryPublish,
  onManage
}: {
  channel: ChannelProviderView
  members: AgentProfile[]
  busy: string | null
  onPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
  onRetryPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
  onManage?: (channel: ChannelProviderView, agent: AgentProfile) => void
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
          const provisioning = status === 'provisioning'
          const action = published ? onManage : failed ? onRetryPublish : onPublish
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
                  : <span>名称沿用队员；头像在飞书确认</span>}
              </div>
              <span className={`channel-publication-status is-${status}`} role="cell">
                {publicationLabel(status)}
              </span>
              <div className="channel-member-action" role="cell">
                <button
                  className="channel-row-action"
                  type="button"
                  disabled={!connected || busy !== null || provisioning || !action}
                  onClick={() => action?.(channel, agent)}
                >
                  {actionBusy || provisioning ? '处理中…' : published ? '管理' : failed ? '重试' : connected ? '发布' : '等待连接'}
                </button>
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
            title={attempt.purpose === 'connect' ? '连接飞书' : '发布队员 Bot'}
            description="扫码后请在飞书页面核对应用名称、权限与事件，再确认创建。"
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
            <small>{attempt.expiresAt ? `二维码有效期至 ${formatLocalTime(attempt.expiresAt)}` : '连接凭据只会保存到本机系统安全存储。'}</small>
          </AppDialogBody>
          <AppDialogFooter note="旧二维码在取消或刷新后不会覆盖当前状态。">
            <button className="quiet-button" type="button" onClick={() => onClose(attempt.attemptId)}>
              {attempt.stage === 'failed' ? '关闭' : '取消'}
            </button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ManageBotDialog({
  agent,
  bot,
  busy,
  onClose,
  onDisable
}: {
  agent: AgentProfile | null
  bot: ChannelMemberBotView | null
  busy: boolean
  onClose: () => void
  onDisable: (agentId: string) => void
}): React.JSX.Element {
  if (!agent || !bot) return <></>
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent tone="attention">
          <AppDialogHeader title={`管理 ${agent.displayName} Bot`} description="停用后会关闭该 Bot 的长连接并删除本机凭据；飞书中的应用需由主人自行决定是否保留。" icon="server" closeDisabled={busy} />
          <AppDialogBody>
            <div className="channel-dialog-fact"><span>飞书名称</span><strong>{bot.botDisplayName ?? agent.displayName}</strong></div>
            <div className="channel-dialog-fact"><span>状态</span><strong>{publicationLabel(bot.publicationStatus)}</strong></div>
          </AppDialogBody>
          <AppDialogFooter>
            <button className="quiet-button" type="button" disabled={busy} onClick={onClose}>取消</button>
            <button className="danger-button" type="button" disabled={busy} onClick={() => onDisable(agent.agentId)}>{busy ? '正在停用…' : '停用 Bot'}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateBindingDialog({
  draft,
  busy,
  onClose,
  onCreate
}: {
  draft: { name: string; path: string } | null
  busy: boolean
  onClose: () => void
  onCreate: (name: string, path: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  useEffect(() => setName(draft?.name ?? ''), [draft])
  if (!draft) return <></>
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent>
          <AppDialogHeader title="添加项目目录" description="这个名称会用于本机绑定选择；绝对路径不会发送到飞书。" icon="folder" closeDisabled={busy} />
          <AppDialogBody>
            <label className="channel-dialog-field"><span>项目名称</span><input data-dialog-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className="channel-dialog-path"><span>本机路径</span><code>{draft.path}</code></div>
          </AppDialogBody>
          <AppDialogFooter>
            <button className="quiet-button" type="button" disabled={busy} onClick={onClose}>取消</button>
            <button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => onCreate(name.trim(), draft.path)}>添加项目</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RenameBindingDialog({
  binding,
  busy,
  onClose,
  onSave
}: {
  binding: ProjectBindingView | null
  busy: boolean
  onClose: () => void
  onSave: (binding: ProjectBindingView, name: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  useEffect(() => setName(binding?.displayName ?? ''), [binding])
  if (!binding) return <></>
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent>
          <AppDialogHeader title="重命名项目" description="只修改安全显示名，不改变冻结到已有 Camp 的项目路径。" icon="pencil" closeDisabled={busy} />
          <AppDialogBody>
            <label className="channel-dialog-field"><span>项目名称</span><input data-dialog-autofocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          </AppDialogBody>
          <AppDialogFooter>
            <button className="quiet-button" type="button" disabled={busy} onClick={onClose}>取消</button>
            <button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => onSave(binding, name.trim())}>保存</button>
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

function conversationKindLabel(kind: 'p2p' | 'group' | 'topic'): string {
  if (kind === 'p2p') return '私聊'
  if (kind === 'topic') return '话题'
  return '群聊'
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '项目'
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
    value.schemaVersion !== 2
    || !Array.isArray(value.channels)
    || !Array.isArray(value.projectBindings)
    || !Array.isArray(value.unboundConversations)
    || !Array.isArray(value.conversationBindings)
  ) throw new Error('渠道状态数据版本不兼容。')
  return value
}

export function channelErrorMessage(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
    .trim()
  if (message === 'This canonical path already has a Project Binding') {
    return '这个项目已经登记，无需重复添加。'
  }
  return message || '渠道操作失败。'
}
