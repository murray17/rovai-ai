import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { RuntimeUsageTrendPoint } from '@contracts'

export const USAGE_CHART_SERIES = [
  { key: 'promptInputTotalTokens', label: 'Input', color: 'var(--monitoring-input)' },
  { key: 'outputTokens', label: 'Output', color: 'var(--monitoring-output)' },
  { key: 'cacheReadTokens', label: 'Cache Read', color: 'var(--monitoring-read)' },
  { key: 'cacheWriteTokens', label: 'Cache Write', color: 'var(--monitoring-write)' }
] as const
type SeriesKey = typeof USAGE_CHART_SERIES[number]['key']

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

function shortNumber(value: number): string {
  return value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(1))}M`
    : value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}k` : String(Number(value.toFixed(2)))
}

function date(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

// Missing observations interrupt a series. Explicit zero remains a point on the baseline.
export function usageSeriesPath(points: RuntimeUsageTrendPoint[], key: SeriesKey, x: (index: number) => number, y: (value: number) => number): string {
  let started = false
  return points.map((point, index) => {
    const value = point[key]
    if (value === null) {
      started = false
      return ''
    }
    const segment = `${started ? 'L' : 'M'}${x(index)},${y(value)}`
    started = true
    return segment
  }).join(' ')
}

export function RuntimeUsageChart({ points }: { points: RuntimeUsageTrendPoint[] }): React.JSX.Element {
  const [shown, setShown] = useState<SeriesKey[]>(() => USAGE_CHART_SERIES.map(series => series.key))
  const [active, setActive] = useState<number | null>(null)
  const [width, setWidth] = useState(900)
  const host = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const height = 216, left = 48, right = 14, top = 16, bottom = 32

  useLayoutEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width)))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setActive(null), [points])

  const visible = USAGE_CHART_SERIES.filter(series => shown.includes(series.key))
  const maximum = points.reduce((max, point) => visible.reduce((value, series) => Math.max(value, point[series.key] ?? 0), max), 1)
  const magnitude = 10 ** Math.floor(Math.log10(maximum / 4))
  const unit = maximum / 4 / magnitude
  const step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(value => value >= unit) ?? 10) * magnitude
  const ceiling = step * 4
  const x = (index: number): number => left + index / Math.max(1, points.length - 1) * (width - left - right)
  const y = (value: number): number => height - bottom - value / ceiling * (height - top - bottom)
  const current = active === null ? null : points[active] ?? null
  const tickIndices = points.length ? [...new Set(width < 540 ? [0, points.length - 1]
    : [0, Math.round((points.length - 1) / 3), Math.round((points.length - 1) * 2 / 3), points.length - 1])] : []
  const tooltipWidth = Math.min(210, width - 16)

  function move(event: PointerEvent<SVGSVGElement>): void {
    if (!points.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - rect.left) / rect.width * width - left) / (width - left - right) * (points.length - 1)))))
  }

  function handleKey(event: KeyboardEvent<SVGSVGElement>): void {
    if (!points.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Escape') setActive(null)
    else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, (index ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))))
  }

  return <div className="monitoring-plot" ref={host}>
    <div className="monitoring-chart-legend" aria-label="显示的数据系列">
      {USAGE_CHART_SERIES.map(series => <button type="button" key={series.key} aria-pressed={shown.includes(series.key)}
        onClick={() => setShown(current => current.includes(series.key) ? current.filter(key => key !== series.key) : [...current, series.key])}>
        <i style={{ background: series.color }} />{series.label}
      </button>)}
      <span>Token</span>
    </div>
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="monitoring-chart-svg"
      role="img" tabIndex={0} aria-label="Token 与 Cache 用量趋势，可用左右方向键查看时间点"
      aria-describedby={current && visible.length > 0 ? tooltipId : undefined} onPointerMove={move} onPointerLeave={() => setActive(null)}
      onKeyDown={handleKey} onBlur={() => setActive(null)}>
      {[0, 1, 2, 3, 4].map(index => <g key={index}>
        <line className="monitoring-chart-grid" x1={left} x2={width - right} y1={y(index * step)} y2={y(index * step)} />
        <text className="monitoring-chart-tick" x={left - 10} y={y(index * step) + 4} textAnchor="end">{shortNumber(index * step)}</text>
      </g>)}
      {visible.map(series => <g key={series.key}>
        <path d={usageSeriesPath(points, series.key, x, y)} fill="none" stroke={series.color}
          strokeWidth={series.key === 'promptInputTotalTokens' ? 2.4 : 1.8} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, index) => {
          const value = point[series.key]
          return value !== null && (points.length === 1 ||
            (points[index - 1]?.[series.key] == null && points[index + 1]?.[series.key] == null))
            ? <circle key={point.bucketStartAt} cx={x(index)} cy={y(value)} r="2.5" fill={series.color} /> : null
        })}
      </g>)}
      {tickIndices.map(index => <text key={index} className="monitoring-chart-tick" x={x(index)} y={height - 7}
        textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>
        {width < 360 ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(points[index].bucketStartAt))
          : date(points[index].bucketStartAt)}
      </text>)}
      {current && active !== null && <g>
        <line className="monitoring-chart-guide" x1={x(active)} x2={x(active)} y1={top} y2={height - bottom} />
        {visible.map(series => {
          const value = current[series.key]
          return value === null ? null : <circle key={series.key} cx={x(active)} cy={y(value)}
            r="3.5" fill={series.color} stroke="var(--home-surface)" strokeWidth="2" />
        })}
      </g>}
    </svg>
    {!visible.length && <p className="monitoring-chart-empty">选择一种数据查看趋势</p>}
    {current && active !== null && visible.length > 0 && <div id={tooltipId} role="tooltip" className="monitoring-chart-tooltip"
      style={{ left: Math.max(8, Math.min(width - tooltipWidth - 8, x(active))), width: tooltipWidth }}>
      <strong>{date(current.bucketStartAt)}</strong>
      {visible.map(series => <div key={series.key}><span><i style={{ background: series.color }} />{series.label}</span><b>{formatNumber(current[series.key])}</b></div>)}
    </div>}
  </div>
}
