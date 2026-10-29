import { languageTestApi } from './interface-language-test-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunView, ThreadMessageView } from '@contracts'
import { conversationRunPresenceTimeline, formatRunPresenceDuration, runPresenceElapsedSeconds, runPresencePreview } from './conversation-run-presence'
import type { ThreadConversationTimelineItem } from './ThreadWorkspace'
import type { LiveRuntimeEvent } from './ui-model'
import { changeInterfaceLanguage } from './interface-language'
import type { GeneralPreferencesApi } from '@contracts'

const run = (id: string, agentId = id, patch: Partial<AgentRunView> = {}): AgentRunView => ({
  id, agentId, status: 'running', invocationKind: 'batch', createdAt: '2026-10-10T12:00:00Z',
  startedAt: '2026-10-10T12:00:01Z', cancelRequestedAt: null, failure: null, inputMessageIds: ['message-1'],
  anchorMessageId: 'message-1', publicTailSequenceAtStart: 1, executionEpoch: 1, ...patch
} as AgentRunView)
const message = (sequence: number, sourceAgentRunId: string | null, patch: Partial<ThreadMessageView> = {}): ThreadConversationTimelineItem => ({
  kind: 'camp_message', id: patch.id ?? 'message-' + sequence, createdAt: '2026-10-10T12:00:00Z', runtimeImageGroups: [],
  message: { id: 'message-' + sequence, sequence, sourceAgentRunId, authorType: sourceAgentRunId ? 'agent' : 'user',
    withdrawn: false, createdAt: '2026-10-10T12:00:00Z', ...patch } as ThreadMessageView
})
const project = (runs: AgentRunView[], timeline: ThreadConversationTimelineItem[], ready = true) =>
  conversationRunPresenceTimeline(timeline, runs, ready)
const order = (runs: AgentRunView[], timeline: ThreadConversationTimelineItem[]) => project(runs, timeline).map(item => item.id)
const slots = (runs: AgentRunView[], timeline: ThreadConversationTimelineItem[] = [], ready = true) =>
  project(runs, timeline, ready).flatMap(item => item.kind === 'run_presence' ? [[item.slot.run.id, item.slot.continuation]] : [])

