import type { ActionApprovalView, CampPendingInputsView, CoreEvent, CoreMethod, CreateCampRequest, FilePreviewApi, ResolvedFilePreview } from '@contracts'
import type { CampClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { agents, approval, campId, fileText, initial, initialDraft, installations, message, now, run, workspacePath } from './data'

export type Scenario = 'camp' | 'new' | 'running' | 'approval' | 'file' | 'member'
export type Surface = 'desktop' | 'web'
export function createReviewModel(surface: Surface, scenario: Scenario) {
  const listeners = new Set<() => void>()
  const events = new Set<(event: CoreEvent) => void>()
  const texts = new Map([['review-attachment', fileText]])
  let state = { snapshot: structuredClone(initial), agents: structuredClone(agents),
    draft: structuredClone(initialDraft), busy: false, offline: false, note: '固定 fixture · 所有写入仅模拟在本页内存中' }
  const change = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
  const note = (value: string) => change({ note: value })
  const unavailable = (operation: string): never => { throw new Error(`对照稿未覆盖 ${operation}；没有调用 Host，也未返回空结果冒充成功。`) }
  const event = () => events.forEach(fn => fn({ method: 'camp.pendingInputs.changed', params: { campId: state.snapshot.camp.id, reason: 'review' } }))
  const checkOnline = () => { if (state.offline) throw new Error('模拟连接中断，当前编辑保留；恢复后核对原命令结果。') }
  const delay = () => new Promise(resolve => setTimeout(resolve, 700))
  const applied = (payload: unknown = {}) => ({ status: 'applied', code: null, payload, resultEntity: null })

  function showExecution(waiting: boolean) {
    const snapshot = structuredClone(initial)
    snapshot.agentRuns = [{ ...run, executionEvidenceCount: 3, status: waiting ? 'waiting' : 'running', waitReason: waiting ? 'action_approval' : null }]
    snapshot.turns = [{ id: run.campTurnId, triggerType: 'camp_message', triggerId: snapshot.messages[0].id,
      status: waiting ? 'waiting' : 'running', cancelRequestedAt: null, aggregateReasonCode: null,
      executionBudget: { schemaVersion: 1, acceptedAt: now, deadlineAt: '2026-09-12T04:30:00Z', elapsedSeconds: 35,
        maxAgentRunResponsibilities: 50, maxAcceptedA2a: 50, allocatedAgentRunResponsibilities: 1, acceptedA2a: 0,
        exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null }, version: 1, createdAt: now, updatedAt: now, endedAt: null }]
    snapshot.executionEvidence = [
      { id: 'review-text', agentRunId: run.id, executionEpoch: 1, sequence: 1, eventType: 'agent.text.delta',
        kind: 'narration', phase: 'updated', payload: { itemId: 'review-narration', delta: '已读取会话组件。准备运行工作区测试，再检查失败路径。' },
        contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now },
      { id: 'review-read', agentRunId: run.id, executionEpoch: 1, sequence: 2, eventType: 'activity.completed',
        kind: 'command', phase: 'completed', payload: { item: { id: 'review-read-command', type: 'commandExecution',
          command: 'cat docs/interaction-review.md', status: 'completed',
          aggregatedOutput: '固定工具输出：已读取交互核对说明。\n这里只验证生产工具详情，不证明实际命令执行。' } },
        canonical: { operationId: 'review-read-command', classifierVersion: 'activity-v1', activityDomain: 'shell',
          semanticKind: 'shell.execute', toolName: null, presentationHint: '读取交互核对说明', phase: 'terminal',
          outcome: 'succeeded', credibility: 'runtime_structured', coverageLevel: 'fine_grained', sourceAuthority: 'runtime',
          sourceEvidenceIds: ['review-read'], firstEvidenceSequence: 2, lastEvidenceSequence: 2, revision: 1 },
        contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now },
      { id: 'review-tool', agentRunId: run.id, executionEpoch: 1, sequence: 3, eventType: 'activity.started',
        kind: 'command', phase: 'started', payload: { item: { id: 'review-call', type: 'commandExecution',
          command: 'pnpm test -- --run', cwd: workspacePath, status: 'inProgress', aggregatedOutput: '' } },
        canonical: { operationId: 'review-call', classifierVersion: 'activity-v1', activityDomain: 'shell',
          semanticKind: 'shell.execute', toolName: null, presentationHint: '运行工作区测试', phase: 'started',
          outcome: 'unknown', credibility: 'runtime_structured', coverageLevel: 'fine_grained', sourceAuthority: 'runtime',
          sourceEvidenceIds: ['review-tool'], firstEvidenceSequence: 3, lastEvidenceSequence: 3, revision: 1 },
        contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now }
    ]
    snapshot.approvals = waiting ? [structuredClone(approval)] : []
    change({ snapshot })
  }
  if (scenario === 'running' || scenario === 'approval') showExecution(scenario === 'approval')

  const request = async (method: CoreMethod, input?: unknown): Promise<unknown> => {
    checkOnline()
    const p = (input ?? {}) as Record<string, any>
    switch (method) {
      case 'camp.composerDraft.get': return structuredClone(state.draft)
      case 'camp.composerDraft.save':
      case 'camp.composerDraft.removeAttachment': {
        if (p.campId !== state.draft.campId || p.expectedRevision !== state.draft.revision) throw new Error('模拟 revision 冲突，原草稿保留。')
        const next = { ...state.draft, revision: state.draft.revision + 1 }
        if (method.endsWith('.save')) { next.content = p.content; next.body = p.content.segments.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('') }
        else next.attachments = next.attachments.filter(a => a.id !== p.attachmentId)
        change({ draft: next }); return structuredClone(next)
      }
      case 'camp.pendingInputs.get': return { campId: state.snapshot.camp.id, executionActive: state.snapshot.agentRuns.some(r => r.status === 'running' || r.status === 'waiting'), items: [], editSession: null, submissionOutcomes: [] } satisfies CampPendingInputsView
      case 'skills.list': case 'skills.deliveryGroups.list': return [] // This fixed Camp has no assigned Skills.
      case 'camps.members.fast.check': return null // No subscription/Fast qualification is fabricated.
      case 'members.list': return structuredClone(state.agents)
      case 'runtime.installations.list': return structuredClone(installations)
      case 'runtime.modelCatalog.open': {
        const installation = installations.find((i: any) => i.adapterKind === p.runtimeKind)
        if (!installation) return unavailable(method)
        return { runtimeKind: p.runtimeKind, cache: installation.modelCatalog, models: installation.snapshot.models,
          refreshStatus: 'completed', diagnosticCode: null }
      }
      case 'members.runtime.set': {
        const c = p.command; const prior = state.agents.find(a => a.agentId === c.agentId)
        if (!prior || c.expectedVersion !== prior.version) throw new Error('模拟配置版本冲突')
        await delay()
        change({ agents: state.agents.map(a => a === prior ? { ...a, version: a.version + 1,
          runtimeConfiguration: { adapterKind: c.adapterKind, model: c.model ?? { mode: 'runtime_default' },
            permissions: c.permissions ?? { adapterKind: c.adapterKind, schemaVersion: 1, values: {} } } } : a) })
        note('模拟：运行配置已保存到本页；没有修改真实 Runtime。'); return applied()
      }
      case 'workspaces.inspect':
        if (p.path !== workspacePath) return unavailable('unauthorized workspace')
        return { projectPath: workspacePath, name: 'rovai-workspace',
        gitObservation: { state: 'not_git', repositoryRoot: null, gitCommonDir: null, objectFormat: null, headCommit: null, branch: null, dirty: null, observedAt: now } }
      case 'agentRunEvidence.list': return { schemaVersion: 1, agentRunId: run.id, requestedAfterSequence: p.afterSequence ?? 0,
        nextAfterSequence: 3, throughSequence: 3, evidence: state.snapshot.executionEvidence.filter(e => e.sequence > (p.afterSequence ?? 0)), hasMore: false }
      case 'agentRunEvidence.getContent': {
        const evidence = state.snapshot.executionEvidence.find(e => e.id === p.evidenceId)
        if (p.campId !== state.snapshot.camp.id || !evidence) return unavailable(method)
        return { payload: evidence.payload }
      }
      default: return unavailable(method)
    }
  }

  const opened = async () => { note('模拟 Desktop：交给系统打开固定示例文件。'); return { availability: 'available' as const, opened: true, error: null } }
  const client: CampClient = {
    platform: 'darwin', // Both comparison frames use the same macOS content baseline; native chrome is outside the viewport.
    request: request as CampClient['request'], onEvent: fn => { events.add(fn); return () => events.delete(fn) },
    attachments: surface === 'desktop' ? { kind: 'native', open: opened,
      reveal: async () => { note('模拟 Desktop：在 Finder 中显示固定示例。'); return { availability: 'available', revealed: true, error: null } } }
      : { kind: 'download', download: async locator => {
        const text = texts.get(locator.attachmentRefId)
        if (text === undefined) return { availability: 'missing', opened: false, error: 'target_unavailable' }
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
        const link = document.createElement('a'); link.href = url; link.download = 'interaction-review.md'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        note('已下载本稿的固定示例；这不是 Host 附件下载验收。')
        return { availability: 'available', opened: true, error: null }
      } },
    composerAttachments: {
      prepare: async (requestedCamp, revision, file) => {
        checkOnline()
        if (requestedCamp !== state.draft.campId || revision !== state.draft.revision) throw new Error('模拟草稿版本冲突')
        if (file.size > 64 * 1024) throw new Error('对照稿只接收 64 KiB 以内文本示例；尚未执行 Host 上传。')
        const id = `review-source-${crypto.randomUUID()}`; texts.set(id, await file.text())
        change({ draft: { ...state.draft, revision: revision + 1, attachments: [...state.draft.attachments,
          { id, displayName: file.name, kind: 'file', mediaType: file.type || 'text/plain', byteSize: file.size,
            fileCount: null, previewKind: 'none', availability: 'available' }] } })
        note('模拟：附件仅暂存在页面内存，未上传 Host。'); return structuredClone(state.draft)
      },
      preparePending: async () => unavailable('pending upload'),
      preview: async () => unavailable('image preview')
    }
  }

  const file: ResolvedFilePreview = { previewKey: 'review-document', handleId: 'review-handle', reopenToken: 'review-reopen',
    displayPath: 'docs/interaction-review.md', fileName: 'interaction-review.md', pathPresentation: 'project_relative',
    size: fileText.length, mime: 'text/markdown', extension: '.md', kind: 'markdown', hasExternalUpdate: false,
    contentVersion: { size: fileText.length, mtimeMs: 1 }, contentGeneration: 'review-generation', capabilities: ['read'], target: {} }
  const forbidden = async () => ({ ok: false as const, error: { code: 'source_not_authorized' as const,
    message: '本稿只授权固定示例文件；实际 Host 资源授权尚未验收。', retryable: false } })
  const open: FilePreviewApi['open'] = async req => {
    if (('campId' in req && req.campId !== campId) ||
      ('rawReference' in req && req.rawReference !== 'docs/interaction-review.md') ||
      (req.kind === 'attachment' && req.locator.attachmentRefId !== 'review-attachment')) return forbidden()
    return { ok: true, value: { kind: 'file_preview', file } }
  }
  const fileApi: FilePreviewApi = {
    bindCamp: async () => {}, onExternalUpdate: () => () => {}, open, restore: open,
    reopen: async () => ({ ok: true, value: { kind: 'file_preview', file } }),
    readText: async req => req.handleId === file.handleId && req.expectedGeneration === file.contentGeneration
      ? { ok: true, value: { text: fileText, contentGeneration: file.contentGeneration, contentVersion: file.contentVersion } } : forbidden(),
    prepareHtml: async req => req.handleId === file.handleId && req.expectedGeneration === file.contentGeneration
      ? { ok: true, value: { html: fileText, tabToken: 'review-markdown', bridgeToken: 'review-no-html-execution', assetBasePath: '',
          contentGeneration: file.contentGeneration, contentVersion: file.contentVersion } } : forbidden(),
    readPage: forbidden, readBinary: forbidden, resolveLine: forbidden, reload: forbidden,
    release: async () => ({ released: true }), openInSystem: forbidden, revealInFolder: forbidden,
    copyPath: forbidden, chooseAuthorizedRoot: forbidden
  }
  return {
    client, fileApi, note, get: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    setOffline: (offline: boolean) => change({ offline, note: offline ? '模拟离线：编辑保留，命令未重发。' : '模拟重新连接；不代表真实网络恢复验收。' }),
    async send(draft: typeof initialDraft) {
      checkOnline(); change({ busy: true }); await delay()
      const next = message(state.snapshot.messages.length + 1, draft.body, 'user'); next.attachments = draft.attachments
      change({ snapshot: { ...state.snapshot, messages: [...state.snapshot.messages, next] },
        draft: { ...initialDraft, campId: state.snapshot.camp.id, body: '', content: { version: 2, segments: [] }, revision: state.draft.revision + 1 }, busy: false })
      note('模拟发送已追加到当前页面；未调用 Rust、Runtime 或审批服务。'); event()
      return { campTurnId: 'review-simulated-turn', agentRunIds: [], addressedAgentIds: [agents[0].agentId] }
    },
    async resolve(item: ActionApprovalView, optionId: string) {
      checkOnline(); if (state.busy) return
      const option = item.options.find(o => o.optionId === optionId)
      if (!option) throw new Error('未知审批选项')
      change({ busy: true, note: `模拟提交审批：${option.label}` }); await delay()
      change({ busy: false, snapshot: { ...state.snapshot,
        approvals: state.snapshot.approvals.map(a => a.id === item.id ? { ...a, status: option.kind === 'deny' ? 'denied' : 'approved', version: a.version + 1, resolvedAt: now } : a),
        agentRuns: state.snapshot.agentRuns.map(r => ({ ...r, status: option.kind === 'deny' ? 'cancelled' : 'running', waitReason: null })) } })
      note(`模拟审批已处理：${option.label}；选项来自固定 approval fixture，不证明 Host 单次决议。`)
    },
    stop() { checkOnline(); change({ snapshot: { ...state.snapshot, agentRuns: state.snapshot.agentRuns.map(r => ({ ...r, status: 'cancelled', endedAt: now })) } }); note('模拟停止；没有停止真实进程。') },
    rename(title: string) { change({ snapshot: { ...state.snapshot, camp: { ...state.snapshot.camp, title } } }); note('模拟：当前页面的 Camp 名称已更新。') },
    create(draft: Omit<CreateCampRequest, 'commandId' | 'activationState'>) {
      const id = 'rvcamp_01m0wzxbb8e1ht984tsbjmysff'
      change({ snapshot: { ...structuredClone(initial), camp: { ...initial.camp, id, title: draft.name || '新的对话',
        projectBindingKind: draft.workspace ? 'directory' : 'quick_chat', projectPath: draft.workspace?.projectPath ?? '',
        defaultLeadAgentId: draft.defaultLeadAgentId }, messages: [],
        members: initial.members.filter(m => draft.memberAgentIds.includes(m.agentId)).map(m => ({ ...m, isDefaultLead: m.agentId === draft.defaultLeadAgentId })) },
        draft: { ...initialDraft, campId: id, body: '', content: { version: 2, segments: [] }, revision: 1 } })
      note('模拟：按所选目录与队员打开新 Camp；未创建 Host 数据。')
    }
  }
}
