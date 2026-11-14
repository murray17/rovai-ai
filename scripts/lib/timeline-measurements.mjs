// Fixture-only timing. Production bundles never import or expose these counters.
export function instrumentTimelineMeasurements(source, id) {
  const wrap = (start, end, name) => {
    const first = source.indexOf(start)
    const last = source.indexOf(end, first + start.length)
    if (first < 0 || last < 0) throw new Error(`Missing ${name} measurement boundary in ${id}`)
    const begin = `const diagnostic = ((globalThis as any).__timelineCost ??= {}); const cost = (diagnostic.${name} ??= {calls:0,ms:0}); cost.calls++; const started = performance.now(); try {`
    source = source.slice(0, last) + `} finally { cost.ms += performance.now() - started }\n` + source.slice(last)
    source = source.slice(0, first + start.length) + begin + source.slice(first + start.length)
  }
  if (id.endsWith('/TimelineVirtualList.tsx')) {
    wrap('const rememberAnchor = useCallback(() => {', '  }, [viewportRef, virtual])', 'anchorRead')
    wrap('const update = useCallback(() => {', '  }, [viewportRef, indexesById, items, rememberAnchor])', 'timelineUpdate')
  } else if (id.endsWith('/usePublicMessageLayout.ts')) {
    wrap('const measure = (): void => {', '    }\n    const schedule =', 'publicLayout')
  }
  return source
}
