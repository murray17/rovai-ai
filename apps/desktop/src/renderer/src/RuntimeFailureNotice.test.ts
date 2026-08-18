import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RuntimeFailureOrigin, RuntimeFailureView } from '@contracts'
import { RuntimeFailureNotice, runtimeFailureTitle } from './RuntimeFailureNotice'

describe('RuntimeFailureNotice', () => {
  it.each([
    ['runtime', 'Claude Code 返回错误'],
    ['compatibility', 'Claude Code 与当前 Rovai 版本不兼容'],
    ['environment', 'Claude Code 的本机运行环境不可用'],
    ['unknown', 'Claude Code 未能完成运行']
  ] satisfies Array<[RuntimeFailureOrigin, string]>)(
    'attributes Claude Code %s failures without calling them Rovai internal errors',
    (origin, title) => {
      const failure = runtimeFailure(origin)
      expect(runtimeFailureTitle(failure)).toBe(title)
      expect(renderToStaticMarkup(createElement(RuntimeFailureNotice, { failure })))
        .not.toContain('Rovai 内部错误')
    }
  )

  it('names Antigravity and shows its safe summary and optional detail', () => {
    const failure = runtimeFailure('runtime', 'antigravity-app')
    const markup = renderToStaticMarkup(createElement(RuntimeFailureNotice, { failure }))

    expect(markup).toContain('Antigravity 返回错误')
    expect(markup).toContain('模型额度不足')
    expect(markup).toContain('请检查 Provider 额度后重试。')
  })

  it('uses Rovai internal error only when Core explicitly attributes the origin to Rovai', () => {
    const failure = runtimeFailure('rovai')
    expect(runtimeFailureTitle(failure)).toBe('Rovai 内部错误')
  })
})

function runtimeFailure(
  origin: RuntimeFailureOrigin,
  runtimeKind: RuntimeFailureView['runtimeKind'] = 'claude-code-cli'
): RuntimeFailureView {
  return {
    runtimeKind,
    origin,
    phase: 'terminal',
    code: 'runtime_quota_exceeded',
    summary: '模型额度不足',
    detail: '请检查 Provider 额度后重试。',
    retryable: false
  }
}
