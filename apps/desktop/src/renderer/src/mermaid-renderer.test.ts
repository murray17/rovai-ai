import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MERMAID_CHANNEL, MERMAID_MAX_TEXT_SIZE } from './mermaid-renderer-policy'

vi.mock('./mermaid-sandbox', () => ({ sandboxDocument: vi.fn(() => '<html></html>') }))

describe('Mermaid renderer request lifetime', () => {
  let frames: Array<{ contentWindow: { postMessage: ReturnType<typeof vi.fn> }; remove: ReturnType<typeof vi.fn> }>
  let listeners: Set<(event: unknown) => void>
  const reply = (frame: typeof frames[number], data: object) => {
    for (const listener of [...listeners]) listener({ source: frame.contentWindow, data: { channel: MERMAID_CHANNEL, ...data } })
  }
  const ready = (index = 0, generation = 0) => reply(frames[index], { type: 'ready', generation })
  const sent = (index = 0) => frames[index].contentWindow.postMessage.mock.calls.map(call => call[0])
  const finish = (index = 0, error = false) => {
    const request = sent(index).at(-1)
    reply(frames[index], { generation: request.generation, id: request.id, type: 'result', ...(error ? { error: true } : { svg: '<svg />' }) })
  }
  const flush = async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0) }
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); frames = []; listeners = new Set()
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#ffffff', fontFamily: 'sans-serif' }))
    vi.stubGlobal('document', { documentElement: {}, body: { append: vi.fn() }, createElement: () => {
      const frame = { contentWindow: { postMessage: vi.fn() }, remove: vi.fn(), setAttribute: vi.fn(), style: {}, dataset: {} }
      frames.push(frame); return frame
    } })
    vi.stubGlobal('window', {
      addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: unknown) => void) => listeners.delete(listener)
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('rejects original over-limit source without loading an engine', async () => {
    const { renderMermaid } = await import('./mermaid-renderer')
    await expect(renderMermaid('x'.repeat(MERMAID_MAX_TEXT_SIZE + 1), 'day')).rejects.toThrow('source-limit')
    expect(frames).toHaveLength(0)
  })

  it('serializes theme initialization/render and continues after a graph error', async () => {
    const { renderMermaid } = await import('./mermaid-renderer')
    const first = renderMermaid('invalid', 'day')
    const second = renderMermaid('graph LR; A-->B', 'night')
    await flush(); ready(); await flush()
    expect(sent()).toHaveLength(1)
    expect(sent()[0].palette.darkMode).toBe(false)
    finish(0, true)
    await expect(first).rejects.toThrow()
    await flush()
    expect(sent()).toHaveLength(2)
    expect(sent()[1].palette.darkMode).toBe(true)
    finish(); await expect(second).resolves.toBe('<svg />')
    expect(frames).toHaveLength(1)
  })

  it('settles active and queued requests on timeout and rejects old or forged responses', async () => {
    const { renderMermaid } = await import('./mermaid-renderer')
    const first = renderMermaid('graph LR; A-->B', 'day')
    const second = renderMermaid('graph LR; B-->C', 'day')
    await flush(); ready(); await flush()
    const old = sent()[0]
    // Correct-looking IDs from another window cannot settle the request.
    for (const listener of listeners) listener({ source: {}, data: { ...old, type: 'result', svg: 'forged' } })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(first).rejects.toThrow(); await expect(second).rejects.toThrow()
    expect(frames[0].remove).toHaveBeenCalledOnce()
    expect(sent()).toHaveLength(1)
    const third = renderMermaid('graph LR; C-->D', 'night')
    await flush(); ready(1, 1); await flush()
    reply(frames[0], { ...old, type: 'result', svg: 'old' })
    reply(frames[1], { ...sent(1)[0], generation: 0, type: 'result', svg: 'wrong-generation' })
    finish(1); await expect(third).resolves.toBe('<svg />')
  })

  it('can load a fresh instance after initialization never became ready', async () => {
    const { renderMermaid } = await import('./mermaid-renderer')
    const first = renderMermaid('graph LR; A-->B', 'day')
    await flush(); await vi.advanceTimersByTimeAsync(15_000)
    await expect(first).rejects.toThrow()
    const second = renderMermaid('graph LR; A-->B', 'day')
    await flush(); ready(1, 1); await flush(); finish(1)
    await expect(second).resolves.toBe('<svg />')
  })

  it('allows another load after the local shell failed', async () => {
    const { sandboxDocument } = await import('./mermaid-sandbox')
    vi.mocked(sandboxDocument).mockImplementationOnce(() => { throw new Error('load') })
    const { renderMermaid } = await import('./mermaid-renderer')
    const first = renderMermaid('graph LR; A-->B', 'day')
    await flush(); await expect(first).rejects.toThrow()
    expect(frames).toHaveLength(0)
    const second = renderMermaid('graph LR; A-->B', 'day')
    await flush(); ready(0, 1); await flush(); finish(0)
    await expect(second).resolves.toBe('<svg />')
  })
})
