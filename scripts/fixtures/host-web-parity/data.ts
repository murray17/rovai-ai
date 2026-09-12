import type { ActionApprovalView, AgentProfile, AgentRunView, CampComposerDraftView, CampMessageView, CampSnapshot, NavigationSnapshot, ProductRuntimeAvailability } from '@contracts'
import { initialMembers, installations, availability as legacyAvailability } from '../member-editor/data.js'

// Fixed review data, never a claim about locally installed/authenticated Runtime.
export { installations }
export const availability: ProductRuntimeAvailability[] = legacyAvailability.map(item => ({ ...item,
  status: item.status as ProductRuntimeAvailability["status"], diagnosticCode: null, failure: null,
  discovery: { runtimeKind: item.runtimeKind, discoveryStatus: "found", executablePath: "/review/runtime",
    source: "inherited_path", reportedVersion: null, executableFingerprint: "review", searchPathSource: null,
    entrypointKind: null, candidateExtension: null, resolvedNativeTarget: true, versionProbeSucceeded: true,
    searchGeneration: 1, observedAt: "2026-09-12T02:30:00Z", diagnosticCode: null }
}))
export const now = '2026-09-12T02:30:00Z'
export const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
export const workspacePath = '/review/rovai-workspace'
export const agents: AgentProfile[] = initialMembers().slice(0, 2).map((agent: AgentProfile, i: number) => ({
  ...agent, agentId: `review-member-${i}`, displayName: i === 0 ? '洛可' : '木瓦',
  professionalResponsibilities: i === 0 ? '梳理当前页面与交互，落实已确认的修改。' : '复核实现与验证证据。',
  avatarRef: null, version: 1, memberOrder: i
}))
export function message(sequence: number, body: string, authorType: 'user' | 'agent'): CampMessageView {
  return { id: `review-message-${sequence}`, sequence, timelineGlobalSequence: sequence, authorType,
    authorId: authorType === 'user' ? 'local_user' : agents[0].agentId, sourceAgentRunId: null,
    body, content: [{ kind: 'text', text: body }], quotes: [], attachments: [],
    addressMode: 'default', addressedAgentIds: [agents[0].agentId], replyToCampMessageId: null,
    campTurnId: null, presentation: null, createdAt: now }
}
export const run: AgentRunView = {
  id: 'review-run', campTurnId: 'review-turn', conversationId: 'review-conversation', agentId: agents[0].agentId,
  taskId: null, responsibilityKey: 'review', responsibilityGeneration: 1, purpose: '验证 Camp 页面共享', completionRole: 'required',
  status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null,
  terminalResolutionSource: null, terminalReasonCode: null, failure: null, runtimeModel: null,
  executionEpoch: 1, permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 1,
  a2aParentAgentRunId: null, a2aRootAgentRunId: 'review-run', a2aDepth: 0, executionEvidenceCount: 2,
  hasUnsettledExternalEffects: false, workspace: { path: workspacePath }, startingGitObservation: null, endingGitObservation: null,
  version: 1, createdAt: now, startedAt: now, endedAt: null, updatedAt: now
}
export const approval: ActionApprovalView = {
  id: 'review-approval', actionId: 'review-action', actionKind: 'shell_command',
  actionSummary: '运行工作区测试', reason: 'Run pnpm test in the selected workspace.',
  canonicalInput: { command: 'pnpm test -- --run', cwd: workspacePath }, agentRunId: run.id, agentId: agents[0].agentId,
  adapterKind: 'codex-cli', nativeMethod: 'item/commandExecution/requestApproval', requestDigest: 'review-request',
  permissionSemantics: 'runtime_managed_v2', status: 'pending', requestedForUserId: 'local_user',
  resolvedByType: null, resolvedById: null, resolutionCode: null, version: 1, requestedAt: now, resolvedAt: null,
  options: [
    { optionId: 'native-once', kind: 'allow_once', label: 'Allow once' },
    { optionId: 'native-session', kind: 'allow_session', label: 'Allow for this session' },
    { optionId: 'native-deny', kind: 'deny', label: 'Deny' }
  ].map(option => ({ ...option, kind: option.kind as ActionApprovalView['options'][number]['kind'],
    consequence: 'Review fixture only', nativeResponseDigest: `review-${option.optionId}` }))
}
export const initialDraft: CampComposerDraftView = {
  campId, revision: 1, body: '继续核对审批和文件预览，保留现有交互。',
  content: { version: 2, segments: [{ kind: 'text', text: '继续核对审批和文件预览，保留现有交互。' }] },
  attachments: [], quotes: [], replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null
}
export const initial: CampSnapshot = {
  schemaVersion: 34, throughGlobalSequence: 3,
  camp: { id: campId, title: 'Camp 页面与审批流程核对', activationState: 'active', projectBindingKind: 'directory',
    projectPath: workspacePath, defaultLeadAgentId: agents[0].agentId, membershipGeneration: 1, version: 1, createdAt: now, updatedAt: now },
  members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName, avatarRef: agent.avatarRef,
    teamRole: agent.teamRole, accent: agent.accent ?? '', membershipStatus: 'active', leaveRequestedAt: null,
    profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
  messages: [
    message(1, '请检查 Camp 的主要操作是否完整，保留现在的界面和阅读密度。', 'user'),
    { ...message(2, '已确认导航、消息和 Composer 的位置。\n\n接下来核对：\n\n- 执行详情与原生审批选项\n- 附件和文件阅读\n- 队员与 Runtime 配置\n\n检查记录见 [交互核对.md](docs/interaction-review.md)。', 'agent'),
      attachments: [{ id: 'review-attachment', displayName: 'interaction-review.md', kind: 'file', fileCount: null,
        mediaType: 'text/markdown', byteSize: 1024, previewKind: 'none', availability: 'available' }] },
    message(3, '同意，先把这些路径走完。', 'user')
  ],
  membershipReconciliations: [], tasks: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
}
export function navigation(snapshot: CampSnapshot): NavigationSnapshot {
  const item = { id: snapshot.camp.id, defaultLead: { agentId: snapshot.camp.defaultLeadAgentId!, displayName: agents.find(a => a.agentId === snapshot.camp.defaultLeadAgentId)?.displayName ?? '' },
    title: snapshot.camp.title, projectBindingKind: snapshot.camp.projectBindingKind, projectPath: snapshot.camp.projectPath,
    activationState: snapshot.camp.activationState, marker: 'none' as const, lastActivityAt: now,
    lastActivityGlobalSequence: 3, latestCompletionGlobalSequence: 0, version: snapshot.camp.version }
  return { schemaVersion: 3, throughGlobalSequence: snapshot.throughGlobalSequence,
    projects: snapshot.camp.projectBindingKind === 'directory' ? [{ projectKey: 'review-project', name: 'rovai-workspace', projectPath: workspacePath,
      lastActivityAt: now, lastActivityGlobalSequence: 3, totalCount: 1, recentCamps: [item] }] : [],
    quickChat: { totalCount: snapshot.camp.projectBindingKind === 'quick_chat' ? 1 : 0,
      recentCamps: snapshot.camp.projectBindingKind === 'quick_chat' ? [item] : [] } }
}
export const fileText = '# 交互核对\n\n本文件是宽屏对照稿中的固定示例，不来自真实工作区。\n\n## 本次检查\n\n| 路径 | 预期 |\n|---|---|\n| Camp | 导航、正文、Composer 共用生产组件 |\n| 审批 | 展示 Runtime 提供的选项，提交时防止重复点击 |\n| 文件 | 按受授权资源读取，显示来源与失效状态 |\n\n```ts\nconst client = useCampClient()\n```\n'
