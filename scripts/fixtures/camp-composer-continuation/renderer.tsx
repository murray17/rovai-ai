import type { AgentProfile, CampComposerDraftView, CampMessageView, CampPendingInputsView, CampSnapshot, CoreEvent, LocalAttachmentOwnerLocator, LocalAttachmentSourceView, PendingInputEditAction, RovaiApi } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CampWorkspace, type CampMessageSendReceipt } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { composerDocumentFromText, emptyComposerDocument } from '../../../apps/desktop/src/renderer/src/composer-document'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const timestamp = '2026-08-31T00:00:00Z'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const savedContinuationSources: unknown[] = []
const attachmentCalls: { owner: string; file: string }[] = []
const previewLocators: LocalAttachmentOwnerLocator[] = []
let releasePreparation: (() => void) | null = null
let pausePreparation = false
const listeners = new Set<(event: CoreEvent) => void>()
const emit = (method: string, params: Record<string, unknown>) => {
  for (const listener of listeners) listener({ method, params })
}
const neverSend = async (): Promise<CampMessageSendReceipt> => { throw new Error('This scenario must not submit messages') }
let send: (draft: CampComposerDraftView) => Promise<CampMessageSendReceipt> = neverSend
const drafts = new Map<string, CampComposerDraftView>()
let root: Root | null = null
let snapshot: CampSnapshot
let queue: CampPendingInputsView
let nextRead: { promise: Promise<CampComposerDraftView>; resolve(value: CampComposerDraftView): void } | null = null
const agents: AgentProfile[] = ['叮叮', '芝士'].map((displayName, index) => ({
  agentId: `agent_${index + 1}`, displayName, avatarRef: null, accent: '#39777a', teamRole: '开发者',
  professionalResponsibilities: '实现和验证', personalityTraits: ['严谨'], workingPrinciples: '遵循项目规范',
  growthTopic: '', defaultCapabilities: [], presence: 'present', memberOrder: index, version: 1,
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, createdAt: timestamp, updatedAt: timestamp, removedAt: null
}))

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function flush() { await frames(); check(errors.length === 0, errors.join('\n')) }
async function until(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await flush()
    if (condition()) return
  }
  throw new Error(message)
}
const continuation = () => document.querySelector('.composer-continuation')?.getAttribute('aria-label') ?? null
const editor = () => document.getElementById('camp-message')!
const draftReads = () => calls.filter(call => call === 'camp.composerDraft.get').length
const emptyDraft = (id = campId): CampComposerDraftView => ({
  campId: id, body: '', content: emptyComposerDocument(), revision: 0, attachments: [], replyIntent: null,
  continuationIntent: null, updatedAt: null, expiresAt: null
})
const continuedDraft = (messageId: string): CampComposerDraftView => ({
  ...emptyDraft(), continuationIntent: { sourceCampMessageId: messageId,
    recipient: { agentId: 'agent_2', displayName: '芝士', recipientAvailability: 'available' },
    recipientSelectionRequired: false }
})

