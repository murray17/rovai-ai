import { createReviewModel } from '../../../scripts/fixtures/host-web-parity/model'
import { initial, run as runTemplate, agents as agentTemplates, initialDraft, installations } from '../../../scripts/fixtures/host-web-parity/data'
export { installations }

export const profiles = ['爱丽丝', '奥黛丽', '雾切响子', '药师寺惠'].map((name, i) => ({
  ...structuredClone(agentTemplates[i % 2]), agentId: `presence-member-${i}`, displayName: name,
  avatarRef: null, memberOrder: i, teamRole: ['架构与实现', '交互与前端', '独立审核', '测试与验证'][i],
  professionalResponsibilities: ['理解系统边界，整合实现。', '设计并实现清晰一致的界面。', '独立核对设计与实现。', '检查流程、边界与恢复。'][i],
  runtimeConfiguration: { ...structuredClone(agentTemplates[0].runtimeConfiguration), model: { mode: 'runtime_default' } }
}))
export const scenarios: Record<string, { name: string; steps: string[]; descriptions: string[] }> = {
  stream: { name: '流式正文与命令', steps: ['流式正文', '执行命令', '首次回复', '继续流式', '执行结束'],
    descriptions: ['正文逐字更新，满一行后省略，不横向滚动。', '命令保持单行，点击查看完整过程。', '紧接同一个 Run 的回复，不重复头像。', '继续处理仍在当前回复下方，单行展示。', '执行结束，占位直接收起。'] },
  parallel: { name: '两位队员并行', steps: ['已发送', '处理中', '一位回复', '两位回复', '全部结束'],
    descriptions: ['输入已发送，排队阶段不占位。', '爱丽丝已开始执行，奥黛丽仍排队，不占位。', '奥黛丽先回复；爱丽丝的占位仍留在原处。', '爱丽丝继续处理，与同一个 Run 的最新回复衔接。', '所有执行结束，占位收起。'] },
  single: { name: '同一队员连续回复', steps: ['已发送', '处理中', '首次回复', '再次回复', '执行结束'],
    descriptions: ['排队不占位。', '执行卡正文逐字流出，保持单行。', '首次回复下方另起一行显示执行命令。', '第二条回复追加，执行正文跟随最新回复。', '结束后不留下完成行。'] },
  interleaved: { name: '其他队员插入消息', steps: ['已发送', '处理中', '首次回复', '他人插话', '再次回复', '执行结束'],
    descriptions: ['等待期间不预占会话。', '执行内容显示在最新消息下面。', '同一 Run 的回复和占位衔接，不重复头像。', '另一位队员插话后，本 Run 的占位仍留在自己回复下方。', '本 Run 再次回复后，收起重复头像，继续向下展示。', '执行结束，占位收起。'] },
  same_member: { name: '同一队员不同 Run', steps: ['处理中', '首次回复', '另一 Run 回复', '本 Run 再回复', '执行结束'],
    descriptions: ['本次执行正在进行。', '本 Run 已回复，后续占位无需头像。', '另一 Run 的回复插入，本 Run 的占位保持原位。', '本 Run 再次回复，重新衔接为无头像的占位。', '不留下完成行。'] },
  followup: { name: '运行中追加两条输入', steps: ['正在处理', '追加输入', '继续追加', '领取新输入', '全部结束'],
    descriptions: ['前一次执行仍在进行。', '新输入排队，已有占位保持原位。', '继续追加也不重复占位。', '下一次执行实际开始后才出现占位。', '两次执行分别结束，占位收起。'] },
  failed: { name: '执行异常', steps: ['已发送', '处理中', '执行中断'],
    descriptions: ['先确认本次输入已经被接受。', '处理中的状态不承诺完成时间。', '中断后可查看原因，也可以直接重试本次请求。'] },
  silent: { name: '结束但没有公开回复', steps: ['已发送', '处理中', '执行结束'],
    descriptions: ['队员接到了本次输入。', '执行过程与公开回复分别展示。', '结束即收起占位，执行记录仍可从顶栏查看。'] }
}
const baseTime = Date.now() - 54_000
const at = (seconds: number) => new Date(baseTime + seconds * 1000).toISOString()
const aid = (index: number) => profiles[index].agentId
export function makeMessage(id: string, sequence: number, body: string, author = -1, sourceAgentRunId: string | null = null, seconds = sequence * 8): any {
  const content = body.split(/(@爱丽丝|@奥黛丽|@雾切响子|@药师寺惠)/g).filter(Boolean).map(text => {
    const member = profiles.find(p => text === `@${p.displayName}`)
    return member ? { kind: 'member_mention', agentId: member.agentId } : { kind: 'text', text }
  })
  return { id, sequence, timelineGlobalSequence: null, authorType: author < 0 ? 'user' : 'agent',
    authorId: author < 0 ? 'local_user' : aid(author), sourceAgentRunId, body,
    content, quotes: [], attachments: [], addressMode: 'explicit',
    addressedAgentIds: author < 0 ? [aid(0)] : [], replyToThreadMessageId: null, threadTurnId: null,
    presentation: null, withdrawn: false, canWithdraw: false, version: 1, createdAt: at(seconds),
    runtimeModel: author < 0 ? null : { adapterKind: 'codex-cli', modelId: null, reasoningEffort: null } }
}
function delivery(id: string, messageId: string, agentId: string, targetAgentRunId: string | null, status = 'waiting'): any {
  return { id, messageId, recipientAgentId: agentId, targetAgentRunId, status,
    threadTurnId: null, taskId: null, recipientMembershipVersionAtAdmission: 1,
    dispatchPhase: targetAgentRunId ? 'materialized' : 'attempted_waiting', waitCondition: targetAgentRunId ? null : 'target_busy',
    dispatchAttemptCount: 1, retryGeneration: 0, contextManifestId: null, manualInterventionRequired: false,
    failureCode: null, version: 1, createdAt: at(30), updatedAt: at(30), endedAt: null,
    deliveryKind: 'public_a2a', dispatchDisposition: 'dispatch', completionRole: 'required', gatherId: null,
    gatherDispatchDeliveryId: null, recipientCanonicalPosition: 0, edgeKind: 'forward', targetParentAgentRunId: null, returnToAgentRunId: null }
}
function makeRun(id: string, agent = 0, status = 'running', inputs = ['request-main'], seconds = 48): any {
  return { ...structuredClone(runTemplate), id, agentId: aid(agent), status, inputMessageIds: inputs,
    anchorMessageId: inputs.at(-1), inputSummary: '按现在的界面做一版队员占位，保留群聊的消息顺序。',
    purpose: '核对队员占位方案', threadTurnId: null, invocationKind: 'batch',
    a2aRootAgentRunId: id, runtimeModel: { modelId: null },
    createdAt: at(31), startedAt: at(34), updatedAt: at(seconds), endedAt: ['succeeded', 'failed', 'cancelled'].includes(status) ? at(seconds) : null,
    executionEvidenceCount: 3, executionEvidenceChangeSequence: 3,
    failure: status === 'failed' ? { code: 'runtime_disconnected', message: 'Runtime 连接中断。', retryable: true } : null }
}
function evidence(run: any, published = false): any[] {
  if (run.status === 'queued') return []
  const finish = ['succeeded', 'failed', 'cancelled'].includes(run.status)
  const commandActive = !finish && (state.scenario === 'stream' ? state.stage === 1 : !published && !['single','same_member'].includes(state.scenario) || published && state.scenario === 'single' && state.stage === 2)
  const events: any[] = [
    { id: `e-${run.id}-1`, agentRunId: run.id, executionEpoch: 1, sequence: 1,
      eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
      payload: { itemId: `n-${run.id}`, delta: '先核对当前会话、消息和输入框的结构，再检查多个队员同时回复时的顺序。\n\n同时确认执行内容能够随正文与命令更新，且不会影响原有复制和回复按钮。' },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: at(35) },
    { id: `e-${run.id}-2`, agentRunId: run.id, executionEpoch: 1, sequence: 2,
      eventType: commandActive ? 'activity.started' : 'activity.completed', kind: 'command', phase: commandActive ? 'started' : 'completed',
      payload: { item: { id: `tool-${run.id}`, type: 'commandExecution', command: 'rg -n "latestAgentMessageId|is-persistent|message-actions" apps/desktop/src/renderer/src/ThreadWorkspace.tsx apps/desktop/src/renderer/src/styles.css', status: commandActive ? 'inProgress' : 'completed',
        aggregatedOutput: commandActive ? '' : '演示记录\n已核对复制、回复按钮的显隐规则。\n保留公开消息的原始顺序。' } },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: at(38) },
    { id: `e-${run.id}-3`, agentRunId: run.id, executionEpoch: 1, sequence: 3,
      eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
      payload: { itemId: `n2-${run.id}`, delta: run.status === 'failed' ? '运行连接中断。保留本次执行记录。' : finish ? '本次检查结束。' : published ? '继续检查消息衔接。刚才已经发出一条回复，接下来确认其他队员插话时，占位仍留在自己的消息之后。\n\n我会按 Run 判断是否重复头像，再检查原有复制和回复按钮、键盘操作以及窄窗口下的表现。' : '我先看看现在的消息结构，确认队员回复和执行内容怎样衔接。\n\n这行正文会随着处理持续更新，满一行后省略，不横向滚动；完整内容仍然保留在执行台里。接下来检查多个队员同时处理时的消息顺序。' },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: at(43) }
  ]
  return commandActive ? events.slice(0, 2) : events
}
const backing = createReviewModel('desktop', 'camp')
const listeners = new Set<() => void>()
const timers = new Set<ReturnType<typeof setTimeout>>()
const initialScenario = new URLSearchParams(location.search).get('scenario') || 'stream'
const initialStage = new URLSearchParams(location.search).get('stage')
let state: any = { scenario: scenarios[initialScenario] ? initialScenario : 'stream', stage: initialStage === null ? initialScenario === 'stream' ? 0 : 1 : Number(initialStage), generation: 0,
  snapshot: null, draft: { ...structuredClone(initialDraft), body: '', content: { version: 2, segments: [] } },
  busy: false, playing: false, streamPaused: false, stopId: null, note: '', version: 0 }