describe('conversation Run presence', () => {
  it('pins parallel Runs before their own send and advances only the successful sender', () => {
    const a = run('a'), b = run('b'), start = [message(1, null)]
    expect(order([b,a], start)).toEqual(['message-1','run-presence:a','run-presence:b'])
    const peerSend = [...start, message(2, 'b')]
    expect(order([a,b], peerSend)).toEqual(['message-1','run-presence:a','message-2','run-presence:b'])
    expect(slots([a,b], peerSend)).toEqual([['a',false],['b',true]])
    const ownSend = [...peerSend, message(3, 'a')]
    expect(order([a,b], ownSend)).toEqual(['message-1','message-2','run-presence:b','message-3','run-presence:a'])
    expect(order([a,b], [...ownSend, message(4, 'review')])).toEqual([
      'message-1','message-2','run-presence:b','message-3','run-presence:a','message-4'
    ])
    expect(order([a,b], [...ownSend, message(4, 'review'), message(5, 'a')])).toEqual([
      'message-1','message-2','run-presence:b','message-3','message-4','message-5','run-presence:a'
    ])
  })

  it('uses publication sequence and exact Run identity, excluding uncommitted or withdrawn output', () => {
    const a = run('a','alice')
    const messages = [message(1,null), message(2,'a'), message(3,'other-alice-run'),
      message(4,'a',{createdAt:'2000-01-01T00:00:00Z'}), message(5,'a',{withdrawn:true}),
      message(6,'a',{id:'optimistic:send'}), message(7,null)]
    expect(order([a],messages)).toEqual(['message-1','message-2','message-3','message-4','run-presence:a','message-5','optimistic:send','message-7'])
    expect(slots([a],messages)).toEqual([['a',true]])
    expect(order([a],[message(1,null),message(2,'other-alice-run'),message(3,null)])).toEqual([
      'message-1','run-presence:a','message-2','message-3'
    ])
  })

  it('restores the frozen start boundary across re-entry and late paged history', () => {
    const a = run('a')
    const later = message(2,'peer',{createdAt:'2026-10-10T12:05:00Z'})
    expect(order([a],[message(1,null),later,message(3,null)])).toEqual(['message-1','run-presence:a','message-2','message-3'])
    expect(order([a],[later])).toEqual(['run-presence:a','message-2'])
    expect(order([a],[message(2,'peer',{createdAt:'2000-01-01T00:00:00Z'})])).toEqual(['run-presence:a','message-2'])
    expect(order([a],[message(1,null),later])).toEqual(['message-1','run-presence:a','message-2'])
    for (const publicTailSequenceAtStart of [null, undefined]) {
      const legacy = run('legacy','alice',{publicTailSequenceAtStart})
      expect(order([legacy],[message(1,null),later])).toEqual(['message-1','run-presence:legacy','message-2'])
      expect(order([{...legacy,anchorMessageId:null}],[message(1,null),later])).toEqual(['message-1','run-presence:legacy','message-2'])
    }
  })

  it('starts a queued follow-up after the previous reply, then moves only on its own publication', () => {
    const next = run('next','alice',{inputMessageIds:['message-2'],anchorMessageId:'message-2',publicTailSequenceAtStart:3})
    const beforeStart = [message(1,null),message(2,null),message(3,'previous')]
    expect(order([next],beforeStart)).toEqual(['message-1','message-2','message-3','run-presence:next'])
    expect(slots([next],beforeStart)).toEqual([['next',false]])
    // Later messages, including a clock rollback, cannot move the start anchor.
    const later = [...beforeStart,message(4,null,{createdAt:'2000-01-01T00:00:00Z'}),message(5,'peer')]
    expect(order([next],later)).toEqual(['message-1','message-2','message-3','run-presence:next','message-4','message-5'])
    expect(order([structuredClone(next)],later.slice(3))).toEqual(['run-presence:next','message-4','message-5'])
    expect(order([next],[message(1,null),...later.slice(3)])).toEqual(['message-1','run-presence:next','message-4','message-5'])
    expect(order([next],[message(3,'previous'),...later.slice(3)])).toEqual(['message-3','run-presence:next','message-4','message-5'])
    const sent = [...later,message(6,'next'),message(7,'next'),message(8,'peer')]
    expect(order([next],sent)).toEqual(['message-1','message-2','message-3','message-4','message-5','message-6','message-7','run-presence:next','message-8'])
    expect(slots([next],sent)).toEqual([['next',true]])
    expect(order([next],[message(3,null,{id:'optimistic:send'}),message(4,null)])).toEqual(['run-presence:next','optimistic:send','message-4'])
    expect(order([{...next,publicTailSequenceAtStart:0}],[message(1,null)])).toEqual(['run-presence:next','message-1'])
  })

  it('never splits another Run reply from its joined, image and Files Changed cards', () => {
    const a = run('a'), b = run('b','b',{anchorMessageId:'message-2',publicTailSequenceAtStart:2})
    const joined = {kind:'member_joined',id:'joined-a',createdAt:a.createdAt,receipt:{sourceAgentRunId:'a'}} as ThreadConversationTimelineItem
    const images = {kind:'run_images',id:'images-a',createdAt:a.createdAt,images:{agentRunId:'a'}} as ThreadConversationTimelineItem
    const files = {kind:'run_file_changes',id:'files-a',createdAt:a.createdAt,changes:{agentRunId:'a'}} as ThreadConversationTimelineItem
    const timeline = [message(1,null),message(2,'a'),joined,images,files,message(3,'peer')]
    expect(order([b],timeline)).toEqual(['message-1','message-2','joined-a','images-a','files-a','run-presence:b','message-3'])
    expect(slots([b],timeline)).toEqual([['b',false]])
    expect(order([b,a],timeline)).toEqual(['message-1','message-2','joined-a','images-a','files-a','run-presence:a','run-presence:b','message-3'])
    expect(slots([b,a],timeline)).toEqual([['a',true],['b',false]])
    // The old projection's input anchor must respect the same atomic group.
    expect(order([{...b,publicTailSequenceAtStart:null}],timeline)).toEqual(order([b],timeline))
  })

  it.each(['failed', 'cancelled'] as const)('keeps %s artifacts together and continues the adjacent Run identity', status => {
    const a = run('a','alice',{status, cancelReasonCode:'user_requested_agent_run_stop'})
    const artifact = {kind:'run_artifacts',id:'artifact-a',createdAt:a.createdAt,run:a,imageGroups:[],fileChanges:[],memberCreations:[]} as ThreadConversationTimelineItem
    expect(order([a],[message(1,null),artifact,message(2,'peer')])).toEqual(['message-1','artifact-a','run-presence:a','message-2'])
    expect(slots([a],[artifact])).toEqual([['a',true]])
    const files = {kind:'run_file_changes',id:'files-a',createdAt:a.createdAt,changes:{agentRunId:'a'}} as ThreadConversationTimelineItem
    expect(order([a],[message(1,null),message(2,'a'),files,message(3,'peer')])).toEqual(['message-1','message-2','files-a','run-presence:a','message-3'])
    expect(slots([a],[message(2,'a'),files])).toEqual([['a',true]])
    // Publishing an intermediate artifact alone does not move a running row.
    expect(order([{...a,status:'running'}],[message(1,null),message(2,'peer'),files])).toEqual([
      'message-1','run-presence:a','message-2','files-a'
    ])
    expect(order([{...a,status:'running'}],[message(1,null),files,message(2,'peer')])).toEqual([
      'message-1','run-presence:a','files-a','message-2'
    ])
  })

  it('shows admitted startup Runs, omits private and terminal Runs, and preserves approval waits', () => {
    const runs = [run('queued','',{status:'queued'}),run('unstarted','',{status:'waiting',startedAt:null}),
      run('private','',{invocationKind:'single_chat'}),run('done','',{status:'succeeded'}),
      run('stopped','',{status:'cancelled'}),run('approval','alice',{status:'waiting',waitReason:'approval'})]
    expect(slots(runs)).toEqual([['approval',false],['queued',false]])
    expect(runPresencePreview(runs[5]).text).toBe('等待审批')
  })

  it('retains only the latest public manual stop until acceptance or a newer Run', () => {
    const stopped = run('stopped', 'alice', { status: 'cancelled', cancelReasonCode: 'user_requested_agent_run_stop' })
    const next = run('next', 'alice', { createdAt: '2026-10-10T12:01:00Z' })
    expect(slots([stopped])).toEqual([['stopped', false]])
    expect(slots([structuredClone(stopped)], [], false)).toEqual([])
    expect(slots([structuredClone(stopped)])).toEqual([['stopped', false]])
    expect(slots([{ ...stopped, hasAcceptedContinuation: true }])).toEqual([])
    const oldFailure = run('older', 'alice', { status: 'failed', createdAt: '2026-10-10T11:59:00Z' })
    const acknowledged = conversationRunPresenceTimeline([], [oldFailure, stopped], true, new Set([stopped.id]))
    expect(acknowledged).toEqual([])
    expect(stopped.hasAcceptedContinuation).toBeUndefined()
    for (const status of ['queued', 'running', 'waiting', 'failed', 'succeeded'] as const) {
      expect(slots([stopped, { ...next, status }]).flat()).not.toContain(stopped.id)
    }
    expect(slots([stopped, run('peer', 'audrey')])).toEqual([['peer', false], ['stopped', false]])
    expect(slots([stopped, { ...next, invocationKind: 'single_chat' }])).toEqual([['stopped', false]])
    expect(slots([{ ...stopped, invocationKind: 'single_chat' }])).toEqual([])
    expect(slots([{ ...stopped, invocationKind: 'direct' }])).toEqual([['stopped', false]])
    for (const cancelReasonCode of [null, 'camp_turn_cancelled', 'single_chat_ended', 'execution_budget_exhausted'] as const) {
      expect(slots([{ ...stopped, cancelReasonCode }])).toEqual([])
    }
    expect(slots([{ ...stopped, status: 'succeeded' }])).toEqual([])
  })

  it('keeps only the latest unacknowledged batch failure after authoritative re-entry', () => {
    const failed = run('failed','alice',{status:'failed'})
    const next = run('next','alice',{createdAt:'2026-10-10T12:01:00Z'})
    expect(slots([failed])).toEqual([['failed',false]])
    expect(slots([failed],[],false)).toEqual([])
    expect(slots([failed,next])).toEqual([['next',false]])
    expect(slots([failed,{...next,status:'succeeded'}])).toEqual([])
    expect(slots([failed,{...next,status:'queued'}])).toEqual([['next',false]])
    expect(slots([{...failed,hasAcceptedContinuation:true},{...next,status:'queued'}])).toEqual([['next',false]])
    expect(slots([{...failed,hasAcceptedContinuation:true},{...next,status:'failed'}])).toEqual([['next',false]])
    expect(slots([{...failed,invocationKind:'direct'}])).toEqual([])
    const rejected = { ...failed, startedAt: null, failure: {
      runtimeKind: 'codex-cli', origin: 'rovai', phase: 'execution', code: 'context_payload_too_large',
      summary: '输入内容过大', detail: null, retryable: false
    } } as AgentRunView
    expect(runPresencePreview(rejected)).toEqual({ kind: 'error', text: '输入内容过大 · 查看详情' })
    expect(order([rejected, { ...next, status: 'succeeded' }], [message(1, null), message(2, 'next')]))
      .toEqual(['message-1', 'run-presence:failed', 'message-2'])
    expect(slots([rejected], [], false)).toEqual([])
    expect(slots([{ ...rejected, hasAcceptedContinuation: true }])).toEqual([])
  })

  it('advances only at source newlines, preserving partial lines and command precedence', () => {
    const event = (id: number, delta: string): LiveRuntimeEvent => ({
      id:String(id),agentRunId:'a',eventType:'agent.text.delta',payload:{itemId:'text',delta},createdAt:'2026-10-10T12:00:00Z'
    } as LiveRuntimeEvent)
    const events: LiveRuntimeEvent[] = []
    for (const [delta,expected] of [
      ['第一行。继续','第一行。继续'],['追加','第一行。继续追加'],['\r\n','第一行。继续追加'],
      ['\r\n第二','第二'],['行','第二行'],['\n  \n','第二行'],['第三行','第三行']
    ]) {
      events.push(event(events.length+1,delta))
      expect(runPresencePreview(run('a'),events)).toEqual({kind:'narration',text:expected})
    }
    events.push({id:'command',agentRunId:'a',eventType:'activity.started',createdAt:'2026-10-10T12:01:00Z',
      payload:{item:{id:'command',type:'commandExecution',command:'pnpm typecheck',status:'inProgress'}}} as LiveRuntimeEvent)
    expect(runPresencePreview(run('a'),events)).toMatchObject({kind:'command',text:'pnpm typecheck',iconKind:'terminal'})
    expect(runPresencePreview(run('a','alice',{status:'failed'}),events).kind).toBe('error')
    expect(runPresencePreview(run('a','alice',{cancelRequestedAt:'now'}),events)).toEqual({kind:'status',text:'正在停止…'})
  })

  it('shows current-epoch activity before a late ACK while keeping old evidence behind the connection fence', () => {
    const initializing = run('a', 'alice', { waitReason: 'runtime_initializing' })
    const accepted = { ...initializing, waitReason: null }
    const connecting = '启动中…'
    const working = expect.stringMatching(/^alice(?:正在为你推进|正在推进这项任务|正与你一起推进)…$/)
    const thinking: LiveRuntimeEvent = { id: 'phase', agentRunId: 'a', executionEpoch: 1,
      eventType: 'agent_run.runtime_phase_changed', payload: { phase: 'thinking' }, createdAt: '2026-10-10T12:00:00Z' }
    expect(runPresencePreview(initializing)).toEqual({ kind: 'status', text: connecting })
    expect(runPresencePreview(accepted)).toEqual({ kind: 'status', text: working })
    expect(runPresencePreview(accepted, [thinking])).toEqual({ kind: 'status', text: working })
    const titled = { ...thinking, payload: { phase: 'thinking', thinkingTitle: '核对现有边界' } }
    expect(runPresencePreview(accepted, [titled]).text).toBe('核对现有边界')
    expect(runPresencePreview(initializing, [titled]).text).toEqual(connecting)

    const text: LiveRuntimeEvent = {
      id: 'text', agentRunId: 'a', executionEpoch: 1, eventType: 'agent.text.delta',
      payload: { itemId: 'text', delta: '已经开始处理' }, createdAt: '2026-10-10T12:00:00Z'
    }
    const command: LiveRuntimeEvent = { id: 'command', agentRunId: 'a', executionEpoch: 1, eventType: 'activity.started',
      createdAt: '2026-10-10T12:01:00Z', payload: { item: { id: 'command', type: 'commandExecution', command: 'pnpm typecheck', status: 'inProgress' } } }
    expect(runPresencePreview(accepted, [text])).toEqual({ kind: 'narration', text: '已经开始处理' })
    for (const current of [text, command]) {
      expect(runPresencePreview(initializing, [current])).toEqual(runPresencePreview(accepted, [current]))
      for (const untrusted of [{ ...current, executionEpoch: 0 }, { ...current, executionEpoch: null },
        { ...current, executionEpoch: undefined }, { ...current, executionEpoch: 2 }, { ...current, agentRunId: 'another-run' }]) {
        expect(runPresencePreview(initializing, [untrusted]).text).toEqual(connecting)
      }
    }
    expect(runPresencePreview(initializing, [text, { ...command, executionEpoch: 0 }])).toEqual({ kind: 'narration', text: '已经开始处理' })
    expect(runPresencePreview(initializing, [{ ...text, payload: { itemId: 'text', delta: '  ' } }]).text).toEqual(connecting)
    // A reconnect can still have earlier evidence; it must describe the new initialization.
    expect(runPresencePreview({ ...initializing, executionEpoch: 2 }, [text, command]).text).toEqual(connecting)
    expect(runPresencePreview({ ...initializing, cancelRequestedAt: 'now' }, [text, command]).text).toBe('正在停止…')
    expect(runPresencePreview({ ...initializing, status: 'cancelled', cancelRequestedAt: 'now' }, [text, command]).text).toBe('已停止')
    expect(runPresencePreview({ ...initializing, status: 'failed' }, [text, command]).kind).toBe('error')
    expect(runPresencePreview({ ...initializing, status: 'waiting', waitReason: 'approval' }, [text, command]).text).toBe('等待审批')
  })
})


