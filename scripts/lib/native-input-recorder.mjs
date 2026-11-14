// Serializable browser instrumentation for a visible native acceptance window.
// Capture only synthetic acceptance input; no console IPC or disk I/O per event.
export function installNativeInputRecorder(metadata = {}) {
  window.__nativeInputRecorder?.dispose()
  const records = []
  let round = 0, dropped = 0
  const record = value => records.push({ at: performance.now(), ...value })
  const background = new Map()
  const unsubscribe = metadata.actualApp ? window.rovai?.onEvent?.(event => {
    if (!['agent.text.block', 'agent.text.delta'].includes(event.method)) return
    const run = event.params?.agentRunId, thread = event.params?.threadId
    const key = `${thread}:${run}`, now = performance.now()
    const load = background.get(key) ?? { threadId: thread, runId: run, count: 0, firstAt: now, lastAt: now }
    load.count++; load.lastAt = now; background.set(key, load)
    record({ type: 'backgroundEvent', at: now, threadId: thread, runId: run, method: event.method })
  }) : null
  const entries = values => values.filter(entry => entry.name === 'keydown').forEach(entry => record({
    type: 'eventTiming', name: entry.name, start: entry.startTime, duration: entry.duration,
    processingStart: entry.processingStart, processingEnd: entry.processingEnd, interactionId: entry.interactionId
  }))
  const supported = PerformanceObserver.supportedEntryTypes.includes('event')
  const observer = supported ? new PerformanceObserver((list, _observer, options) => {
    entries(list.getEntries())
    if (options?.droppedEntriesCount) { dropped += options.droppedEntriesCount; record({ type: 'dropped', count: options.droppedEntriesCount }) }
  }) : null
  observer?.observe({ type: 'event', durationThreshold: 16 })
  const longTasks = new PerformanceObserver(list => list.getEntries().forEach(entry => record({ type: 'longtask', start: entry.startTime, duration: entry.duration })))
  longTasks.observe({ type: 'longtask' })
  const names = ['keydown', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']
  const listener = event => {
    const editor = event.target instanceof Element ? event.target.closest('[contenteditable="true"]') : null
    if (!editor) return
    if (event.type === 'keydown' && event.code === 'KeyA' && (event.metaKey || event.ctrlKey)) round++
    const row = { type: event.type, start: event.timeStamp, observedAt: performance.now(), round,
      data: event.data, key: event.key, code: event.code, metaKey: event.metaKey,
      ctrlKey: event.ctrlKey, altKey: event.altKey, isComposing: event.isComposing, trusted: event.isTrusted,
      visibility: document.visibilityState, focused: document.hasFocus() }
    if (event.type === 'input' || event.type === 'compositionend') row.text = editor.textContent
    record(row)
  }
  for (const name of names) document.addEventListener(name, listener, true)
  const visibility = () => record({ type: 'visibility', value: document.visibilityState })
  document.addEventListener('visibilitychange', visibility)
  record({ type: 'environment', ...metadata, width: innerWidth, height: innerHeight, devicePixelRatio,
    userAgent: navigator.userAgent, visibility: document.visibilityState, eventTimingSupported: supported,
    thresholdMs: 16, eventCountAtStart: performance.eventCounts?.get('keydown'), logging: 'renderer-memory' })
  const state = window.__nativeInputRecorder = {
    mark(name, detail = {}) { record({ type: 'marker', name, ...detail }) },
    snapshot() {
      if (observer) entries(observer.takeRecords())
      return [...records, { type: 'backgroundLoad', runs: [...background.values()] }, { type: 'collection', at: performance.now(), dropped, round,
        eventCountAtEnd: performance.eventCounts?.get('keydown'), complete: supported && dropped === 0 }]
    },
    dispose() {
      unsubscribe?.()
      observer?.disconnect(); longTasks.disconnect()
      for (const name of names) document.removeEventListener(name, listener, true)
      document.removeEventListener('visibilitychange', visibility)
    }
  }
  return state
}
