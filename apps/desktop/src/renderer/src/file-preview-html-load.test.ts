import { afterEach, expect, it, vi } from 'vitest'
import { HtmlPreviewLoadState, type HtmlPreviewLoadSnapshot } from './file-preview-html-load'

afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let snapshot: HtmlPreviewLoadSnapshot | null = null
  const publish = vi.fn((value: HtmlPreviewLoadSnapshot) => { snapshot = value })
  const state = new HtmlPreviewLoadState(publish)
  state.connecting()
  return { state, publish, snapshot: () => snapshot! }
}

it('keeps document and page communication independent from recoverable server diagnostics', () => {
  const { state, snapshot } = fixture()
  state.connected('A'); state.state('A', 'loaded')
  state.serverDiagnostics('A', 'unavailable')
  expect(snapshot()).toMatchObject({ document: 'loaded', channel: 'connected', serverDiagnostics: 'unavailable', notice: null })
  state.connecting(); state.connected('A')
  expect(snapshot().serverDiagnostics).toBe('unavailable')
  state.serverDiagnostics('A', 'connected')
  expect(snapshot()).toMatchObject({ document: 'loaded', channel: 'connected', serverDiagnostics: 'connected' })
  state.connected('B')
  state.serverDiagnostics('A', 'unavailable')
  expect(snapshot().serverDiagnostics).toBe('waiting')
  state.serverDiagnostics('B', 'unavailable')
  vi.advanceTimersByTime(12_000)
  expect(snapshot()).toMatchObject({ document: 'unresponsive', channel: 'connected', serverDiagnostics: 'unavailable' })
  state.close()
})

it('keeps a policy limitation neutral and scoped to the current document', () => {
  const { state, snapshot } = fixture()
  state.connected('A'); state.state('A', 'loaded')
  state.serverDiagnostics('A', 'unavailable', 'policy')
  expect(snapshot()).toMatchObject({ document: 'loaded', channel: 'connected', serverDiagnosticsReason: 'policy', notice: null })
  state.connecting(); state.connected('A')
  expect(snapshot().serverDiagnosticsReason).toBe('policy')
  state.connected('B'); state.state('B', 'loaded')
  state.serverDiagnostics('A', 'unavailable', 'policy')
  expect(snapshot()).toMatchObject({ serverDiagnostics: 'waiting', serverDiagnosticsReason: null })
  state.serverDiagnostics('B', 'unavailable', 'unknown')
  expect(snapshot().serverDiagnosticsReason).toBeNull()
  state.serverDiagnostics('B', 'unavailable', 'policy')
  state.serverDiagnostics('B', 'connected')
  expect(snapshot()).toMatchObject({ document: 'loaded', channel: 'connected', serverDiagnostics: 'connected', serverDiagnosticsReason: null })
  state.close()
})

it('gives the next root document its own deadline without extending it for repeated handshakes', () => {
  const { state, snapshot } = fixture()
  state.connected('A'); state.state('A', 'loaded')
  expect(vi.getTimerCount()).toBe(0)
  state.connecting(); expect(state.connected('B')).toBe(true)
  vi.advanceTimersByTime(9000)
  state.connecting(); expect(state.connected('B')).toBe(false); state.state('B', 'loading')
  state.state('A', 'loaded') // an older root cannot complete B's deadline
  vi.advanceTimersByTime(3000)
  expect(snapshot()).toMatchObject({ document: 'unresponsive', channel: 'connected', failure: null })
  state.state('B', 'loading'); expect(snapshot().document).toBe('unresponsive')
  state.state('B', 'loaded'); expect(snapshot().document).toBe('loaded')
  state.close()
})

it('never confirms success from an iframe load signal, including after a loaded document', () => {
  const { state, snapshot } = fixture()
  state.connected('A'); state.state('A', 'loaded')
  state.frameLoaded()
  expect(snapshot().document).toBe('loading')
  vi.advanceTimersByTime(12_000)
  expect(snapshot()).toMatchObject({ documentId: null, document: 'unconfirmed', channel: 'unavailable', failure: null })
  expect(snapshot().notice).toContain('已显示的内容会保留')
  state.close()
})

it('restores a completed document after its load-triggered handshake without starting a new deadline', () => {
  const { state, snapshot } = fixture()
  state.connected('A'); state.state('A', 'loaded'); state.frameLoaded()
  expect(state.connected('A')).toBe(false)
  expect(snapshot().document).toBe('loaded')
  expect(vi.getTimerCount()).toBe(0)
  state.close()
})

it('keeps an unanswered initial load unknown and bounds repeated connection attempts', () => {
  const { state, snapshot } = fixture()
  vi.advanceTimersByTime(11_000); state.connecting(); vi.advanceTimersByTime(1000)
  expect(snapshot()).toMatchObject({ document: 'unconfirmed', channel: 'unavailable', failure: null })
  state.close()
})

it('clears deadlines on a confirmed document failure and on disposal', () => {
  const { state, publish, snapshot } = fixture()
  state.connected('A'); state.state('A', 'failed', 'HTTP 404')
  vi.advanceTimersByTime(60_000)
  expect(snapshot()).toMatchObject({ document: 'failed', failure: 'HTTP 404' })
  expect(vi.getTimerCount()).toBe(0)
  state.connecting(); state.connected('B'); state.close()
  const calls = publish.mock.calls.length
  vi.advanceTimersByTime(60_000)
  expect(publish).toHaveBeenCalledTimes(calls)
  expect(vi.getTimerCount()).toBe(0)
})
