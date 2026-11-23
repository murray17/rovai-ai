import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { MacUpdater } from 'electron-updater/out/MacUpdater.js'
import { NsisUpdater } from 'electron-updater/out/NsisUpdater.js'
import { DownloadedUpdateHelper } from 'electron-updater/out/DownloadedUpdateHelper.js'
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js'
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider.js'

const fromUpdater = createRequire(import.meta.resolve('electron-updater'))
const { CancellationToken, CURRENT_APP_INSTALLER_FILE_NAME } = fromUpdater('builder-util-runtime')
const blockSize = 8192
const nativeMac = Boolean(process.versions.electron) && process.platform === 'darwin'

function fixture(labels) {
  const chunks = Array.from(labels, label => Buffer.alloc(blockSize, label))
  const bytes = Buffer.concat(chunks)
  return {
    bytes,
    sha512: createHash('sha512').update(bytes).digest('base64'),
    map: gzipSync(JSON.stringify({
      version: '2',
      files: [{
        name: 'file', offset: 0, sizes: chunks.map(chunk => chunk.length),
        checksums: chunks.map(chunk => createHash('sha256').update(chunk).digest('base64'))
      }]
    }))
  }
}

// Three nonadjacent DOWNLOAD operations with local COPY operations in between.
const old = fixture('aBcDe')
const next = fixture('xByDz')

async function exercise(mode, { directory, previous = old, target = next, version = '1.0.0', nextVersion = '1.0.1', seed = true } = {}) {
  const cache = directory ?? await mkdtemp(join(tmpdir(), 'rovai-download-'))
  const token = new CancellationToken()
  const ranges = []
  let fullRequests = 0
  let rangeBytes = 0
  let timedOut = false
  let partialSize
  let staged = 0
  const name = `fixture-${nextVersion}-${nativeMac ? process.arch + '.zip' : 'x64.exe'}`
  const cachedName = nativeMac ? 'update.zip' : CURRENT_APP_INSTALLER_FILE_NAME
  let updater
  const server = createServer((req, res) => {
    if (req.url.endsWith('.blockmap')) {
      const prior = req.url.includes(version)
      if (mode === 'missing map' || (prior && mode === 'missing old map')) res.writeHead(404).end()
      else res.end(prior ? previous.map : target.map)
      return
    }
    if (!req.headers.range) {
      fullRequests++
      if (mode === 'retry' && fullRequests === 1) res.writeHead(503).end()
      else res.end(mode === 'invalid full package' ? old.bytes : target.bytes)
      return
    }
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range)
    const start = Number(first)
    const end = Number(last)
    ranges.push(start)
    const responseRange = 'bytes ' + first + '-' + last + '/' + target.bytes.length
    if (mode === 'cancel') {
      token.cancel()
      return
    }
    if (['ignored', 'ignored with body', 'invalid full package', 'retry'].includes(mode)) {
      // Like a Release asset, declare a binary body. The client must reject the
      // status as soon as its HTTP transport exposes the headers.
      const headers = { 'Content-Length': target.bytes.length }
      if (mode !== 'ignored with body') {
        headers['Content-Type'] = 'application/octet-stream'
        headers['X-Content-Type-Options'] = 'nosniff'
      }
      res.writeHead(200, headers)
      res.flushHeaders()
      if (mode === 'ignored with body') res.write(target.bytes.subarray(0, blockSize))
      return
    }
    if (mode === 'expired link' && ranges.length === 2) {
      res.writeHead(403).end()
      return
    }
    const headers = { 'Content-Range': responseRange }
    let body = target.bytes.subarray(start, end + 1)
    if (mode === 'wrong range') headers['Content-Range'] = 'bytes 1-8192/' + target.bytes.length
    if (mode === 'wrong end') headers['Content-Range'] = 'bytes ' + first + '-' + (end - 1) + '/' + target.bytes.length
    if (mode === 'wrong total') headers['Content-Range'] = 'bytes ' + first + '-' + last + '/999999'
    if (mode === 'missing range') delete headers['Content-Range']
    if (mode === 'wrong length') headers['Content-Length'] = body.length + 1
    if (mode === 'valid') headers['Content-Length'] = body.length
    if (!('Content-Length' in headers)) headers['Transfer-Encoding'] = 'chunked'
    if (mode === 'short') body = body.subarray(0, -1)
    if (mode === 'overlong') body = Buffer.concat([body, Buffer.from('extra')])
    if (mode === 'wrong digest') body = old.bytes.subarray(start, end + 1)
    res.writeHead(206, headers)
    res.end(body)
  })
  // Bound stalled responses even if a future downloader stops aborting them.
  server.setTimeout(3000, socket => {
    timedOut = true
    socket.destroy()
  })

  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + server.address().port + '/'
    const Updater = nativeMac ? MacUpdater : NsisUpdater
    updater = new Updater(null, { version, appUpdateConfigPath: join(cache, 'absent.yml') })
    updater.autoInstallOnAppQuit = false
    updater.logger = null
    updater.downloadedUpdateHelper = new DownloadedUpdateHelper(cache)
    updater.httpExecutor = new class extends ElectronHttpExecutor {
      createRequest(options, callback) {
        const isRange = Boolean(options.headers?.range)
        const observe = response => {
          callback(response)
          if (isRange) response.on('data', chunk => { rangeBytes += chunk.length })
        }
        return nativeMac ? super.createRequest(options, observe) : request(options, observe)
      }
      async download(url, destination, options) {
        partialSize = (await stat(destination).catch(() => null))?.size ?? 0
        return super.download(url, destination, options)
      }
    }()
    updater.on('download-progress', () => {})
    updater.on('update-downloaded', () => { staged++ })
    if (seed && mode !== 'cold cache') {
      await writeFile(join(cache, cachedName), mode === 'stale cache' ? fixture('aQcRe').bytes : previous.bytes)
      if (mode !== 'missing old map') await writeFile(join(cache, 'current.blockmap'), previous.map)
    }
    const provider = new GenericProvider({ url }, updater, { executor: updater.httpExecutor, isUseMultipleRangeRequest: false })
    const download = () => updater.doDownloadUpdate({
      updateInfoAndProvider: { provider, info: {
        version: nextVersion, files: [{ url: name, size: target.bytes.length, sha512: target.sha512 }]
      } },
      cancellationToken: token, requestHeaders: {}
    })
    if (mode === 'cancel' || mode === 'invalid full package') {
      await assert.rejects(download(), mode === 'cancel' ? /cancel/i : /checksum mismatch/i)
      assert.equal(staged, 0)
    } else {
      if (mode === 'retry') {
        await assert.rejects(download(), /503/)
        assert.equal(staged, 0)
      }
      const [path] = await download()
      assert.deepEqual(await readFile(path), target.bytes)
      assert.equal(staged, 1)
      if (nativeMac) assert.deepEqual(await readFile(join(cache, cachedName)), target.bytes)
      if (mode === 'missing old map' || mode === 'stale cache') {
        assert.deepEqual(await readFile(join(cache, 'current.blockmap')), target.map)
      }
    }
    assert.equal(timedOut, false, 'unexpected wait for a stalled response body')
    return { ranges, rangeBytes, fullRequests, partialSize }
  } finally {
    updater?.closeServerIfExists?.()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (!directory) await rm(cache, { recursive: true, force: true })
  }
}

