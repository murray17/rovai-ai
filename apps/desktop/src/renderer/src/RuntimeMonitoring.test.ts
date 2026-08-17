import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MonitoringMetric } from '@contracts'
import {
  MONITORING_BACKGROUND_MIN_INTERVAL_MS,
  MONITORING_EVENT_DEBOUNCE_MS,
  MONITORING_POLL_INTERVAL_MS,
  RuntimeMonitoring,
  availabilityLabel,
  formatMetricValue,
  monitoringEventRefreshDelay,
  nextMonitoringTabIndex,
  shouldStartMonitoringBackgroundRefresh,
  shouldRefreshMonitoringEvent
} from './RuntimeMonitoring'

function metric(overrides: Partial<MonitoringMetric<number>> = {}): MonitoringMetric<number> {
  return {
    availability: 'available',
    value: 0,
    numerator: null,
    denominator: null,
    observedCount: 2,
    eligibleCount: 2,
    coverage: 1,
    source: 'core_fact',
    quality: ['authoritative_core'],
    latestObservedAt: '2026-08-16T08:00:00Z',
    diagnosticCode: null,
    ...overrides
  }
}

describe('RuntimeMonitoring', () => {
  it('renders concise page copy, persistent filters, tabs, and export action', () => {
    const markup = renderToStaticMarkup(createElement(RuntimeMonitoring, { agents: [] }))
    expect(markup).toContain('<h1>运行监控</h1>')
    expect(markup).toContain('查看 AgentRun 的状态、用量、成本与可靠性。')
    expect(markup).not.toContain('Clean break')
    expect(markup).not.toContain('历史 Run 不补算')
    expect(markup).not.toContain('当前采集边界')
    expect(markup).toContain('用量与成本')
    expect(markup).toContain('性能与可靠性')
    expect(markup).toContain('导出 JSON')
    expect(markup).toContain('正在读取运行数据')
    expect(markup).toContain('role="tabpanel"')
    expect(markup).toContain('aria-controls="monitoring-summary-panel"')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).not.toMatch(/\b(?:123|456|99\.9)%?\b/)
  })

  it('uses manual activation with wrapping arrow and Home/End tab focus', () => {
    expect(nextMonitoringTabIndex(0, 'ArrowRight')).toBe(1)
    expect(nextMonitoringTabIndex(2, 'ArrowRight')).toBe(0)
    expect(nextMonitoringTabIndex(0, 'ArrowLeft')).toBe(2)
    expect(nextMonitoringTabIndex(1, 'Home')).toBe(0)
    expect(nextMonitoringTabIndex(1, 'End')).toBe(2)
    expect(nextMonitoringTabIndex(1, 'Enter')).toBeNull()
  })

  it('distinguishes explicit zero from an unavailable value', () => {
    expect(formatMetricValue(0, 'integer')).toBe('0')
    expect(formatMetricValue(0, 'percent')).toBe('0.00%')
    expect(formatMetricValue(null, 'integer')).toBe('—')
  })

  it('reports sparse coverage without treating missing fields as zero', () => {
    expect(availabilityLabel(metric({
      availability: 'partial',
      observedCount: 1,
      eligibleCount: 4,
      coverage: 0.25
    }))).toBe('1/4 Runs · 25% 覆盖')
    expect(availabilityLabel(metric({
      availability: 'unavailable',
      value: null,
      observedCount: 0,
      eligibleCount: 4,
      coverage: 0
    }))).toBe('尚未上报')
    expect(availabilityLabel(metric({
      availability: 'unavailable',
      value: null,
      observedCount: 0,
      eligibleCount: 0,
      coverage: null
    }))).toBe('无符合条件的 Run')
  })

  it('uses one bounded visible-page poll and debounced persisted-fact events', () => {
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
    expect(monitoringEventRefreshDelay(15_000, 10_000, true)).toBe(
      MONITORING_EVENT_DEBOUNCE_MS
    )
  })
})
