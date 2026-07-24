import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterInstallation,
  AgentProfile,
  Approval,
  CampSnapshot,
  HealthStatus,
  TimelineEvent
} from '@contracts'
import { allNavigationCamps } from './App'
import { CampNavigation } from './CampNavigation'
import {
  mentionQueryAtCaret,
  resolveMentionedAgentIds
} from './AgentMentionTextarea'
import { CampWorkspace, NewConversationWorkspace, TaskPanel, readyCampMentionCandidates } from './CampWorkspace'
import { MemberRuntimeForm, MembersView, RuntimeInstallationsPanel, recommendedPermissionValues } from './MemberManagement'
import {
  agentRunPresentation,
  agentRunWaitDetail,
  buildActivities,
  buildConversation,
  buildGitStatusEntries,
  diffLineKind,
  formatByteSize,
  inboxMessagePresentation,
  parseGitStatus,
  stripAnsi,
  summarizeApproval,
  taskStateSummary
} from './ui-model'

function event(id: number, eventType: string, payload: unknown, nativeMethod: string | null = null): TimelineEvent {
  return {
    id,
    taskId: 'task-1',
    sequence: id,
    eventType,
    nativeMethod,
    payload,
    createdAt: `2026-07-17T10:00:0${id}Z`
  }
}

describe('task event projections', () => {
  it('opens a lobby composer directly without a confirmation dialog', () => {
    const markup = renderToStaticMarkup(createElement(NewConversationWorkspace, {
      project: null,
      preflight: {
        admissible: true,
        readyMembers: [{ agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', memberOrder: 0 }],
        blockers: []
      },
      busy: false,
      onOpenMembers: () => undefined,
      onSend: async () => undefined
    }))

    expect(markup).toContain('aria-label="新对话草稿"')
    expect(markup).toContain('id="new-camp-message"')
    expect(markup).toContain('发送第一条消息后保存对话')
    expect(markup).toContain('和 洛可 开始一段对话')
    expect(markup).toContain('大厅不会读取任何项目文件')
    expect(markup).toContain('输入 @ 选择其他就绪成员')
    expect(markup).toContain('aria-autocomplete="list"')
    expect(markup).not.toContain('闲聊与测试')
    expect(markup).not.toContain('选择项目')
    expect(markup).not.toContain('INTAKE BOUNDARY')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('对话标题')
  })

  it('keeps the lobby visible while member Runtime configuration is required', () => {
    const markup = renderToStaticMarkup(createElement(NewConversationWorkspace, {
      project: null,
      preflight: {
        admissible: false,
        readyMembers: [],
        blockers: [{ code: 'no_runtime_ready_members', detail: '至少需要一位 Runtime Ready 的活跃成员。' }]
      },
      busy: false,
      onOpenMembers: () => undefined,
      onSend: async () => undefined
    }))

    expect(markup).toContain('先让一位队友就绪')
    expect(markup).toContain('还没有可用的队友')
    expect(markup).toContain('配置成员')
    expect(markup).toContain('disabled=""')
  })

  it('resolves exact ready-member mentions without treating email text as routing', () => {
    const candidates = [
      { agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可' },
      { agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦' }
    ]

    expect(resolveMentionedAgentIds('@muwa 请实现，@luoke 请复核；再次 @muwa', candidates)).toEqual([
      'agent-muwa',
      'agent-luoke'
    ])
    expect(resolveMentionedAgentIds('发送到 dev@muwa.example.com', candidates)).toEqual([])
    expect(mentionQueryAtCaret('请 @沐', 4)).toEqual({ start: 2, end: 4, query: '沐' })
  })

  it('offers only active Camp members whose Runtime is ready', () => {
    const ready = {
      ...agentProfile(),
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const unready = {
      ...agentProfile(),
      id: 'agent-luoke',
      handle: 'luoke',
      displayName: '洛可'
    }
    const members: CampSnapshot['members'] = [
      {
        agentProfileId: ready.id, handle: ready.handle, displayName: ready.displayName,
        roleTitle: '开发者', accent: '#39777a', membershipStatus: 'active', profileStatus: 'active',
        memberOrder: 0, isDefaultLead: false
      },
      {
        agentProfileId: unready.id, handle: unready.handle, displayName: unready.displayName,
        roleTitle: 'Lead', accent: '#D56A4A', membershipStatus: 'active', profileStatus: 'active',
        memberOrder: 1, isDefaultLead: true
      }
    ]

    expect(readyCampMentionCandidates(members, [ready, unready])).toEqual([
      { agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦' }
    ])
  })

  it('orders Camp navigation by the authoritative activity sequence', () => {
    const baseCamp = {
      title: '对话', projectPath: '/repo', repositoryScopeId: null,
      repositoryGitCommonDir: null, repositoryObjectFormat: null,
      defaultLead: null, marker: 'none' as const, lastActivityAt: '2026-07-22T00:00:00Z',
      latestCompletionGlobalSequence: 0, version: 1
    }
    const camps = allNavigationCamps({
      schemaVersion: 1,
      throughGlobalSequence: 20,
      lobby: {
        totalCount: 1,
        recentCamps: [{ ...baseCamp, id: 'older', lastActivityGlobalSequence: 9 }]
      },
      projects: [{
        repositoryScopeId: 'repo-1', name: 'lumen', projectPath: '/repo',
        gitCommonDir: '/repo/.git', objectFormat: 'sha1',
        lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 10,
        totalCount: 1,
        recentCamps: [{
          ...baseCamp, id: 'newer', repositoryScopeId: 'repo-1',
          repositoryGitCommonDir: '/repo/.git', repositoryObjectFormat: 'sha1',
          lastActivityGlobalSequence: 10
        }]
      }]
    })
    expect(camps.map((camp) => camp.id)).toEqual(['newer', 'older'])
  })

  it('renders Camp-first navigation without legacy Project, Task, or diagnostics entries', () => {
    const longTitle = '围绕多 Agent 协作控制面梳理一个足够长、必须由真实侧栏宽度裁切的对话标题'
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'camp',
      state: 'ready',
      navigation: {
        schemaVersion: 1,
        throughGlobalSequence: 12,
        lobby: {
          totalCount: 1,
          recentCamps: [{
            id: 'camp-lobby', title: '大厅讨论', projectPath: '/lobby',
            repositoryScopeId: null, repositoryGitCommonDir: null,
            repositoryObjectFormat: null, defaultLead: null, marker: 'none',
            lastActivityAt: '2026-07-22T00:00:00Z', lastActivityGlobalSequence: 10,
            latestCompletionGlobalSequence: 0, version: 1
          }]
        },
        projects: [{
          repositoryScopeId: 'repository-1', name: 'lumen-ai', projectPath: '/repo',
          gitCommonDir: '/repo/.git', objectFormat: 'sha1',
          lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 12,
          totalCount: 1,
          recentCamps: [{
            id: 'camp-project', title: longTitle, projectPath: '/repo',
            repositoryScopeId: 'repository-1', repositoryGitCommonDir: '/repo/.git',
            repositoryObjectFormat: 'sha1', defaultLead: null, marker: 'unread_completed',
            lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 12,
            latestCompletionGlobalSequence: 12, version: 2
          }]
        }]
      },
      activeCampId: 'camp-project',
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('新对话')
    expect(markup).toContain('成员')
    expect(markup).toContain('大厅讨论')
    expect(markup).toContain('lumen-ai')
    expect(markup).toContain(longTitle)
    expect(markup).toContain('管理')
    expect(markup).toContain('设置')
    expect(markup).toContain('viewBox="0 0 12 12"')
    expect(markup).not.toContain('⌄')
    expect(markup).not.toContain('最近任务')
    expect(markup).not.toContain('>诊断<')
  })

  it('keeps an unready Default Lead selectable while warning that execution is blocked', () => {
    const profile = agentProfile()
    const unreadyProfile: AgentProfile = {
      ...profile,
      id: 'agent-luoke',
      displayName: '洛可',
      runtimePreference: null,
      runtimeReadiness: { status: 'runtime_not_configured', blockers: [] }
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 6,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-1', title: 'Lead 调整', projectPath: '/lobby', repositoryScopeId: null,
        repositoryObjectFormat: null, defaultLeadAgentId: 'agent-luoke', status: 'active',
        version: 2, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z'
      },
      members: [{
        agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', roleTitle: 'Lead',
        accent: '#D56A4A', membershipStatus: 'active', profileStatus: 'active', memberOrder: 0,
        isDefaultLead: true
      }],
      tasks: [], messages: [], turns: [], agentRuns: [], inboxMessages: [],
      contextManifests: [], contextCompactions: [], approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [unreadyProfile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined
    }))

    expect(markup).toContain('调整 Default Lead')
    expect(markup).toContain('Runtime 未就绪')
    expect(markup).toContain('默认执行会被 Core 阻止')
  })

  it('renders lightweight Task records as editable long-lived responsibilities', () => {
    const snapshot: CampSnapshot = {
      schemaVersion: 6,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-task', title: 'Task 管理', projectPath: '/lobby', repositoryScopeId: null,
        repositoryObjectFormat: null, defaultLeadAgentId: 'agent-muwa', status: 'active',
        version: 1, createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z'
      },
      members: [{
        agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', roleTitle: '开发者',
        accent: '#39777a', membershipStatus: 'active', profileStatus: 'active', memberOrder: 0,
        isDefaultLead: true
      }],
      tasks: [{
        id: 'task-1', title: '实现 Task 工具', description: '跨消息持续跟踪，不自动唤醒负责人。',
        status: 'pending', assigneeAgentId: 'agent-muwa', createdByType: 'user',
        createdById: 'local-user', sourceAgentRunId: null, version: 1,
        createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z',
        closedAt: null, availableActions: ['update']
      }],
      messages: [], turns: [], agentRuns: [], inboxMessages: [], contextManifests: [],
      contextCompactions: [], approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(TaskPanel, {
      snapshot,
      busy: false,
      onTasksChanged: async () => undefined
    }))

    expect(markup).toContain('长期事项')
    expect(markup).toContain('＋ 新建')
    expect(markup).toContain('实现 Task 工具')
    expect(markup).toContain('跨消息持续跟踪，不自动唤醒负责人。')
    expect(markup).toContain('沐瓦')
    expect(markup).not.toContain('acceptanceCriteria')
  })

  it('coalesces streamed agent text by item', () => {
    const conversation = buildConversation([
      event(1, 'user.message', { text: '修复设置页' }),
      event(2, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '我先' }),
      event(3, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '检查。' })
    ])

    expect(conversation).toHaveLength(2)
    expect(conversation[1]?.text).toBe('我先检查。')
  })

  it('explains context blockers and A2A delivery without relying on color', () => {
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'context_compaction' })).toEqual({
      label: '压缩上下文',
      tone: 'attention'
    })
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'delivery_unknown' })).toEqual({
      label: '投递待确认',
      tone: 'danger'
    })
    expect(agentRunWaitDetail('context_overloaded')).toContain('没有静默裁剪')
    expect(inboxMessagePresentation({ deliveredAt: '2026-07-23T00:00:00Z', failedAt: null }, 'queued')).toEqual({
      label: '已排队',
      tone: 'neutral'
    })
    expect(formatByteSize(4_096)).toBe('4.0 KB')
  })

  it('coalesces command output without hiding file activity', () => {
    const activities = buildActivities([
      event(1, 'command.output.delta', { itemId: 'command-1', delta: 'pass ' }),
      event(2, 'command.output.delta', { itemId: 'command-1', delta: '12 tests' }),
      event(3, 'file.change.updated', { itemId: 'patch-1' })
    ])

    expect(activities).toHaveLength(2)
    expect(activities[0]?.detail).toBe('pass 12 tests')
    expect(activities[1]?.kind).toBe('file')
  })

  it('projects a command lifecycle as one atomic activity', () => {
    const activities = buildActivities([
      event(1, 'activity.started', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pnpm test',
          cwd: '/repo',
          status: 'inProgress'
        }
      }),
      event(2, 'command.output.delta', { itemId: 'command-1', delta: 'running tests…\n' }),
      event(3, 'activity.completed', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pnpm test',
          cwd: '/repo',
          status: 'completed',
          durationMs: 1234,
          exitCode: 0,
          aggregatedOutput: 'pass 12 tests'
        }
      })
    ])

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      kind: 'command',
      status: 'completed',
      command: 'pnpm test',
      cwd: '/repo',
      durationMs: 1234,
      exitCode: 0,
      detail: 'pass 12 tests'
    })
  })

  it('removes terminal color control sequences from visible output', () => {
    const activities = buildActivities([
      event(1, 'command.output.delta', {
        itemId: 'command-1',
        delta: '\u001b[31mfailed\u001b[0m\n'
      }),
      event(2, 'activity.completed', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          status: 'completed',
          exitCode: 1,
          aggregatedOutput: '\u001b[31mfailed\u001b[0m'
        }
      })
    ])

    expect(stripAnsi('\u001b[32mpass\u001b[0m')).toBe('pass')
    expect(activities[0]).toMatchObject({ status: 'failed', detail: 'failed', exitCode: 1 })
  })

  it('surfaces recovery boundaries in the conversation', () => {
    const conversation = buildConversation([
      event(1, 'runtime.state', { status: 'recovering' }, 'application/restarted'),
      event(2, 'runtime.state', { sessionGeneration: 2 }, 'session/generation-changed')
    ])

    expect(conversation.map((item) => item.kind)).toEqual(['system', 'system'])
    expect(conversation[1]?.text).toContain('Session Generation')
  })

  it('classifies diff lines without treating file headers as changes', () => {
    expect(diffLineKind('--- a/file.ts')).toBe('metadata')
    expect(diffLineKind('+++ b/file.ts')).toBe('metadata')
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk')
    expect(diffLineKind('-old')).toBe('deletion')
    expect(diffLineKind('+new')).toBe('addition')
    expect(diffLineKind(' unchanged')).toBe('context')
  })

  it('turns git porcelain rows into visible status semantics', () => {
    expect(parseGitStatus(' M src/App.tsx')).toEqual({
      code: 'M',
      label: '修改',
      path: 'src/App.tsx',
      kind: 'change'
    })
    expect(parseGitStatus('?? docs/notes.md')).toMatchObject({ label: '未跟踪', kind: 'addition' })
  })

  it('keeps baseline files visible after the working tree becomes clean', () => {
    const entries = buildGitStatusEntries([], [
      'diff --git a/src/App.tsx b/src/App.tsx',
      'index 123..456 100644',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts'
    ].join('\n'))

    expect(entries).toEqual([
      { code: 'Δ', label: '修改', path: 'src/App.tsx', kind: 'change' },
      { code: 'A', label: '新增', path: 'src/new.ts', kind: 'addition' }
    ])
  })

  it('explains approval scope and each decision consequence', () => {
    const approval: Approval = {
      id: 'approval-1',
      taskId: 'task-1',
      nativeRequestId: 'native-1',
      approvalType: 'execCommandApproval',
      reason: '需要运行现有测试验证变更。',
      request: { command: 'pnpm test', cwd: '/repo' },
      status: 'pending',
      decision: null,
      requestedAt: '2026-07-17T10:00:00Z',
      resolvedAt: null
    }

    const summary = summarizeApproval(approval)
    expect(summary.capability).toBe('执行终端命令')
    expect(summary.scope).toContain('pnpm test')
    expect(summary.scope).toContain('/repo')
    expect(summary.blockingImpact).toContain('Turn 已暂停')
    expect(summary.allowOnceEffect).not.toBe(summary.allowSessionEffect)
    expect(summary.declineEffect).not.toBe(summary.cancelEffect)
  })

  it('describes lobby state without implying project access', () => {
    const summary = taskStateSummary('preparing', 0, undefined, 'lobby')
    expect(summary).toContain('大厅上下文')
    expect(summary).toContain('不会读取用户项目')
  })

  it('keeps queued Task state distinct from an already running AgentRun', () => {
    expect(taskStateSummary('pending', 0)).toContain('等待 Scheduler')
    expect(taskStateSummary('in_progress', 0)).toContain('已经开始执行')
  })

  it('keeps member selection and Runtime binding explicit', () => {
    const markup = renderToStaticMarkup(createElement(MembersView, {
      agents: [agentProfile()],
      installations: [codexInstallation()],
      runtimeCandidates: [],
      runtimeDiscoveryPending: false,
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('选择一位成员')
    expect(markup).toContain('不会替新成员绑定 Runtime')
    expect(markup).toContain('@muwa')
    expect(markup).toContain('var(--identity-')
    expect(markup).not.toContain('身份强调色')
    expect(markup).not.toContain('保存运行配置')
  })

  it('offers a discovered CLI directly from the member Runtime selector', () => {
    const candidate = codexRuntimeCandidate()
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: agentProfile(),
      installations: [],
      runtimeCandidates: [candidate],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onRegister: async () => codexInstallation(),
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('本机已检测到 · 选择后纳入 Lumen')
    expect(markup).toContain('Codex CLI · codex-cli 0.144.6')
    expect(markup).toContain('/opt/homebrew/bin/codex')
    expect(markup).toContain('确认配置后仍需保存')
  })

  it('links to Runtime settings when no installation or CLI candidate exists', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: agentProfile(),
      installations: [],
      runtimeCandidates: [],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onRegister: async () => codexInstallation(),
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('没有发现可选择的本机 Runtime')
    expect(markup).toContain('前往设置')
  })

  it('does not report an empty Runtime catalog while discovery is still running', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: agentProfile(),
      installations: [],
      runtimeCandidates: [],
      runtimeDiscoveryPending: true,
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onRegister: async () => codexInstallation(),
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('正在检测本机 Runtime')
    expect(markup).not.toContain('没有发现可选择的本机 Runtime')
  })

  it('uses Adapter-reported recommended permissions as visible draft values', () => {
    expect(recommendedPermissionValues(codexInstallation())).toEqual({
      sandbox_mode: 'workspace-write',
      approval_policy: 'on-request'
    })
  })

  it('surfaces every discovered CLI without silently registering it', () => {
    const health: HealthStatus = {
      core: { ok: true, version: '0.0.1', dataDir: '/tmp/lumen' },
      database: { ok: true, path: '/tmp/lumen/lumen.db' },
      git: { installed: true, version: 'git version 2.0' },
      codex: {
        runtimeKind: 'codex-cli', executablePath: '/opt/homebrew/bin/codex',
        reportedVersion: 'codex-cli 0.144.6', executableFingerprint: 'sha256:test',
        status: 'ready', capabilities: ['model.list'], missingCapabilities: [],
        detail: null, probedAt: '2026-07-22T00:00:00Z'
      },
      runtimeCandidates: [
        {
          runtimeKind: 'codex-cli', executablePath: '/opt/homebrew/bin/codex',
          reportedVersion: 'codex-cli 0.144.6', executableFingerprint: 'sha256:codex',
          status: 'ready', capabilities: ['model.list'], missingCapabilities: [],
          detail: null, probedAt: '2026-07-22T00:00:00Z'
        },
        {
          runtimeKind: 'opencode-cli', executablePath: '/opt/homebrew/bin/opencode',
          reportedVersion: '1.18.0', executableFingerprint: 'sha256:opencode',
          status: 'ready', capabilities: ['acp.initialize'], missingCapabilities: [],
          detail: null, probedAt: '2026-07-22T00:00:00Z'
        },
        {
          runtimeKind: 'copilot-cli', executablePath: '/opt/homebrew/bin/copilot',
          reportedVersion: '1.0.73', executableFingerprint: 'sha256:copilot',
          status: 'ready', capabilities: ['acp.initialize'], missingCapabilities: [],
          detail: null, probedAt: '2026-07-22T00:00:00Z'
        },
        {
          runtimeKind: 'claude-code-cli', executablePath: '/opt/homebrew/bin/claude',
          reportedVersion: '2.1.206 (Claude Code)', executableFingerprint: 'sha256:claude',
          status: 'ready', capabilities: ['cli.print', 'conversation.resume'], missingCapabilities: [],
          detail: null, probedAt: '2026-07-23T00:00:00Z'
        },
        {
          runtimeKind: 'antigravity-app', executablePath: '/Users/test/.local/bin/agy',
          reportedVersion: '1.1.5', executableFingerprint: 'sha256:agy',
          status: 'ready', capabilities: ['cli.print'], missingCapabilities: [],
          detail: null, probedAt: '2026-07-22T00:00:00Z'
        }
      ]
    }
    const markup = renderToStaticMarkup(createElement(RuntimeInstallationsPanel, {
      health,
      installations: [],
      onReload: async () => undefined
    }))

    expect(markup).toContain('检测到 Codex CLI')
    expect(markup).toContain('检测到 OpenCode CLI')
    expect(markup).toContain('检测到 GitHub Copilot CLI')
    expect(markup).toContain('检测到 Claude Code CLI')
    expect(markup).toContain('检测到 Antigravity App')
    expect(markup).toContain('experimental')
    expect(markup).toContain('纳入 Lumen')
    expect(markup).toContain('/opt/homebrew/bin/codex')
    expect(markup).toContain('/opt/homebrew/bin/opencode')
    expect(markup).toContain('/opt/homebrew/bin/copilot')
    expect(markup).toContain('/opt/homebrew/bin/claude')
    expect(markup).toContain('/Users/test/.local/bin/agy')
  })
})