// Core's projection is supplied explicitly per scenario. This fixture tests the
// production Renderer lifecycle, not a second implementation of route calculation.
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: (listener: (event: CoreEvent) => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  async request(method: string, params: Record<string, unknown> = {}) {
    calls.push(method)
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.pendingInputs.get') return structuredClone({ ...queue, campId: params.campId })
    if (method === 'camp.pendingInputs.edit') {
      const command = params.command as {
        pendingInputId: string; expectedRevision: number; editToken: string | null; action: PendingInputEditAction
      }
      const item = queue.items.find(item => item.id === command.pendingInputId)!
      check(item?.revision === command.expectedRevision, 'Pending edit must use the canonical revision')
      const action = command.action
      if (action.type === 'begin') {
        queue.editSession = { pendingInputId: item.id, editToken: 'fixture-edit-token', basePendingRevision: item.revision,
          recoveryRequired: false, workingAttachments: structuredClone(item.attachments) }
      } else {
        check(command.editToken === queue.editSession?.editToken, 'Working attachments must use the edit token')
        if (action.type === 'remove_attachment') {
          queue.editSession!.workingAttachments = queue.editSession!.workingAttachments.filter(a => a.id !== action.attachmentRefId)
        } else if (action.type === 'reorder_attachments') {
          queue.editSession!.workingAttachments = action.attachmentRefIds.map(id => queue.editSession!.workingAttachments.find(a => a.id === id)!)
        } else {
          if (action.type === 'save') {
            item.attachments = structuredClone(queue.editSession!.workingAttachments)
            item.content = action.content
            item.body = action.content.segments.map(segment => segment.kind === 'text' ? segment.text : '').join('')
            item.revision += 1
          } else if (action.type === 'delete') {
            queue.items = queue.items.filter(candidate => candidate.id !== item.id)
          } else check(action.type === 'cancel', 'Only the exercised edit actions are mocked')
          queue.editSession = null
        }
      }
      return { status: 'accepted', code: 'ok', payload: { editToken: queue.editSession?.editToken } }
    }
    if (method === 'camp.composerDraft.get') {
      if (nextRead) { const held = nextRead; nextRead = null; return held.promise }
      return structuredClone(drafts.get(String(params.campId)))
    }
    if (method === 'camp.composerDraft.save') {
      savedContinuationSources.push(params.continuationSourceMessageId)
      const current = drafts.get(String(params.campId))!
      const content = params.content as CampComposerDraftView['content']
      const saved = { ...current, content, body: content.segments.map(segment => segment.kind === 'text' ? segment.text : '').join(''),
        revision: current.revision + 1 }
      drafts.set(saved.campId, saved)
      return structuredClone(saved)
    }
    errors.push(`Unexpected RPC: ${method}`)
    throw new Error(`Unexpected RPC: ${method}`)
  },
  composerAttachments: {
    async prepare(id: string, revision: number, file: File) {
      const current = drafts.get(id)!
      check(current.revision === revision, 'Ordinary attachment must use the current Draft revision')
      attachmentCalls.push({ owner: 'composer', file: file.name })
      const next = { ...current, revision: revision + 1, attachments: [...current.attachments, sourceAttachment(file)] }
      drafts.set(id, next)
      return structuredClone(next)
    },
    async preparePending(input: { pendingInputId: string; expectedRevision: number; editToken: string }, file: File) {
      check(input.pendingInputId === queue.editSession?.pendingInputId && input.editToken === queue.editSession.editToken,
        'Pending ingress must target the current working owner, not the hidden Draft')
      check(input.expectedRevision === queue.items.find(item => item.id === input.pendingInputId)?.revision, 'Pending ingress revision')
      attachmentCalls.push({ owner: 'pending_edit', file: file.name })
      if (pausePreparation) await new Promise<void>(resolve => { releasePreparation = resolve })
      if (file.name === 'unreadable.txt') throw new Error('文件当前无法读取')
      queue.editSession!.workingAttachments.push(sourceAttachment(file))
      return structuredClone(queue)
    },
    async preview(locator: LocalAttachmentOwnerLocator) {
      previewLocators.push(locator)
      return { availability: 'available', preview: { mediaType: 'image/svg+xml',
        bytes: Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#49858b"/><circle cx="105" cy="40" r="20" fill="#f2cd81"/><path d="M0 120 55 50 110 120" fill="#d1e6da"/></svg>')) } }
    }
  },
  attachments: {
    async open(locator: LocalAttachmentOwnerLocator) { previewLocators.push(locator); return { availability: 'available', error: null } },
    async reveal(locator: LocalAttachmentOwnerLocator) { previewLocators.push(locator); return { availability: 'available', error: null } }
  }
} as unknown as RovaiApi })

function sourceAttachment(file: File): LocalAttachmentSourceView {
  return { id: crypto.randomUUID(), displayName: file.name, kind: 'file', mediaType: file.type || null,
    byteSize: file.size, fileCount: null, previewKind: file.type.startsWith('image/') ? 'image' : 'none', availability: 'unknown' }
}

function message(sequence: number, agentId: string): CampMessageView {
  return { id: `message-${sequence}`, sequence, timelineGlobalSequence: sequence,
    authorType: 'user', authorId: 'local_user', sourceAgentRunId: null,
    body: `消息 ${sequence}`, content: [{ kind: 'member_mention', agentId }, { kind: 'text', text: `消息 ${sequence}` }],
    addressMode: 'explicit', attachments: [], addressedAgentIds: [agentId], replyToCampMessageId: null,
    campTurnId: `turn-${sequence}`, presentation: null, createdAt: timestamp }
}

