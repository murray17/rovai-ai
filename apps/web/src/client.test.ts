import { describe, expect, it, vi } from 'vitest'
import { ConsoleClient, InvalidationDecoder, SessionRequired } from './client'

// Owns browser credential routing and connection generations. Host HTTP tests
// cannot detect a client adding cookies, following a redirect, or accepting a
// late response from a replaced session.
describe('console transport', () => {
  it('keeps credentials in explicit headers on the fixed origin and rejects old generations', async () => {
    const token = 'a'.repeat(64)
    let delayed: ((value: Response) => void) | undefined
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async function (this: typeof globalThis, url, options) {
      expect(this).toBe(globalThis)
      if (String(url).endsWith('/login')) return Response.json({ token })
      if (String(url).endsWith('/request') && JSON.parse(String(options?.body)).params.delayed) {
        return new Promise<Response>((resolve) => { delayed = resolve })
      }
      return Response.json({ result: { name: 'Rovai' } })
    })
    const client = new ConsoleClient('http://127.0.0.1:4317', fetcher)
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
    await client.login('b'.repeat(64))
    const old = client.request('app.info', { delayed: true })
    await client.login('c'.repeat(64))
    delayed!(new Response('', { status: 401 }))
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await expect(client.request('app.info')).resolves.toEqual({ name: 'Rovai' })
    for (const [url, options] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe('http://127.0.0.1:4317')
      expect(new URL(String(url)).search).toBe('')
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
      const authorization = new Headers(options?.headers).get('Authorization')
      expect(authorization).toBe(String(url).endsWith('/login') ? null : `Bearer ${token}`)
    }
    client.clear()
    await expect(client.request('app.info')).rejects.toBeInstanceOf(SessionRequired)
  })

  it('decodes chunked LF and CRLF invalidations without treating comments or other events as data', () => {
    for (const separator of ['\n', '\r\n']) {
      const source = `:keepalive${separator}${separator}event: resync${separator}data: {}${separator}${separator}event: private${separator}data: secret${separator}${separator}`
      // Every split owns a framing boundary, including the middle of CRLF.
      for (let split = 0; split <= source.length; split++) {
        const decoder = new InvalidationDecoder()
        const first = decoder.push(source.slice(0, split))
        const second = decoder.push(source.slice(split))
        expect(first || second).toBe(true)
        expect(decoder.push(`:keepalive${separator}${separator}`)).toBe(false)
      }
    }
    expect(() => new InvalidationDecoder().push('x'.repeat(65_537))).toThrow('超出限制')
  })
})