function agentProfile(): AgentProfile {
  return {
    id: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', avatarRef: null,
    personaLabel: '海狸', accent: '#39777a', roleTitle: '开发者',
    roleDescription: '负责实现和验证。', instructions: '遵循项目规范。',
    defaultCapabilities: [], status: 'active', runtimePreference: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [{ code: 'runtime_not_configured', detail: null }] },
    memberOrder: 0, version: 1, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z', archivedAt: null
  }
}

function codexInstallation(): AdapterInstallation {
  return {
    id: 'installation-codex', adapterKind: 'codex-cli', executablePath: '/opt/homebrew/bin/codex',
    source: 'discovered', authScope: 'default', enabled: true, version: 1,
    referencedProfileCount: 0, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z',
    snapshot: {
      reportedVersion: 'codex-cli 0.144.6', executableFingerprint: 'sha256:test',
      authenticationStatus: 'authenticated', probeStatus: 'ready', permissionSchemaVersion: 1,
      capabilities: ['model.list'], protocols: ['codex-app-server-v2'], models: [],
      permissionOptions: [{
        key: 'sandbox_mode', label: 'sandbox_mode', description: 'Filesystem sandbox.', valueType: 'enum',
        choices: [{ value: 'workspace-write', label: 'workspace-write' }], recommendedValue: 'workspace-write',
        scope: 'session', risk: 'elevated', supported: true, required: true, unsupportedReason: null
      }, {
        key: 'approval_policy', label: 'approval_policy', description: 'Approval policy.', valueType: 'enum',
        choices: [{ value: 'on-request', label: 'on-request' }], recommendedValue: 'on-request',
        scope: 'session', risk: 'elevated', supported: true, required: true, unsupportedReason: null
      }],
      observedAt: '2026-07-22T00:00:00Z', lastAttemptedAt: '2026-07-22T00:00:00Z',
      staleAt: null, lastError: null
    }
  }
}

function codexRuntimeCandidate(): HealthStatus['runtimeCandidates'][number] {
  return {
    runtimeKind: 'codex-cli', executablePath: '/opt/homebrew/bin/codex',
    reportedVersion: 'codex-cli 0.144.6', executableFingerprint: 'sha256:test',
    status: 'ready', capabilities: ['model.list'], missingCapabilities: [],
    detail: null, probedAt: '2026-07-22T00:00:00Z'
  }
}