function running(current: CampMessageView): Pick<CampSnapshot, 'turns' | 'agentRuns'> {
  const agentId = current.addressedAgentIds[0]
  return {
    turns: [{ id: current.campTurnId!, triggerType: 'camp_message', triggerId: current.id, status: 'running',
      cancelRequestedAt: null, aggregateReasonCode: null, executionBudget: { schemaVersion: 1,
        acceptedAt: timestamp, deadlineAt: '2026-08-31T01:00:00Z', elapsedSeconds: 3600,
        maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16, allocatedAgentRunResponsibilities: 1,
        acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null },
      version: 1, createdAt: timestamp, updatedAt: timestamp, endedAt: null }],
    agentRuns: [{ id: `run-${current.sequence}`, campTurnId: current.campTurnId!, conversationId: `conversation-${agentId}`,
      agentId, taskId: null, responsibilityKey: `direct:${agentId}`, responsibilityGeneration: 0, purpose: current.body,
      completionRole: 'required', status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null, terminalReasonCode: null, failure: null,
      runtimeModel: null, permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 0,
      hasUnsettledExternalEffects: false, workspace: { path: '/fixture' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: timestamp, startedAt: timestamp, endedAt: null, updatedAt: timestamp }]
  }
}

async function render() {
  flushSync(() => root!.render(<CampWorkspace snapshot={snapshot} projectName={null} agents={agents}
    busy={false} stopping={false} worldMapEnabled={false}
    onSend={(draft) => send(draft)} onStop={() => undefined}
    onChangeLead={async () => undefined} onTasksChanged={async () => undefined} onResolveApproval={() => undefined} />))
  await flush()
}

async function reset(draft = emptyDraft()) {
  if (root) {
    flushSync(() => root!.unmount())
    await new Promise(resolve => setTimeout(resolve, 0))
    await flush()
  }
  calls.length = 0
  attachmentCalls.length = 0
  previewLocators.length = 0
  releasePreparation = null
  pausePreparation = false
  savedContinuationSources.length = 0
  drafts.clear()
  drafts.set(campId, draft)
  nextRead = null
  send = neverSend
  queue = { campId, executionActive: true, items: [], editSession: null }
  const first = message(1, 'agent_1')
  snapshot = { schemaVersion: 34, throughGlobalSequence: 1,
    camp: { id: campId, title: '续发目标回归', activationState: 'active', projectBindingKind: 'quick_chat',
      projectPath: '/fixture', defaultLeadAgentId: 'agent_1', membershipGeneration: 1, version: 1,
      createdAt: timestamp, updatedAt: timestamp },
    members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      teamRole: agent.teamRole, avatarRef: null, accent: agent.accent ?? '#39777a', membershipStatus: 'active', leaveRequestedAt: null,
      profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [], tasks: [], messages: [first], messageDeliveries: [], ...running(first),
    executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
  root = createRoot(document.getElementById('root')!)
  await render()
  await flush()
}

async function publish(agentId: string, projected: CampComposerDraftView) {
  drafts.set(snapshot.camp.id, projected)
  const next = message(snapshot.messages.at(-1)!.sequence + 1, agentId)
  snapshot = { ...snapshot, throughGlobalSequence: snapshot.throughGlobalSequence + 1,
    messages: [...snapshot.messages, next], ...running(next) }
  queue = { ...queue, items: queue.items.slice(1) }
  emit('camp.pendingInputs.changed', { campId: snapshot.camp.id, reason: 'published' })
  await render()
}

function holdRead() {
  let resolve!: (draft: CampComposerDraftView) => void
  const held = { promise: new Promise<CampComposerDraftView>(accept => { resolve = accept }), resolve: (draft: CampComposerDraftView) => resolve(draft) }
  nextRead = held
  return held
}

const pendingEditor = () => document.getElementById('pending-camp-message')!
const pendingCards = () => document.querySelectorAll('.pending-input-editor .composer-attachment-card')
const pendingButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.pending-input-editor button'))
  .find(button => button.textContent?.trim() === label)!
const pendingReady = () => pendingEditor()?.isContentEditable === true
const imageFile = (name = '粘贴图片.png') => new File(['fixture image'], name, { type: 'image/png' })
const textFile = (name: string) => new File(['fixture text'], name, { type: 'text/plain' })

function dragFiles(target: Element, files: File[], drop = true): DragEvent {
  const dataTransfer = new DataTransfer()
  // Constructed DataTransfer has no native drag operation to retain dropEffect.
  // Keep the handler's chosen cursor observable while using real FileList/items.
  Object.defineProperty(dataTransfer, 'dropEffect', { value: 'none', writable: true })
  files.forEach(file => dataTransfer.items.add(file))
  target.dispatchEvent(new DragEvent('dragenter', { dataTransfer, bubbles: true, cancelable: true }))
  const over = new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true })
  target.dispatchEvent(over)
  if (drop) target.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
  return over
}