const update = (patch: any) => { state = { ...state, ...patch, version: state.version + 1 }; listeners.forEach(fn => fn()) }
let extraMessages: any[] = [], extraRuns: any[] = [], extraDeliveries: any[] = []
const stopped = new Map<string, any>()
const retries = new Map<string, { status: 'pending' | 'started'; runId: string; deliveryId: string }>()
// Only this browser fixture persists its simulated server records. Production
// derives hasAcceptedContinuation from Core's immutable continuation Delivery.
const persistenceKey = 'run-presence-acceptance-server'
let stopTrigger: HTMLElement | null = null
let playTimer: ReturnType<typeof setTimeout> | null = null
let serial = 0
let liveSequence = 100
const later = (fn: () => void, ms: number) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id) }

function snapshot() {
  const s = state.stage, kind = state.scenario
  const value: any = { ...structuredClone(initial), thread: { ...initial.thread, title: '队员在会话中的占位', projectPath: '/prototype/rovai-ai', defaultLeadAgentId: aid(0) },
    members: profiles.map((p, i) => ({ agentId: p.agentId, displayName: p.displayName, avatarRef: null, teamRole: p.teamRole,
      accent: p.accent, membershipStatus: 'active', profilePresence: 'present', memberOrder: i, isDefaultLead: i === 0, version: 1, leaveRequestedAt: null })),
    messages: [makeMessage('history-user', 1, '消息发出去以后，我想在会话里直接知道队员有没有接到。'),
      makeMessage('history-alice', 2, '明白。我会保留现在的消息、输入框和执行台，让实际开始处理的队员在会话里被看见。', 0),
      makeMessage('request-main', 3, kind === 'parallel' ? '@爱丽丝 @奥黛丽 看看这个占位方案，按现有界面做一版。' : '@爱丽丝 按现在的界面做一版队员占位，保留群聊的消息顺序。', -1, null, 30)],
    agentRuns: [], messageDeliveries: [], executionEvidence: [], turns: [], approvals: [] }
  value.messages[2].addressedAgentIds = kind === 'parallel' ? [aid(0), aid(1)] : [aid(0)]
  value.messages[0].addressedAgentIds = []
  const addReply = (id: string, seq: number, body: string, author = 0, runId = 'run-alice') => value.messages.push(makeMessage(id, seq, body, author, runId, seq * 12))
  let aStatus = s === scenarios[kind].steps.length - 1 ? 'succeeded' : 'running'
  if (kind === 'failed' && s === 2) aStatus = 'failed'
  if (kind === 'silent' && s === 2) aStatus = 'succeeded'
  if (s > 0 || ['followup', 'stream', 'same_member'].includes(kind)) value.agentRuns.push(makeRun('run-alice', 0, aStatus))
  value.messageDeliveries.push(delivery('delivery-alice', 'request-main', aid(0), value.agentRuns.length ? 'run-alice' : null, value.agentRuns.length ? 'running' : 'waiting'))
  if (kind === 'parallel') {
    value.messageDeliveries.push(delivery('delivery-audrey', 'request-main', aid(1), s >= 1 ? 'run-audrey' : null, s >= 2 ? 'running' : 'waiting'))
    if (s === 1) value.agentRuns.push({ ...makeRun('run-audrey', 1, 'queued'), startedAt: null })
    if (s >= 2) {
      value.agentRuns.push(makeRun('run-audrey', 1, s >= 3 ? 'succeeded' : 'running'))
      addReply('reply-audrey', 4, '建议沿用队员自己的头像和姓名，下面只放一行执行内容。\n\n回复出现后，继续使用现在的消息气泡。', 1, 'run-audrey')
    }
    if (s >= 3) addReply('reply-alice', 5, '我核对了现有组件。正在处理的占位只会跟随自己发出的消息；谁先回复，就先显示谁的消息。')
    if (s >= 4) addReply('reply-alice-2', 6, '交互稿已整理好。正文流式、并行、连续回复和插话状态都能切换查看。')
  } else if (kind === 'stream') {
    if (s >= 2) addReply('reply-alice', 4, '先确认了一点：保留现在的消息和操作按钮，只把执行中的内容接到会话末尾。')
    if (s >= 4) addReply('reply-alice-2', 5, '这次检查完成了。占位已收起，公开回复继续保留在原来的顺序里。')
  } else if (kind === 'same_member') {
    if (s >= 1) addReply('reply-alice', 4, '这一条是当前 Run 的公开回复，我还会继续检查。')
    if (s >= 2) {
      value.agentRuns.push(makeRun('run-alice-other', 0, 'succeeded'))
      addReply('reply-alice-other', 5, '这是我另一次 Run 发来的结果。', 0, 'run-alice-other')
    }
    if (s >= 3) addReply('reply-alice-2', 6, '回到原来这次 Run，继续确认消息的衔接和头像。')
  } else if (kind === 'single' || kind === 'interleaved') {
    if (s >= 2) addReply('reply-alice', 4, '我先核对了当前的消息布局。可以在回复出现之前，显示队员的头像、姓名和处理状态。')
    if (kind === 'interleaved' && s >= 3) addReply('reply-review', 5, '这里要保留每条公开消息的先后顺序，后来的回复不要挪回旧位置。', 2, 'historical-review')
    if (s >= (kind === 'interleaved' ? 4 : 3)) addReply('reply-alice-2', 6, '这条是同一次执行的后续回复。前面的消息继续保留，执行入口跟随最新回复。')
  } else if (kind === 'followup') {
    if (s >= 1) value.messages.push(makeMessage('followup-1', 4, '也看看运行中继续发消息时，会不会重复出现同一个队员。', -1, null, 45))
    if (s >= 2) value.messages.push(makeMessage('followup-2', 5, '还有，没有发出回复就结束时，要留个明确状态。', -1, null, 48))
    if (s >= 1) value.messageDeliveries.push(delivery('delivery-followup-1', 'followup-1', aid(0), s >= 3 ? 'run-alice-next' : null, s >= 3 ? 'running' : 'waiting'))
    if (s >= 2) value.messageDeliveries.push(delivery('delivery-followup-2', 'followup-2', aid(0), s >= 3 ? 'run-alice-next' : null, s >= 3 ? 'running' : 'waiting'))
    if (s >= 3) {
      value.agentRuns[0].status = 'succeeded'; value.agentRuns[0].endedAt = at(55)
      addReply('reply-alice', 6, '第一版已核对。接着处理你刚追加的两个问题。')
      value.agentRuns.push(makeRun('run-alice-next', 0, s >= 4 ? 'succeeded' : 'running', ['followup-1', 'followup-2'], 70))
      value.agentRuns.at(-1).inputSummary = '检查追加输入和没有公开回复的结束状态。'
    }
    if (s >= 4) addReply('reply-followup', 7, '追加的两条输入等待时不占位，实际开始后才显示下一次执行。结束后占位直接收起。', 0, 'run-alice-next')
  }
  value.messages.push(...extraMessages)
  value.agentRuns.push(...extraRuns)
  value.messageDeliveries.push(...extraDeliveries)
  value.agentRuns = value.agentRuns.map((r: any) => stopped.has(r.id) ? { ...r, ...stopped.get(r.id).run } : r)
  value.agentRuns = value.agentRuns.map((r: any) => ({ ...r, hasAcceptedContinuation: !controls.holdContinuationProjection
    && extraDeliveries.some(d => d.continuationRequest && d.sourceAgentRunId === r.id) }))
  value.messages = value.messages.filter((m: any) => !stopped.has(m.sourceAgentRunId) || stopped.get(m.sourceAgentRunId).publishedIds.includes(m.id))
  value.executionEvidence = value.agentRuns.flatMap((run: any) => evidence(run, value.messages.some((m: any) => m.authorType === 'agent' && m.sourceAgentRunId === run.id)))
  value.agentRuns.forEach((run: any) => { const count = value.executionEvidence.filter((e: any) => e.agentRunId === run.id).length; run.executionEvidenceCount = count; run.executionEvidenceChangeSequence = count })
  value.messages.sort((a: any, b: any) => a.sequence - b.sequence)
  value.throughGlobalSequence = value.messages.length
  // Local presentation metadata; the failed Run remains in execution history.
  value.prototypeRetries = Object.fromEntries(retries)
  return value
}
const streams = new Map<string, { full: string; shown: number }>()
// Simulated evidence really grows over time. Both the Run card and the inline
// row consume these same partial records; no decorative typewriter overlay.
function seedStreams(value: any) {
  for (const run of value.agentRuns) {
    if (run.status !== 'running') continue
    const tail = value.executionEvidence.filter((e: any) => e.agentRunId === run.id).at(-1)
    if (tail?.kind !== 'narration') continue
    const full = tail.payload.delta
    if (!streams.has(tail.id) || streams.get(tail.id)!.full !== full) streams.set(tail.id, { full, shown: 6 })
    const entry = streams.get(tail.id)!
    tail.payload = { ...tail.payload, delta: full.slice(0, entry.shown) }
  }
  return value
}
const refresh = () => {
  const value = seedStreams(snapshot())
  update({ snapshot: value, stopId: value.agentRuns.some((r: any) => r.id === state.stopId && ['running','waiting'].includes(r.status)) ? state.stopId : null })
  if (controls.persistServer) sessionStorage.setItem(persistenceKey, JSON.stringify({
    scenario: state.scenario, stage: state.stage, serial, extraMessages, extraRuns, extraDeliveries,
    retries: [...retries], holdDispatch: controls.holdDispatch
  }))
}
function streamTick() {
  if (document.hidden || state.streamPaused) return
  let changed = false
  const evidence = state.snapshot.executionEvidence.map((item: any) => {
    const entry = streams.get(item.id)
    if (!entry || entry.shown >= entry.full.length || !state.snapshot.agentRuns.some((r: any) => r.id === item.agentRunId && r.status === 'running')) return item
    entry.shown = Math.min(entry.full.length, entry.shown + 2)
    changed = true
    return { ...item, revision: (item.revision || 0) + 1, payload: { ...item.payload, delta: entry.full.slice(0, entry.shown) } }
  })
  if (changed) update({ snapshot: { ...state.snapshot, executionEvidence: evidence } })
}
const halt = () => { if (playTimer) clearTimeout(playTimer); playTimer = null; update({ playing: false }) }
function localSend(body: string, recipients = [aid(0)], draft?: any) {
  const number = ++serial, id = `local-${number}`, seq = ++liveSequence
  const msg = makeMessage(id, seq, body, -1, null, 100 + number * 5)
  msg.addressedAgentIds = recipients
  if (draft) { msg.content = draft.content.segments; msg.attachments = draft.attachments; msg.quotes = draft.quotes }
  extraMessages.push(msg)
  for (const agentId of recipients) extraDeliveries.push(delivery(`local-delivery-${number}-${agentId}`, id, agentId, null))
  refresh()
  later(() => {
    for (const agentId of recipients) {
      const runId = `local-run-${number}-${agentId}`
      const r = makeRun(runId, profiles.findIndex(p => p.agentId === agentId), 'running', [id], 112 + number * 5)
      r.inputSummary = body; r.startedAt = at(102 + number * 5)
      extraRuns.push(r)
      extraDeliveries = extraDeliveries.map(d => d.messageId === id && d.recipientAgentId === agentId ? { ...d, status: 'running', targetAgentRunId: runId } : d)
    }
    refresh()
  }, 1400)
  later(() => {
    for (const agentId of recipients) {
      const runId = `local-run-${number}-${agentId}`
      if (stopped.has(runId)) continue
      extraMessages.push(makeMessage(`${id}-reply-${agentId}`, ++liveSequence,
        '已收到。这是一条演示回复；占位现在收起，后续消息会继续追加在会话里。', profiles.findIndex(p => p.agentId === agentId), runId, 116 + number * 5))
      extraRuns = extraRuns.map(r => r.id === runId ? { ...r, status: 'succeeded', updatedAt: at(122 + number * 5), endedAt: at(122 + number * 5) } : r)
    }
    refresh()
  }, 4600)
}
const executionReadMode = new URLSearchParams(location.search).get('executionRead')
const invalidationListeners = new Set<() => void>()
const controls = { holdContinue: false, holdStop: false, holdDispatch: false, holdContinuationProjection: false, holdEntrySnapshot: false,
  failNextExecutionPage: executionReadMode === 'fail', holdExecutionPage: executionReadMode === 'hold',
  holdExecutionChanges: false, liveEvidence: false,
  persistServer: false, continuationMode: 'normal', stopError: false,
  executionReads: [] as any[],
  continueAttempts: [] as any[], stopAttempts: [] as any[], receipts: new Map<string, any>() }
