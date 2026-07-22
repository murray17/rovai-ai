import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterInstallation,
  AgentProfile,
  Approval,
  CampSnapshot,
  HealthStatus,
  StartPreflightResult,
  TimelineEvent
} from '@contracts'
import { allNavigationCamps, CampTeamPanel, PreflightNotice } from './App'
import { NewConversationWorkspace } from './CampWorkspace'
import { MembersView, RuntimeInstallationsPanel, recommendedPermissionValues } from './MemberManagement'
import {
  buildActivities,
  buildConversation,
  buildGitStatusEntries,
  diffLineKind,
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
  it('renders Agent lanes from one Camp snapshot and surfaces unknown effects', () => {
    const snapshot: CampSnapshot = {
      schemaVersion: 1,
      throughGlobalSequence: 42,
      camp: {
        id: 'camp-1', title: '架构审查', projectPath: '/repo', repositoryScopeId: null,
        repositoryObjectFormat: null, defaultLeadAgentId: 'agent-luoke',
        status: 'active', version: 1, createdAt: '2026-07-20T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z'
      },
      members: [{
        agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可',
        roleTitle: '架构师', accent: '#D56A4A', membershipStatus: 'active',
        profileStatus: 'active', memberOrder: 0, isDefaultLead: true
      }],
      tasks: [], messages: [{
        id: 'message-1', sequence: 1, authorType: 'agent', authorId: 'agent-luoke',
        sourceAgentRunId: 'run-1', body: '架构审查完成。', addressMode: 'broadcast',
        addressedAgentProfileIds: ['agent-luoke'], replyToCampMessageId: null,
        campTurnId: 'turn-1', createdAt: '2026-07-20T00:00:03Z'
      }], turns: [], approvals: [{
        id: 'approval-1', actionId: 'action-2', actionKind: 'shell_command',
        actionSummary: 'Run cargo test outside the current sandbox', status: 'pending',
        canonicalInput: { kind: 'shell_command', argv: ['/bin/zsh', '-lc', 'cargo test'], cwd: '/repo' },
        requestedForUserId: 'local-user', version: 1,
        requestedAt: '2026-07-20T00:00:01Z', resolvedAt: null
      }], timeline: [],
      agentRuns: [{
        id: 'run-1', campTurnId: 'turn-1', conversationId: 'conversation-1',
        agentProfileId: 'agent-luoke', taskId: null, responsibilityKey: 'respond/agent-luoke',
        responsibilityGeneration: 0, purpose: '拆分职责', expectedOutput: 'Task DAG',
        completionRole: 'required', status: 'waiting', waitReason: 'unknown_action_outcome',
        executionEpoch: 2, workspace: null, version: 3,
        createdAt: '2026-07-20T00:00:00Z', startedAt: '2026-07-20T00:00:01Z',
        endedAt: null, updatedAt: '2026-07-20T00:00:02Z'
      }],
      actions: [{
        id: 'action-1', agentRunId: 'run-1', actionKind: 'shell_command',
        actionSummary: 'Run tests', controlMode: 'mediated', policyDecision: 'allow',
        status: 'unknown', actionDigest: 'digest', effectDisposition: 'unknown',
        notExecutedReason: null, version: 4, createdAt: '2026-07-20T00:00:01Z',
        updatedAt: '2026-07-20T00:00:02Z'
      }, {
        id: 'action-2', agentRunId: 'run-1', actionKind: 'shell_command',
        actionSummary: 'Run cargo test outside the current sandbox', controlMode: 'intercepted',
        policyDecision: 'ask', status: 'prepared', actionDigest: 'approval-digest',
        effectDisposition: null, notExecutedReason: null, version: 1,
        createdAt: '2026-07-20T00:00:01Z', updatedAt: '2026-07-20T00:00:01Z'
      }]
    }
    const markup = renderToStaticMarkup(createElement(CampTeamPanel, { snapshot }))
    expect(markup).toContain('洛可')
    expect(markup).toContain('Default Lead')
    expect(markup).toContain('unknown_action_outcome')
    expect(markup).toContain('存在结果未知的副作用')
    expect(markup).toContain('一致快照 #42')
    expect(markup).toContain('公共讨论')
    expect(markup).toContain('架构审查完成。')
    expect(markup).toContain('AgentRun 输出')
    expect(markup).toContain('等待你的授权')
    expect(markup).toContain('批准这一次')
    expect(markup).toContain('不会扩大后续权限')
    expect(markup).toContain('cargo test')
  })

  it('opens a lobby composer directly without a confirmation dialog', () => {
    const markup = renderToStaticMarkup(createElement(NewConversationWorkspace, {
      project: null,
      preflight: {
        admissible: true,
        readyMembers: [{ agentProfileId: 'agent-luoke', displayName: '洛可', memberOrder: 0 }],
        blockers: []
      },
      busy: false,
      onChooseProject: async () => undefined,
      onUseLobby: () => undefined,
      onSend: async () => undefined
    }))

    expect(markup).toContain('aria-label="新对话草稿"')
    expect(markup).toContain('id="new-camp-message"')
    expect(markup).toContain('发送第一条消息后才创建 Camp')
    expect(markup).toContain('由 洛可 接收第一条消息')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('对话标题')
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

  it('renders structured execution blockers instead of accepting an unhealthy start', () => {
    const preflight: StartPreflightResult = {
      admissible: false,
      checkedAt: '2026-07-21T00:00:00Z',
      blockers: [],
      workspace: null,
      targets: [{
        agentProfileId: 'agent-luoke',
        conversationId: 'conversation-1',
        runtimeKind: 'codex',
        executableFingerprint: null,
        blockers: [{
          code: 'runtime_authentication_required',
          detail: 'Run codex login first.'
        }],
        queueConditions: []
      }]
    }

    const markup = renderToStaticMarkup(createElement(PreflightNotice, {
      preflight,
      loading: false
    }))
    expect(markup).toContain('当前不能受理执行')
    expect(markup).toContain('Agent Runtime 需要登录')
    expect(markup).toContain('Run codex login first.')
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
      onReload: async () => undefined
    }))

    expect(markup).toContain('选择一位成员')
    expect(markup).toContain('不会替新成员绑定 Runtime')
    expect(markup).toContain('@muwa')
    expect(markup).not.toContain('保存运行配置')
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
          runtimeKind: 'agy-cli', executablePath: '/Users/test/.local/bin/agy',
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
    expect(markup).toContain('检测到 Antigravity CLI')
    expect(markup).toContain('experimental')
    expect(markup).toContain('纳入 Lumen')
    expect(markup).toContain('/opt/homebrew/bin/codex')
    expect(markup).toContain('/opt/homebrew/bin/opencode')
    expect(markup).toContain('/opt/homebrew/bin/copilot')
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