async function beginPending(index = 0) {
  document.querySelectorAll<HTMLButtonElement>('.pending-input-edit')[index].click()
  await until(pendingReady, 'The Pending editor must own its edit session')
}

async function setupPendingAttachments() {
  const draft = emptyDraft()
  draft.body = '独立保留的普通草稿'
  draft.content = composerDocumentFromText(draft.body)
  draft.attachments = [sourceAttachment(imageFile('普通图片.png'))]
  await reset(draft)
  const attachments = [sourceAttachment(imageFile('原有图片.png')), sourceAttachment(textFile('设计说明.txt'))]
  queue.items = [
    { id: 'pending-with-body', campId, enqueueSequence: 1, revision: 1, state: 'queued',
      content: composerDocumentFromText('请看这份设计说明'), body: '请看这份设计说明', attachments,
      replyIntent: null, recipientSelectionRequired: false, lastAttemptErrorCode: null },
    { id: 'pending-attachment-only', campId, enqueueSequence: 2, revision: 1, state: 'queued',
      content: emptyComposerDocument(), body: '', attachments: [sourceAttachment(imageFile('仅附件.png'))],
      replyIntent: null, recipientSelectionRequired: false, lastAttemptErrorCode: null }
  ]
  emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
  await until(() => document.querySelectorAll('.pending-input-row').length === 2, 'Both queued messages must appear')
  return draft
}