export const model = {
  controls,
  resync: () => invalidationListeners.forEach(listener => listener()),
  async cancel(run: any) {
    controls.stopAttempts.push({ id: run.id, version: run.version })
    while (controls.holdStop) await new Promise(resolve => setTimeout(resolve, 20))
    if (controls.stopError) throw new Error('Simulated stop transport failure')
    model.stop(run.id)
  },
  get: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
  note: (note: string) => update({ note }),
  showStartupStatus(waitReason: 'runtime_initializing' | null) {
    update({ streamPaused: true, snapshot: { ...state.snapshot,
      agentRuns: state.snapshot.agentRuns.map((run: any) => run.id === 'run-alice' ? { ...run, waitReason } : run),
      executionEvidence: state.snapshot.executionEvidence.filter((item: any) => item.agentRunId !== 'run-alice')
    } })
  },
  showNarration(text: string) {
    const evidence = state.snapshot.executionEvidence.map((item: any) => item.id === 'e-run-alice-3'
      ? { ...item, revision: (item.revision || 0) + 1, payload: { ...item.payload, delta: text } } : item)
    update({ streamPaused: true, snapshot: { ...state.snapshot, executionEvidence: evidence } })
  },
  setStage(stage: number) { halt(); streams.clear(); update({ streamPaused: false, stage: Math.max(0, Math.min(scenarios[state.scenario].steps.length - 1, stage)) }); refresh() },
  setScenario(scenario: string) {
    if (!scenarios[scenario]) return
    controls.persistServer = false; controls.holdDispatch = false; controls.holdContinuationProjection = false; controls.holdEntrySnapshot = false
    sessionStorage.removeItem(persistenceKey)
    halt(); timers.forEach(clearTimeout); timers.clear(); streams.clear(); extraMessages = []; extraRuns = []; extraDeliveries = []; stopped.clear(); retries.clear(); liveSequence = 100; stopTrigger = null
    update({ scenario, stage: ['followup','stream','same_member'].includes(scenario) ? 0 : 1, streamPaused: false, stopId: null, generation: state.generation + 1, note: '' }); refresh()
  },
  reset() { this.setScenario(state.scenario); this.setStage(0) },
  play() {
    if (state.playing) { halt(); update({ streamPaused: true }); return }
    if (state.stage === scenarios[state.scenario].steps.length - 1) this.setStage(0)
    update({ playing: true, streamPaused: false })
    const step = () => {
      if (!state.playing) return
      if (state.stage >= scenarios[state.scenario].steps.length - 1) { update({ playing: false }); return }
      streams.clear(); update({ stage: state.stage + 1 }); refresh(); playTimer = setTimeout(step, 6500)
    }
    playTimer = setTimeout(step, 6500)
  },
  requestStop(id: string | null, trigger?: HTMLElement) {
    if (id && !state.snapshot.agentRuns.some((r: any) => r.id === id && ['running','waiting'].includes(r.status))) return
    if (id) { halt(); stopTrigger = trigger ?? null }
    update({ stopId: id })
  },
  restoreStopFocus() { if (stopTrigger?.isConnected) stopTrigger.focus() },
  stop(id: string) {
    if (!state.snapshot.agentRuns.some((r: any) => r.id === id && ['running','waiting'].includes(r.status))) { update({ stopId: null }); return }
    halt(); stopped.set(id, { run: { status: 'cancelled', endedAt: new Date().toISOString(), cancelReasonCode: 'user_requested_agent_run_stop', cancelRequestedAt: new Date().toISOString() },
      publishedIds: state.snapshot.messages.filter((m: any) => m.sourceAgentRunId === id).map((m: any) => m.id) })
    refresh()
  },
  retry(id: string) {
    const source = state.snapshot.agentRuns.find((r: any) => r.id === id)
    if (!source || !['failed','cancelled'].includes(source.status) || source.failure?.retryable === false) return null
    halt()
    const runId = `retry-run-${++serial}`, deliveryId = `retry-delivery-${serial}`
    extraDeliveries.push({ ...delivery(deliveryId, source.inputMessageIds[0], source.agentId, null),
      continuationRequest: true, sourceAgentRunId: id, inputMessageIds: [...source.inputMessageIds] })
    retries.set(id, { status: 'pending', runId, deliveryId }); refresh()
    scheduleRetry(source, runId, deliveryId)
    return deliveryId
  },
  failRun(id: string) {
    extraRuns = extraRuns.map(r => r.id === id ? { ...r, status: 'failed', endedAt: new Date().toISOString(),
      failure: { code: 'runtime_disconnected', message: 'Runtime 连接中断。', retryable: true } } : r)
    refresh()
  },
  async send(draft: any) {
    const recipients = profiles.filter(p => draft.body.includes(`@${p.displayName}`)).map(p => p.agentId)
    if (!recipients.length) recipients.push(aid(0))
    localSend(draft.body || '请查看附件。', recipients, draft)
    return { threadTurnId: null, agentRunIds: [], deliveryIds: extraDeliveries.slice(-recipients.length).map(d => d.id), addressedAgentIds: recipients }
  },
  rename(title: string) { update({ snapshot: { ...state.snapshot, thread: { ...state.snapshot.thread, title } } }) },
  async changeLead(agentId: string) { update({ snapshot: { ...state.snapshot, thread: { ...state.snapshot.thread, defaultLeadAgentId: agentId }, members: state.snapshot.members.map((m: any) => ({ ...m, isDefaultLead: m.agentId === agentId })) } }) },
  fileApi: backing.fileApi,
  client: { ...backing.client,
    onInvalidated: (listener: () => void) => { invalidationListeners.add(listener); return () => invalidationListeners.delete(listener) },
    request: async (method: string, input: any = {}): Promise<any> => {
      if (['agentRunExecution.page', 'agentRunExecution.changes', 'agentRunEvidence.getContent'].includes(method))
        controls.executionReads.push({ method, ...input })
      if (method === 'members.list') return profiles
      if (method === 'agentRunExecution.page' || method === 'agentRunExecution.changes') {
        if (method === 'agentRunExecution.page' && controls.failNextExecutionPage) {
          controls.failNextExecutionPage = false
          throw new Error('Simulated transient execution read failure')
        }
        const all = state.snapshot.executionEvidence.filter((e: any) => e.agentRunId === input.agentRunId)
        const blocks = all.map((e: any) => ({ key: e.id, kind: e.kind === 'command' ? 'toolGroup' : 'item',
          sequence: e.sequence, lastSequence: e.sequence, changeSequence: state.version, toolCount: e.kind === 'command' ? 1 : 0,
          counts: { completed: 0, failed: 0, stopped: 0, recorded: 0, running: e.kind === 'command' ? 1 : 0, waiting: 0 },
          evidence: [structuredClone(e)] }))
        const common = { schemaVersion: 3, threadId: state.snapshot.thread.id, agentRunId: input.agentRunId,
          throughSequence: all.at(-1)?.sequence ?? 0, throughChangeSequence: state.version }
        if (method === 'agentRunExecution.changes') {
          const response = { ...common,
          requestedAfterChangeSequence: input.afterChangeSequence, nextAfterChangeSequence: state.version,
          blocks: blocks.slice(-1), refreshedBlocks: [], hasMore: false }
          while (controls.holdExecutionChanges) await new Promise(resolve => setTimeout(resolve, 20))
          return response
        }
        const before = input.beforeSequence ?? null
        const eligible = blocks.filter((b: any) => before === null || b.sequence < before)
        const page = eligible.slice(-(input.limit ?? 24)), hasMore = eligible.length > page.length
        const response = { ...common, requestedBeforeSequence: before, blocks: page, hasMore,
          nextBeforeSequence: hasMore ? page[0].sequence : null }
        while (controls.holdExecutionPage) await new Promise(resolve => setTimeout(resolve, 20))
        return response
      }
      if (method === 'agentRuns.continue') {
        controls.continueAttempts.push(structuredClone(input))
        while (controls.holdContinue) await new Promise(resolve => setTimeout(resolve, 20))
        if (controls.receipts.has(input.commandId)) return controls.receipts.get(input.commandId)
        if (controls.continuationMode === 'reject') return { commandId: input.commandId, status: 'rejected', payload: {} }
        const result = { commandId: input.commandId, status: 'applied', payload: { threadId: state.snapshot.thread.id, deliveryId: model.retry(input.command?.agentRunId) } }
        controls.receipts.set(input.commandId, result)
        if (controls.continuationMode === 'response-lost') throw new Error('Simulated lost receipt')
        return result
      }
      if (method === 'thread.messages.anchors') {
        const items = state.snapshot.messages.filter((m: any) => m.authorType === 'user').map((m: any) => ({
          messageId: m.id, sequence: m.sequence, title: m.body.replace(/\s+/g, ' ').slice(0, 80), messageVersion: m.version }))
        return { schemaVersion: 1, throughGlobalSequence: state.version, threadId: state.snapshot.thread.id, totalCount: items.length, items }
      }
      if (method === 'thread.messages.anchorPreview') return { schemaVersion: 1, threadId: state.snapshot.thread.id, messageId: input.messageId, throughGlobalSequence: state.version, sourceAvailable: true, firstReply: null }
      if (method === 'threads.members.fast.set') return { status: 'applied', payload: {} }
      if (method === 'threads.messages.around') return { schemaVersion: 1, threadId: state.snapshot.thread.id, anchorMessageId: input.messageId,
        messages: state.snapshot.messages, hasEarlier: false, hasLater: false }
      if (method === 'agentRunEvidence.getContent') {
        const e = state.snapshot.executionEvidence.find((x: any) => x.id === input.evidenceId)
        return { payload: e?.payload || {}, canonical: e?.canonical || null }
      }
      if (method === 'agentRunEvidence.list') {
        const es = state.snapshot.executionEvidence.filter((e: any) => e.agentRunId === input.agentRunId)
        return { schemaVersion: 1, agentRunId: input.agentRunId, evidence: es, hasMore: false, throughSequence: es.length, nextAfterSequence: es.length }
      }
      return backing.client.request(method as never, input)
    }
  }
}
function scheduleRetry(source: any, runId: string, deliveryId: string) {
  const start = () => {
    if (controls.holdDispatch) { later(start, 100); return }
    const agentIndex = profiles.findIndex(p => p.agentId === source.agentId)
    const run = makeRun(runId, agentIndex, 'running', [...source.inputMessageIds])
    const now = new Date().toISOString()
    Object.assign(run, { inputSummary: source.inputSummary, anchorMessageId: source.anchorMessageId, createdAt: now, startedAt: now, updatedAt: now })
    extraRuns.push(run)
    extraDeliveries = extraDeliveries.map(d => d.id === deliveryId ? { ...d, status: 'running', targetAgentRunId: runId } : d)
    retries.set(source.id, { status: 'started', runId, deliveryId }); refresh()
    later(() => {
      if (stopped.has(runId) || extraRuns.find(r => r.id === runId)?.status !== 'running') return
      const endedAt = new Date().toISOString()
      extraMessages.push({ ...makeMessage(`${runId}-reply`, ++liveSequence,
        '已继续检查刚才的请求。占位跟随最新消息，原有回复和复制、回复按钮的显示规则都保留。', agentIndex, runId), createdAt: endedAt })
      extraRuns = extraRuns.map(r => r.id === runId ? { ...r, status: 'succeeded', updatedAt: endedAt, endedAt } : r)
      extraDeliveries = extraDeliveries.map(d => d.id === deliveryId ? { ...d, status: 'succeeded', endedAt } : d)
      refresh()
    }, 3500)
  }
  later(start, 1100)
}

const savedServer = sessionStorage.getItem(persistenceKey)
if (savedServer) {
  const saved = JSON.parse(savedServer)
  Object.assign(state, { scenario: saved.scenario, stage: saved.stage })
  serial = saved.serial; extraMessages = saved.extraMessages; extraRuns = saved.extraRuns; extraDeliveries = saved.extraDeliveries
  for (const [sourceId, record] of saved.retries) retries.set(sourceId, record)
  controls.persistServer = true; controls.holdDispatch = saved.holdDispatch
}
refresh()
for (const [sourceId, record] of retries) if (record.status === 'pending')
  scheduleRetry(state.snapshot.agentRuns.find((r: any) => r.id === sourceId), record.runId, record.deliveryId)
const streamingTimer = setInterval(streamTick, 90)
addEventListener('pagehide', () => clearInterval(streamingTimer), { once: true })
document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) halt() })