export async function checkDifferentialDownloads(check) {
  for (const mode of ['valid', 'chunked']) {
    await check('reassembles verified ' + mode + ' ranges using the existing installer', async () => {
      const { ranges, rangeBytes, fullRequests } = await exercise(mode)
      assert.deepEqual(ranges, [0, 2 * blockSize, 4 * blockSize])
      assert.equal(rangeBytes, 3 * blockSize)
      assert.equal(fullRequests, 0)
    })
  }

  for (const mode of ['ignored', 'ignored with body', 'wrong range', 'wrong end', 'wrong total', 'missing range', 'wrong length', 'short', 'overlong']) {
    await check('stops at the first ' + mode + ' response and fetches the full package once', async () => {
      const { ranges, rangeBytes, fullRequests, partialSize } = await exercise(mode)
      assert.deepEqual(ranges, [0])
      assert.equal(fullRequests, 1)
      assert.ok(partialSize <= blockSize)
      assert.ok(rangeBytes <= blockSize + 5)
      if (mode === 'ignored') assert.equal(rangeBytes, 0)
      if (mode === 'short') assert.equal(rangeBytes, blockSize - 1)
      if (mode === 'overlong') assert.equal(rangeBytes, blockSize + 5)
      if (!['short', 'overlong'].includes(mode)) assert.equal(partialSize, 0)
    })
  }

  for (const [mode, expectedRanges, expectedFull] of [
    ['expired link', 2, 1], ['wrong digest', 3, 1], ['missing map', 0, 1],
    ['missing old map', 0, 1], ['stale cache', 3, 1], ['cold cache', 0, 1],
    ['invalid full package', 1, 1], ['retry', 2, 2], ['cancel', 1, 0]
  ]) {
    await check(mode + ' preserves the updater fallback and staging rules', async () => {
      const { ranges, fullRequests } = await exercise(mode)
      assert.equal(ranges.length, expectedRanges)
      assert.equal(fullRequests, expectedFull)
    })
  }

  if (nativeMac) await check('repairs a stale on-disk index on the upgrade following a missing index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-consecutive-updates-'))
    try {
      const middle = fixture('xQyRz')
      const first = await exercise('missing map', { directory, target: middle })
      assert.deepEqual(first.ranges, [])
      assert.equal(first.fullRequests, 1)
      assert.deepEqual(await readFile(join(directory, 'current.blockmap')), old.map)
      const second = await exercise('consecutive', {
        directory, previous: middle, version: '1.0.1', nextVersion: '1.0.2', seed: false
      })
      assert.equal(second.rangeBytes, 3 * blockSize)
      assert.equal(second.fullRequests, 1)
      assert.deepEqual(await readFile(join(directory, 'current.blockmap')), next.map)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

if (!nativeMac) await checkDifferentialDownloads((name, check) => test(name, { timeout: 5000 }, check))