async function runPendingAttachmentCases(): Promise<string[]> {
  const cases: string[] = []
  const draft = await setupPendingAttachments()
  const summaries = document.querySelectorAll('.pending-input-copy')
  check(summaries[0].textContent === '请看这份设计说明' && summaries[1].textContent === '', 'Queue summaries must contain only body, including an empty attachment-only body')
  check(!document.querySelector('.pending-input-list .attachment-card, .pending-input-attachments'), 'Queue rows must not render attachment cards')
  check(!previewLocators.some(locator => locator.owner === 'pending'), 'Queue display must not load attachment previews')
  cases.push('queue rows show only body and leave attachment-only summaries blank')

  await beginPending()
  await until(() => Boolean(document.querySelector('.pending-input-editor .composer-image-preview img')), 'Existing Pending image must use the shared thumbnail')
  const ordinaryImage = document.querySelector<HTMLElement>('.composer > [hidden] .composer-image-attachment')!
  const pendingImage = document.querySelector<HTMLElement>('.pending-input-editor .composer-image-attachment')!
  check(ordinaryImage && getComputedStyle(ordinaryImage).width === getComputedStyle(pendingImage).width, 'Pending and ordinary Composer thumbnails must share their dimensions')
  pausePreparation = true
  const clipboardData = new DataTransfer()
  clipboardData.items.add(imageFile())
  pendingEditor().dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  await until(() => releasePreparation !== null, 'Pasted image must reach Pending ingress')
  check(document.querySelector('.pending-input-editor .attachment-preparing')
    && document.querySelector<HTMLButtonElement>('.pending-input-editor .composer-send')!.disabled,
    'Preparation uses shared loading cards and prevents premature Save')
  const blocked = dragFiles(pendingEditor(), [textFile('blocked.txt')])
  await flush()
  check(blocked.dataTransfer?.dropEffect === 'none' && !attachmentCalls.some(call => call.file === 'blocked.txt'), 'Busy edit must reject further drops without routing to the hidden Draft')
  pausePreparation = false
  releasePreparation!()
  await until(() => pendingReady() && document.querySelectorAll('.pending-input-editor .composer-image-preview img').length === 2, 'Pasted image must become a normal image thumbnail')
  check(previewLocators.some(locator => locator.owner === 'pending_edit' && locator.editToken === 'fixture-edit-token'), 'Image preview must use the working owner and edit token')
  cases.push('pasted Pending images share Composer thumbnails, loading and edit-scoped previews')

  const over = dragFiles(pendingEditor(), [textFile('拖入文件.txt')], false)
  await flush()
  check(over.defaultPrevented && over.dataTransfer?.dropEffect === 'copy', 'Parent must not override Pending drag acceptance')
  check(document.querySelector('.composer.is-dragging-attachments .pending-input-editor .composer-destination')?.textContent === '将添加到这条消息',
    'Pending drop must show the ordinary destination feedback')
  pendingEditor().dispatchEvent(new DragEvent('drop', { dataTransfer: over.dataTransfer, bubbles: true, cancelable: true }))
  await until(() => pendingReady() && pendingCards().length === 4, 'Dropped file must join the current Pending editor')
  check(!document.querySelector('.composer.is-dragging-attachments'), 'Drop must clear the feedback')
  const timeline = document.querySelector('.conversation-main') ?? document.querySelector('.conversation-controls')!
  dragFiles(timeline, [textFile('会话区拖入.txt'), textFile('多文件和很长的中文附件名称用于检查横向附件带不会撑破输入区域.md')])
  await until(() => pendingReady() && pendingCards().length === 6, 'Conversation drop must accept multiple files for the active Pending editor')
  check(attachmentCalls.every(call => call.owner === 'pending_edit'), 'Editing drops must never reach ordinary Draft ingress')
  cases.push('Pending editor and conversation drops share feedback and route multiple files to working attachments')

  const firstId = queue.editSession!.workingAttachments[0].id
  const firstButton = document.querySelector<HTMLButtonElement>('.pending-input-editor .attachment-open')!
  firstButton.focus()
  firstButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
  await until(() => Boolean(document.querySelector('.attachment-context-menu')), 'Keyboard must open attachment actions')
  Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent === '后移')!.click()
  await until(() => pendingReady() && queue.editSession!.workingAttachments[1].id === firstId, 'Attachment menu must preserve reorder support')
  document.querySelector<HTMLButtonElement>('.pending-input-editor [aria-label="移除附件 拖入文件.txt"]')!.click()
  await until(() => pendingReady() && pendingCards().length === 5, 'Shared remove button must remove the selected working ref')
  pendingButton('保存').click()
  await until(() => !pendingEditor(), 'Save must close the edit')
  check(queue.items[0].attachments.length === 5 && queue.items[0].revision === 2, 'Save must preserve working attachments in the same queued item')
  check(document.querySelectorAll('.pending-input-copy')[0].textContent === '请看这份设计说明', 'Saved attachments must remain absent from the queue summary')
  check(JSON.stringify(drafts.get(campId)) === JSON.stringify(draft), 'Editing must preserve the independent ordinary Draft')
  cases.push('shared card removal and keyboard-menu reorder save only the edited Pending')

  await beginPending()
  dragFiles(pendingEditor(), [textFile('unreadable.txt')])
  await until(() => pendingReady() && Boolean(document.querySelector('[role="alert"]')?.textContent?.includes('文件当前无法读取')), 'Failed ingress must retain an actionable error and recover controls')
  dragFiles(pendingEditor(), [textFile('放弃的附件.txt')])
  await until(() => pendingReady() && pendingCards().length === 6, 'Successful drop must work after an ingress failure')
  pendingButton('取消').click()
  await until(() => Boolean(document.querySelector('[role="dialog"]')), 'Cancel with changed attachments must confirm discard')
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === '放弃修改')!.click()
  await until(() => !pendingEditor(), 'Discard must close the edit')
  check(queue.items[0].attachments.length === 5, 'Cancel must not change canonical Pending attachments')
  cases.push('failed Pending ingress recovers and Cancel discards only working attachment changes')

  await beginPending(1)
  check(!pendingButton('保存').disabled && !pendingEditor().textContent?.trim(), 'Attachment-only Pending must remain saveable')
  document.querySelector<HTMLButtonElement>('.pending-input-editor .attachment-remove')!.click()
  await until(() => pendingReady() && pendingCards().length === 0, 'The last attachment can be removed')
  check(pendingButton('保存').disabled, 'Empty body and empty attachments cannot be saved')
  queue.editSession = { ...queue.editSession!, recoveryRequired: true }
  emit('camp.pendingInputs.changed', { campId, reason: 'edit_changed' })
  await until(() => !pendingReady(), 'Fenced edit must become read-only')
  const fenced = dragFiles(pendingEditor(), [textFile('fenced.txt')])
  await flush()
  check(fenced.dataTransfer?.dropEffect === 'none' && !attachmentCalls.some(call => call.file === 'fenced.txt'), 'Fenced edit must reject drops, not fall back to the normal Draft')
  check(JSON.stringify(drafts.get(campId)) === JSON.stringify(draft), 'Failure and fenced paths must leave the ordinary Draft intact')
  cases.push('attachment-only Save and fenced-edit drag guards remain intact')
  return cases
}

