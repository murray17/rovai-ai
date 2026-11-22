import { describe, expect, it } from 'vitest'
import type { StoredCommandResult } from '@contracts'
import { failureFeedback, normalizeFailure, OperationFailure, operationFailureTitle } from './operation-failure'

const rejection: StoredCommandResult = {
  commandId: 'command', commandType: 'agent_run.cancel', status: 'rejected',
  code: 'command.version_conflict', payload: { message: 'Raw backend detail' }, resultEntity: null, recordedAt: ''
}

describe('normalizeFailure', () => {
  it('keeps structured command rejections and desktop bridge failures for diagnostics', () => {
    expect(normalizeFailure(rejection)).toEqual({
      code: 'command.version_conflict', kind: 'rejection', retryable: false, raw: 'Raw backend detail'
    })
    expect(normalizeFailure({
      kind: 'infrastructure_failure', code: 'core_request_timeout', retryable: true, message: 'Rust Core request timed out: threads.enter'
    })).toEqual({
      code: 'core_request_timeout', kind: 'connection', retryable: true, raw: 'Rust Core request timed out: threads.enter'
    })
    expect(normalizeFailure({
      kind: 'domain_rejection', code: 'request_failed', retryable: false, message: 'camp_message.invalid_reply'
    }).code).toBe('camp_message.invalid_reply')
    expect(normalizeFailure({
      kind: 'domain_rejection', code: 'request_failed', message: 'The draft changed'
    }).code).toBe('request_failed')
  })

  it('preserves a typed rejection and classifies local and unknown values', () => {
    const coded = normalizeFailure(Object.assign(new Error('Archive rejected'), { code: 'camp.not_found' }))
    expect(coded).toMatchObject({ code: 'camp.not_found', kind: 'rejection' })
    expect(normalizeFailure(new OperationFailure(coded))).toBe(coded)
    expect(normalizeFailure(new Error('Local exception'))).toMatchObject({ code: null, kind: 'local' })
    expect(normalizeFailure(null)).toMatchObject({ code: null, kind: 'unknown' })
  })
})

describe('failureFeedback', () => {
  it('describes a failed open by its chosen title and hides backend text on unknown errors', () => {
    expect(failureFeedback('thread.open', normalizeFailure({
      kind: 'infrastructure_failure', code: 'core_request_timeout', message: 'Rust Core request timed out: threads.enter'
    }), { subject: '晚班' })).toEqual({
      message: '没能打开「晚班」，Rovai 暂时没有响应。', tone: 'danger', outcome: 'connection'
    })
    expect(failureFeedback('thread.open', normalizeFailure(rejection)).outcome).toBe('stale')
    expect(failureFeedback('thread.open', normalizeFailure({ ...rejection, code: 'camp.not_found' }), { subject: '晚班' }).outcome).toBe('gone')
    expect(failureFeedback('thread.open', normalizeFailure({ ...rejection, code: 'private.internal_error' })).message)
      .toBe('打开会话未完成，请重试。')
  })

  it.each([
    ['shutdown', 'Rovai 正在退出。'],
    ['full_core_shutting_down', 'Rovai 正在退出。'],
    ['full_core_unavailable', 'Rovai 还在启动，请稍后重试。'],
    ['full_core_startup_refused', 'Rovai 还在启动，请稍后重试。'],
    ['core_process_exited', 'Rovai 后台暂时不可用，请稍后重试。']
  ])('explains the connection failure %s', (code, message) => {
    const failure = normalizeFailure({ code, message: 'host internals' })
    expect(failureFeedback('thread.open', failure).message).toBe(message)
    expect(failureFeedback('thread.open', failure, { subject: '晚班' })).toEqual({
      message: '没能打开「晚班」。' + message, tone: 'danger', outcome: 'connection'
    })
    expect(failureFeedback('thread.open', failure, { subject: '晚班', presentation: 'detail' }).message).toBe(message)
  })

  it.each(['navigation.action', 'overview.read', 'preferences.read', 'preferences.save', 'thread.lead.change'] as const)(
    'keeps the fallback body for %s independent of its title',
    operation => {
      const failure = normalizeFailure({ ...rejection, code: 'fixture.unknown_rejection' })
      expect(failureFeedback(operation, failure, { presentation: 'detail' }).message).toBe('请重试。')
      expect(failureFeedback(operation, failure).message).toBe(operationFailureTitle(operation) + '，请重试。')
    }
  )

  it('retains actionable rename and delete rejection reasons', () => {
    const feedback = (operation: 'thread.rename' | 'thread.delete', code: string) =>
      failureFeedback(operation, normalizeFailure({ ...rejection, code }), { presentation: 'detail' })
    expect(feedback('thread.rename', 'camp.name_too_long').message).toBe('对话名称最多 80 个字符。')
    expect(feedback('thread.rename', 'camp.not_found')).toEqual({
      message: '这个会话已被删除。', tone: 'neutral', outcome: 'gone'
    })
    expect(feedback('thread.delete', 'camp.workspace_cleanup_pending').message).toBe('工作区正在清理，请稍后重试。')
    expect(feedback('thread.delete', 'camp.deletion_not_found')).toEqual({
      message: '找不到这次删除的记录。', tone: 'neutral', outcome: 'gone'
    })
  })

  it('distinguishes stopping, stale runs and a missing lead', () => {
    expect(failureFeedback('run.stop', normalizeFailure(rejection)).message).toBe('执行状态刚刚更新，请再点一次停止。')
    expect(failureFeedback('run.stop', normalizeFailure({ ...rejection, code: 'agent_run.turn_cancellation_in_progress' })).outcome).toBe('resolved')
    expect(failureFeedback('thread.lead.change', normalizeFailure({ ...rejection, code: 'camp.default_lead_unavailable' }), { subject: '奥黛丽' }))
      .toEqual({ message: '奥黛丽已不在当前会话，队长没有更换。', tone: 'neutral', outcome: 'gone' })
  })

  it.each([
    ['approval.not_pending', '这条审批已在其他地方处理，无需再次提交。'],
    ['approval.expired', '这条审批已过期。'],
    ['approval.resolution_fenced', '执行已停止，这条审批不再需要处理。'],
    ['approval.agent_run_effects_fenced', '执行已停止，这条审批不再需要处理。']
  ])('presents %s as a settled approval', (code, message) => {
    expect(failureFeedback('approval.resolve', normalizeFailure({ ...rejection, code })))
      .toEqual({ message, tone: 'neutral', outcome: 'resolved' })
  })
})