describe('conversation presence copy and duration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('draws independent choices, allows repeats and retains them across snapshots and locales', async () => {
    const samples = [0, 0, 0, 0, 1 / 3 - Number.EPSILON, 1 / 3,
      2 / 3 - Number.EPSILON, 2 / 3, 1 - Number.EPSILON, 1 - Number.EPSILON]
    let draw = 0
    const random = vi.spyOn(Math, 'random').mockImplementation(() => samples[draw++ % samples.length])
    const connecting = ['启动中…']
    const working = ['爱丽丝正在为你推进…', '爱丽丝正在推进这项任务…', '爱丽丝正与你一起推进…']
    const englishConnecting = ['Starting…']
    const englishWorking = ['爱丽丝 is moving this forward…', '爱丽丝 is working on this task…', '爱丽丝 is working through this with you…']
    const runs = Array.from({ length: 30 }, (_, index) => run(`choice-${index}`, 'alice'))
    const preview = (run: AgentRunView, waitReason: string | null) => runPresencePreview({ ...run, waitReason }, [], '爱丽丝').text
    const chinese = runs.map(run => [preview(run, 'runtime_initializing'), preview(run, null)])
    expect(random).toHaveBeenCalledTimes(runs.length)
    expect(chinese.slice(0, 5)).toEqual([
      [connecting[0], working[0]], [connecting[0], working[0]],
      [connecting[0], working[0]], [connecting[0], working[0]], [connecting[0], working[0]]
    ])
    expect(new Set(chinese.map(pair => pair[0]))).toEqual(new Set(connecting))
    expect(new Set(chinese.map(pair => pair[1]))).toEqual(new Set(working))
    expect(runs.map(run => [preview(structuredClone(run), 'runtime_initializing'), preview(structuredClone(run), null)])).toEqual(chinese)
    expect(random).toHaveBeenCalledTimes(runs.length)
    const api = languageTestApi
    try {
      await changeInterfaceLanguage(api, 'en')
      runs.forEach((run, index) => {
        expect(preview(run, 'runtime_initializing')).toBe(englishConnecting[connecting.indexOf(chinese[index][0])])
        expect(preview(run, null)).toBe(englishWorking[working.indexOf(chinese[index][1])])
      })
      expect(formatRunPresenceDuration(88)).toBe('1m 28s')
      expect(formatRunPresenceDuration(3858)).toBe('1h 04m 18s')
    } finally {
      await changeInterfaceLanguage(api, 'zh-CN')
    }
    expect(runs.map(run => [preview(run, 'runtime_initializing'), preview(run, null)])).toEqual(chinese)
    expect(runPresencePreview(runs[0], [], '另一位队员').text).toContain('另一位队员')
    expect(random).toHaveBeenCalledTimes(runs.length)
  })

  it('uses real start/end facts, clamps clock reversal and omits unknown durations', () => {
    const current = run('clock')
    const now = Date.parse('2026-10-10T12:01:29Z')
    expect(runPresenceElapsedSeconds(current, now)).toBe(88)
    expect(runPresenceElapsedSeconds(current, now + 2000)).toBe(90)
    expect(runPresenceElapsedSeconds({ ...current, status: 'waiting' }, now)).toBe(88)
    expect(runPresenceElapsedSeconds({ ...current, status: 'failed', endedAt: '2026-10-10T12:01:00Z' }, now)).toBe(59)
    expect(runPresenceElapsedSeconds({ ...current, status: 'failed', endedAt: null }, now)).toBeNull()
    const stopped = { ...current, status: 'cancelled' as const, endedAt: '2026-10-10T12:01:00Z' }
    expect(runPresenceElapsedSeconds(stopped, now)).toBe(59)
    expect(runPresenceElapsedSeconds(stopped, now + 60_000)).toBe(59)
    expect(runPresenceElapsedSeconds({ ...stopped, endedAt: null }, now)).toBeNull()
    for (const startedAt of [null, 'invalid']) expect(runPresenceElapsedSeconds({ ...current, startedAt }, now)).toBeNull()
    expect(runPresenceElapsedSeconds({ ...current, endedAt: 'invalid' }, now)).toBeNull()
    expect(runPresenceElapsedSeconds(current, Date.parse('2026-10-10T12:00:00Z'))).toBe(0)
    expect(formatRunPresenceDuration(6)).toBe('6秒')
    expect(formatRunPresenceDuration(88)).toBe('1分 28秒')
    expect(formatRunPresenceDuration(3858)).toBe('1时 04分 18秒')
  })
})
