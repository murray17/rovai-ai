import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RuntimeUsageSnapshot } from '@contracts'
import {
  MONITORING_BACKGROUND_MIN_INTERVAL_MS,
  MONITORING_EVENT_DEBOUNCE_MS,
  MONITORING_POLL_INTERVAL_MS,
  RuntimeMonitoring,
  RuntimeUsageEmpty,
  RuntimeUsageView,
  hasRuntimeUsage,
  monitoringEventRefreshDelay,
  shouldStartMonitoringBackgroundRefresh,
  shouldRefreshMonitoringEvent
} from './RuntimeMonitoring'

function snapshot(): RuntimeUsageSnapshot {
  const coverage = { eligibleRuns: 2, observedRuns: 2 }
  return {
    schemaVersion: 2,
    collection: { epoch: 'epoch-1', startedAt: '2026-08-17T02:22:00Z' },
    range: { from: '2026-08-17T02:22:00Z', to: '2026-08-17T03:22:00Z' },
    summary: {
      promptInputTotalTokens: 120,
      uncachedInputTokens: 80,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      cacheReadShare: 1 / 3,
      requestCacheHitRate: 0.5,
      cost: {
        run: [{ amount: '1.25', currency: 'USD', kind: 'run', source: 'runtime_reported' }],
        reconciliation: [],
        latestReconciledAt: null,
        difference: []
      }
    },
    trend: [{
      bucketStartAt: '2026-08-17T03:00:00Z',
      promptInputTotalTokens: 120,
      uncachedInputTokens: 80,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      cacheReadShare: 1 / 3,
      requestCacheHitRate: 0.5,
      cost: null
    }],
    byRuntime: [{
      runtimeKind: 'codex-cli',
      providerKey: null,
      modelKey: null,
      promptInputTotalTokens: 120,
      uncachedInputTokens: 80,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      cacheReadShare: 1 / 3,
      requestCacheHitRate: 0.5,
      cost: [],
      coverage
    }],
    byModel: [],
    coverage: {
      promptInputTotalTokens: coverage,
      uncachedInputTokens: coverage,
      cacheReadTokens: coverage,
      cacheWriteTokens: coverage,
      outputTokens: coverage,
      reasoningOutputTokens: coverage,
      requestCacheHitRate: coverage,
      cost: coverage
    }
  }
}

describe('RuntimeMonitoring', () => {
  it('renders one concise Usage surface without legacy monitoring tabs', () => {
    const markup = renderToStaticMarkup(createElement(RuntimeMonitoring))
    expect(markup).toContain('<h1>运行监控</h1>')
    expect(markup).toContain('汇总 Runtime 实际上报的 Token、Cache 与成本')
    expect(markup).toContain('导出 JSON')
    expect(markup).toContain('正在读取用量')
    expect(markup).not.toContain('性能与可靠性')
    expect(markup).not.toContain('Session 延续率')
    expect(markup).not.toContain('Tool 耗时')
    expect(markup).not.toContain('Clean break')
  })

  it('renders a full Usage snapshot with explicit zero and coverage', () => {
    const value = snapshot()
    const markup = renderToStaticMarkup(createElement(RuntimeUsageView, { snapshot: value }))
    expect(hasRuntimeUsage(value)).toBe(true)
    expect(markup).toContain('Input Token')
    expect(markup).toContain('Cache Write')
    expect(markup).toContain('>0</dd>')
    expect(markup).toContain('覆盖 2/2 Runs')
    expect(markup).toContain('USD 1.25')
    expect(markup).toContain('Codex')
  })

  it('keeps missing fields unknown in a partial snapshot', () => {
    const value = snapshot()
    value.summary.cacheReadTokens = null
    value.summary.cacheReadShare = null
    value.coverage.cacheReadTokens = { eligibleRuns: 2, observedRuns: 0 }
    const markup = renderToStaticMarkup(createElement(RuntimeUsageView, { snapshot: value }))
    expect(markup).toContain('—')
    expect(markup).toContain('覆盖 0/2 Runs')
    expect(markup).not.toContain('尚未上报')
  })

  it('recognizes and renders the empty state', () => {
    const value = snapshot()
    value.summary = {
      promptInputTotalTokens: null,
      uncachedInputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      cacheReadShare: null,
      requestCacheHitRate: null,
      cost: null
    }
    expect(hasRuntimeUsage(value)).toBe(false)
    const markup = renderToStaticMarkup(createElement(RuntimeUsageEmpty))
    expect(markup).toContain('暂无 Usage 数据')
    expect(markup).toContain('新 AgentRun 上报 Token、Cache 或成本后')
  })

  it('uses one bounded visible-page poll and throttles non-terminal events', () => {
    expect(MONITORING_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10_000)
    expect(MONITORING_POLL_INTERVAL_MS).toBeLessThanOrEqual(15_000)
    expect(MONITORING_BACKGROUND_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(10_000)
    expect(MONITORING_BACKGROUND_MIN_INTERVAL_MS).toBeLessThanOrEqual(12_000)
    expect(MONITORING_EVENT_DEBOUNCE_MS).toBeGreaterThan(0)
    expect(shouldRefreshMonitoringEvent('monitoring.changed')).toBe(true)
    expect(shouldRefreshMonitoringEvent('agent_run.terminal')).toBe(true)
    expect(shouldRefreshMonitoringEvent('runtime.usage')).toBe(false)
    expect(shouldStartMonitoringBackgroundRefresh(20_000, 10_000)).toBe(true)
    expect(shouldStartMonitoringBackgroundRefresh(19_999, 10_000)).toBe(false)
    expect(monitoringEventRefreshDelay(15_000, 10_000, false)).toBe(5_000)
    expect(monitoringEventRefreshDelay(15_000, 10_000, true)).toBe(MONITORING_EVENT_DEBOUNCE_MS)
  })
})