Object.assign(window, { continuationTest: { async run() {
  const cases: string[] = []
  await reset()
  const queueReads = () => calls.filter(call => call === 'camp.pendingInputs.get').length
  check(queueReads() === 1, 'Mount must read the queue once')
  await new Promise(resolve => setTimeout(resolve, 1_200))
  await flush()
  check(queueReads() === 1, 'An unchanged queue must not be polled every second')
  snapshot = { ...snapshot, throughGlobalSequence: 2 }
  await render()
  check(queueReads() === 1, 'Unrelated public evidence must not reread the private queue')
  cases.push('idle queues do not poll or refresh for unrelated public evidence')

  const initialReads = draftReads()
  queue.items = [{ id: 'pending-B', campId, enqueueSequence: 1, revision: 1, state: 'queued',
    content: composerDocumentFromText('给芝士的 B'), body: '给芝士的 B', replyIntent: null,
    recipientSelectionRequired: false, lastAttemptErrorCode: null, attachments: [] }]
  emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
  await flush()
  check(document.querySelector('.pending-input-list'), 'B must be visible in the private queue')
  check(continuation() === null && draftReads() === initialReads, 'Queue admission or Run progress must not recalculate the route')
  cases.push('private queue admission leaves the published route unchanged')

  await publish('agent_2', continuedDraft('message-2'))
  await until(() => continuation() === '继续发给 芝士', 'Publishing queued B must refresh the visible continuation before B finishes')
  check(snapshot.agentRuns[0].status === 'running' && snapshot.agentRuns[0].endedAt === null, 'B must still be running')
  cases.push('published B changes the target while its Run is still active')

  await publish('agent_1', emptyDraft())
  await until(() => continuation() === null, 'Publishing to Lead must clear the stale non-Lead continuation')
  check(document.querySelector('.composer-route-rail')?.textContent?.includes('叮叮'), 'The route must return to the Lead')
  cases.push('the next published Lead message clears the previous continuation')

  await reset()
  const held = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  check(nextRead === null, 'Publication must request a fresh Draft projection')
  const activeEditor = editor()
  activeEditor.focus()
  document.execCommand('insertText', false, '不要覆盖的草稿')
  await flush()
  held.resolve(continuedDraft('message-2'))
  await flush()
  check(editor() === activeEditor && editor().textContent?.includes('不要覆盖的草稿'), 'Late reads must preserve the live editor and text')
  check(continuation() === null, 'A late response must not change the target after typing began')
  cases.push('a late publication read cannot replace locally edited text or route')

  const explicit = emptyDraft()
  explicit.content = { version: 2, segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent_1' } }, { kind: 'text', text: '已有草稿' }] }
  explicit.body = '@叮叮 已有草稿'
  explicit.attachments = [{ id: 'attachment-1', displayName: '验收文件.txt', kind: 'file', fileCount: 1,
    mediaType: 'text/plain', byteSize: 42, previewKind: 'none', availability: 'unknown' }]
  await reset(explicit)
  const retainedEditor = editor()
  await publish('agent_2', explicit)
  check(editor() === retainedEditor && editor().textContent?.includes('已有草稿'), 'Publication must preserve the existing Draft text')
  check(document.querySelector('.composer-attachment-strip strong')?.getAttribute('title') === '验收文件.txt', 'Publication must preserve attachments')
  check(continuation() === null && editor().querySelector('[data-token-kind="member_mention"][data-agent-id="agent_1"]'), 'Explicit recipient must remain authoritative')
  cases.push('publication preserves an existing explicit recipient, text and attachment')

  const frozen = continuedDraft('older-message')
  frozen.body = '继续给芝士的草稿'
  frozen.content = composerDocumentFromText(frozen.body)
  await reset(frozen)
  await publish('agent_1', frozen)
  check(continuation() === '继续发给 芝士' && editor().textContent?.includes(frozen.body), 'A started Draft must retain its frozen continuation')
  cases.push('a started Draft retains its own continuation source')

  await reset()
  const previousCampRead = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  const otherCampId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'
  drafts.set(otherCampId, emptyDraft(otherCampId))
  snapshot = { ...snapshot, camp: { ...snapshot.camp, id: otherCampId } }
  await render()
  await flush()
  previousCampRead.resolve(continuedDraft('message-2'))
  await flush()
  check(continuation() === null, 'A late read from the previous Camp must not change this Camp')
  cases.push('late publication responses are scoped to their Camp')

  await reset()
  editor().focus()
  document.execCommand('insertText', false, '已经自动保存的下一条')
  await until(() => calls.includes('camp.composerDraft.save'), 'Typing must autosave the Draft')
  await flush()
  const savesBefore = calls.filter(call => call === 'camp.composerDraft.save').length
  const readsBefore = draftReads()
  let submissions = 0
  send = async (draft) => {
    check(draft.body === '已经自动保存的下一条' && draft.revision > 0, 'Send must use the saved exact Draft')
    submissions += 1
    drafts.set(campId, emptyDraft())
    queue = { ...queue, items: [{ id: 'pending-send', campId, enqueueSequence: 1, revision: 1, state: 'queued',
      content: draft.content, body: draft.body, replyIntent: null, recipientSelectionRequired: false, lastAttemptErrorCode: null, attachments: draft.attachments }] }
    emit('camp.pendingInputs.changed', { campId, reason: 'enqueued' })
    return { pendingInputId: 'pending-send', agentRunIds: [], campTurnId: null, addressedAgentIds: ['agent_1'] }
  }
  editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  await until(() => submissions === 1 && !editor().textContent?.trim(), 'The pending send must consume the ordinary Draft')
  await flush()
  check(calls.filter(call => call === 'camp.composerDraft.save').length === savesBefore, 'Send must not save an identical autosaved Draft again')
  check(draftReads() === readsBefore + 1, 'A successful send must read the next Draft only once')
  check(document.querySelector('.pending-input-list')?.textContent?.includes('已经自动保存的下一条'), 'Admission must appear in the private queue')
  check(snapshot.messages.length === 1, 'Private admission must not add a public message')
  cases.push('an autosaved pending send avoids duplicate Draft saves and reads')

  for (const admission of ['pending', 'published', 'published-lagging']) {
    const published = admission !== 'pending'
    await reset(continuedDraft('message-1'))
    const previous = message(1, 'agent_2')
    snapshot = { ...snapshot, messages: [previous], ...running(previous) }
    if (published) {
      snapshot = { ...snapshot, turns: [], agentRuns: [] }
      queue = { ...queue, executionActive: false }
    }
    await render()
    editor().focus()
    document.execCommand('insertText', false, '第一条继续给芝士')
    await until(() => savedContinuationSources.length === 1, 'The first Draft must autosave its continuation')
    const source = published ? 'message-2' : 'message-1'
    const nextDraft = continuedDraft(source)
    let heldNextDraft: ReturnType<typeof holdRead> | null = null
    let sends = 0
    const publishSnapshot = async () => {
      const sent = message(2, 'agent_2')
      snapshot = { ...snapshot, throughGlobalSequence: 2, messages: [...snapshot.messages, sent], ...running(sent) }
      await render()
    }
    send = async (draft) => {
      sends += 1
      check(draft.continuationIntent?.recipient.agentId === 'agent_2', 'Both sends must retain the non-Lead recipient')
      drafts.set(campId, nextDraft)
      if (sends === 1) {
        if (admission === 'published') {
          await publishSnapshot()
        }
        heldNextDraft = holdRead()
      }
      return { ...(published ? { publishedMessageSequence: 2 } : { pendingInputId: 'queued-next' }),
        agentRunIds: [], campTurnId: null, addressedAgentIds: ['agent_2'] }
    }
    const beforeSendReads = draftReads()
    const pressEnter = () => editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    pressEnter()
    await until(() => heldNextDraft !== null && nextRead === null, 'Send must initialize the next authoritative route')
    check(editor().getAttribute('aria-disabled') === 'true' && !editor().isContentEditable,
      'A fast next keystroke must not freeze a null route before the next Draft is initialized')
    pressEnter()
    await flush()
    check(sends === 1, 'A second send must wait for the route initialization')
    heldNextDraft!.resolve(nextDraft)
    await until(() => editor().getAttribute('aria-disabled') !== 'true' && continuation() === '继续发给 芝士',
      'The next editor must restore the non-Lead route')
    check(draftReads() === beforeSendReads + 1, 'Route initialization must not trigger a duplicate publication read')
    if (admission === 'published-lagging') {
      await publishSnapshot()
      check(draftReads() === beforeSendReads + 1, 'A late public projection must reuse the already initialized route')
    }
    editor().focus()
    document.execCommand('insertText', false, '第二条还是给芝士')
    await until(() => savedContinuationSources.length === 2, 'The second Draft must autosave')
    check(savedContinuationSources[1] === source, 'A quick following Draft must persist the initialized continuation source')
    pressEnter()
    await until(() => sends === 2 && editor().getAttribute('aria-disabled') !== 'true', 'The second send must complete')
  }
  cases.push('delayed next-Draft initialization preserves the recipient across two quick sends')

  flushSync(() => root!.unmount())
  root = createRoot(document.getElementById('root')!)
  const activations: string[] = []
  const markdown = '# 标题\n\n[跳转](#标题)\n\n打开 [README](./README.md)\n\n![image](./image.png)'
  const asset = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
  const firstImage = () => `${asset}#first`
  const drawMarkdown = (label: string, localImageUrl = firstImage, content = markdown) => {
    flushSync(() => root!.render(<SafeMarkdown
      onFileReference={(reference) => activations.push(`${label}:${reference}`)}
      onHeadingTargetResult={(found) => activations.push(`${label}:heading:${found}`)}
      localImageUrl={localImageUrl}>{content}</SafeMarkdown>))
  }
  drawMarkdown('old')
  await flush()
  const fileLink = document.querySelector<HTMLElement>('.markdown-file-reference')!
  check(fileLink, 'Markdown must render its file link')
  drawMarkdown('latest')
  await flush()
  check(document.querySelector('.markdown-file-reference') === fileLink, 'Unchanged Markdown must retain its rendered tree when callbacks change')
  fileLink.click()
  document.querySelector<HTMLAnchorElement>('.safe-markdown a[href^="#"]:not(.markdown-file-reference)')!.click()
  check(activations.join(',') === 'latest:./README.md,latest:heading:true', 'Cached links must invoke the latest file and heading callbacks')
  drawMarkdown('latest', () => `${asset}#second`)
  check(document.querySelector('img')?.getAttribute('src') === `${asset}#second`, 'A changed image projection must update cached Markdown')
  drawMarkdown('latest', firstImage, 'Updated [App](src/app.ts)')
  check(document.querySelector('.markdown-file-reference')?.getAttribute('title') === 'src/app.ts', 'Changed Markdown content must be reparsed')
  cases.push('Markdown caching preserves fresh callbacks, image authority and changed content')
  await flush()
  return { ok: true, cases }
}, async pendingAttachments() { return { ok: true, cases: await runPendingAttachmentCases() } } } })

// The same isolated production-Renderer fixture can also run in a browser when
// the host cannot initialize a nested Electron sandbox. This is not native IPC coverage.
const browserMode = new URLSearchParams(location.search)
if (browserMode.has('browser')) {
  const runBrowserFixture = async () => {
    if (browserMode.get('browser') === 'review') {
      document.documentElement.dataset.theme = browserMode.get('theme') === 'night' ? 'night' : 'day'
      await setupPendingAttachments()
      await beginPending()
      dragFiles(pendingEditor(), [imageFile(), textFile('项目补充说明与下一轮排队消息需要使用的文件.txt')])
      await until(() => pendingReady() && pendingCards().length === 4, 'Review attachments must be ready')
      return
    }
    const report = document.createElement('pre')
    document.body.append(report)
    try {
      const fixture = (window as unknown as { continuationTest: { run(): Promise<unknown>; pendingAttachments(): Promise<unknown> } }).continuationTest
      const result = await (browserMode.get('browser') === 'pending' ? fixture.pendingAttachments() : fixture.run())
      report.textContent = JSON.stringify(result, null, 2)
    } catch (error) {
      report.textContent = String(error instanceof Error ? error.stack : error)
    }
  }
  void runBrowserFixture()
}
