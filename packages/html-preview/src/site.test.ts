import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HtmlPreviewSite } from './site'
import { createPreviewFileSource, previewRequestPath } from './file-source'
import { injectPreviewScript, originalPreviewPosition } from './document'

const sites: HtmlPreviewSite[] = [], roots: string[] = []
afterEach(async () => { await Promise.all(sites.splice(0).map(site => site.close())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(allowDependencies = true, spa = false, entryPath = '/pages/index.html') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-site-'))); roots.push(root)
  await mkdir(join(root, 'pages')); await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'pages/index.html'), '<!doctype html><script>history.replaceState(null,"","?tab=all")</script><h1>unchanged</h1>')
  await writeFile(join(root, 'assets/app.js'), 'export const value = 42;')
  await writeFile(join(root, 'assets/data.json'), '{"value":42}')
  let valid = true
  const site = await HtmlPreviewSite.create({ hostOrigin: 'http://app.localhost:5555', generation: 'g1', entryPath,
    openResource: createPreviewFileSource(root, join(root, 'pages/index.html'), allowDependencies),
    validate: async signal => { signal.throwIfAborted(); if (!valid) throw new Error('revoked') },
    ...(spa ? { spaEntryPath: '/pages/index.html' } : {}) })
  sites.push(site)
  return { root, site, revoke: () => { valid = false } }
}
function read(site: HtmlPreviewSite, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
  const origin = new URL(site.descriptor.origin)
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: origin.port, path, method, headers: { host: origin.host, ...headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, text: Buffer.concat(chunks).toString() }))
    }); request.on('error', reject); request.end()
  })
}
async function authenticate(site: HtmlPreviewSite): Promise<string> {
  const response = await read(site, new URL(site.descriptor.entryUrl).pathname, { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' })
  expect(response.status).toBe(302); expect(response.headers.location).toBe(site.descriptor.documentUrl)
  const cookie = response.headers['set-cookie']![0]
  expect(cookie).toContain('HttpOnly; Secure; SameSite=None; Partitioned')
  return cookie.split(';')[0]
}

it('serves a capability-scoped static site with query-preserving HTML, MIME, cache and range responses', async () => {
  const { site } = await fixture(); const cookie = await authenticate(site)
  const entry = await read(site, '/pages/index.html', { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' })
  expect(entry.status).toBe(200); expect(entry.headers['content-security-policy']).toContain("frame-src 'self' http: https:")
  expect(entry.text).toContain('history.replaceState(null,"","?tab=all")')
  for (const query of ['', '?canvas=1', '?tab=all']) {
    const response = await read(site, `/pages/index.html${query}`, { cookie, 'sec-fetch-site': 'same-origin' })
    expect(response.status).toBe(200)
    const bridge = /src="([^"]+bridge[^"]+)"/u.exec(response.text)![1]
    const script = await read(site, bridge, { cookie })
    expect(script.text).toContain(JSON.stringify(`${site.descriptor.origin}/pages/index.html${query}`))
  }
  const queried = await fixture(true, false, '/pages/index.html?tab=all#focus')
  const queriedCookie = await authenticate(queried.site)
  expect((await read(queried.site, '/pages/index.html?tab=all', { cookie: queriedCookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'iframe' })).status).toBe(200)
  const script = await read(site, '/assets/app.js', { cookie })
  expect(script.status).toBe(200); expect(script.headers['content-type']).toContain('text/javascript')
  expect(script.text).toBe('export const value = 42;')
  expect((await read(site, '/assets/app.js', { cookie, 'if-none-match': String(script.headers.etag) })).status).toBe(304)
  expect(await read(site, '/assets/app.js', { cookie, range: 'bytes=0-5' })).toMatchObject({ status: 206, text: 'export', headers: { 'content-range': 'bytes 0-5/24' } })
  expect((await read(site, '/assets/app.js', { cookie, range: 'bytes=999-' })).status).toBe(416)
  expect(await read(site, '/assets/data.json', { cookie }, 'HEAD')).toMatchObject({ status: 200, text: '', headers: { 'content-type': 'application/json; charset=utf-8' } })
  for (const path of ['/missing.js', '/missing.css', '/missing.json', '/absent.html']) expect((await read(site, path, { cookie })).status).toBe(404)
  expect((await read(site, '/route', { cookie, accept: 'text/html' })).status).toBe(404)
  const spa = await fixture(true, true); const spaCookie = await authenticate(spa.site)
  expect((await read(spa.site, '/route', { cookie: spaCookie, accept: 'text/html' })).status).toBe(200)
  expect((await read(spa.site, '/missing.js', { cookie: spaCookie, accept: 'text/html' })).status).toBe(404)
})

it('checks credentials, host, caller origin, scope, encoding and symlinks independently of origin allocation', async () => {
  const { site, root } = await fixture(); const second = await fixture(); const cookie = await authenticate(site)
  expect(site.descriptor.origin).not.toBe(second.site.descriptor.origin)
  expect((await read(site, '/pages/index.html')).status).toBe(403)
  expect((await read(site, '/assets/app.js', { cookie, host: '127.0.0.1' })).status).toBe(403)
  expect((await read(second.site, '/assets/app.js', { cookie })).status).toBe(403)
  expect((await read(site, '/assets/app.js', { cookie, origin: second.site.descriptor.origin })).status).toBe(403)
  expect((await read(site, '/assets/app.js', { cookie, 'sec-fetch-site': 'same-site' })).status).toBe(403)
  expect((await read(site, '/assets/app.js', { cookie }, 'POST')).status).toBe(405)
  for (const path of ['/../assets/app.js', '/%2e%2e/assets/app.js', '/assets%2fapp.js', '/%5csecret.js', '/%00.js', '/bad%.js']) expect([400, 403]).toContain((await read(site, path, { cookie })).status)
  await symlink(join(second.root, 'assets/app.js'), join(root, 'assets/escape.js'))
  expect((await read(site, '/assets/escape.js', { cookie })).status).toBe(403)
  const confined = await fixture(false); const confinedCookie = await authenticate(confined.site)
  expect((await read(confined.site, '/pages/index.html?canvas=1', { cookie: confinedCookie })).status).toBe(200)
  expect((await read(confined.site, '/assets/app.js', { cookie: confinedCookie })).status).toBe(403)
  expect(previewRequestPath('/%252e%252e/app.js')).toBe('%2e%2e/app.js')
})

it('revokes context access and closes the listening port without retaining reusable capabilities', async () => {
  const { site, revoke } = await fixture(); const cookie = await authenticate(site)
  revoke()
  expect((await read(site, '/assets/app.js', { cookie })).status).toBe(410)
  await site.close(); await site.close()
  await expect(read(site, '/assets/app.js', { cookie })).rejects.toThrow()
})

it('excludes private host stores even inside a broad root while retaining the explicitly admitted entry', async () => {
  const { root } = await fixture()
  const privateRoot = join(root, 'private')
  await mkdir(privateRoot)
  await writeFile(join(privateRoot, 'credentials.json'), '{"secret":"test-only"}')
  const entry = join(privateRoot, 'attachment.html')
  await writeFile(entry, '<h1>explicit attachment</h1>')
  await symlink(join(privateRoot, 'credentials.json'), join(root, 'assets/alias.json'))
  const source = createPreviewFileSource(root, entry, true, [privateRoot])
  const signal = new AbortController().signal
  for (const path of ['private/credentials.json', 'assets/alias.json']) {
    await expect(source(path, signal)).rejects.toMatchObject({ status: 403 })
  }
  for (const path of ['private/attachment.html', 'assets/data.json']) {
    const resource = await source(path, signal)
    expect(resource.size).toBeGreaterThan(0)
    await resource.file.close()
  }
})

it('injects before author execution without modifying source bytes or original line mapping', () => {
  for (const source of ['<!doctype html><html><head><script>throw new Error("test")</script></head></html>', '<!doctype html>\n<script>throw new Error("test")</script>', '<h1>fragment</h1>', '<!doctype html>\r<html>\r<head><script>throw 1</script>']) {
    const result = injectPreviewScript(source, '/bridge.js')
    expect(result.html.replace('<script src="/bridge.js" data-rovai-preview-diagnostic></script>', '')).toBe(source)
    expect(result.html.indexOf('/bridge.js')).toBeLessThan(result.html.indexOf('throw') === -1 ? Infinity : result.html.indexOf('throw'))
    expect(result.html.split('\n')).toHaveLength(source.split('\n').length)
    expect(originalPreviewPosition(result.map, result.map.line, result.map.column + result.map.length + 5)).toEqual({ line: result.map.line, column: result.map.column + 5 })
    expect(originalPreviewPosition(result.map, result.map.line, result.map.column + 1)).toEqual({ line: null, column: null })
  }
})
