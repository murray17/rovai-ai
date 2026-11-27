import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { verifyMacZipBlockmap } from './lib/macos-zip-blockmap.mjs'

assert.equal(process.platform, 'darwin')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Use a dedicated GitHub-hosted Mac')
assert.ok(isAbsolute(process.env.RUNNER_TEMP))
const root = await mkdtemp(join(await realpath(process.env.RUNNER_TEMP), 'rovai-signed-release-'))
const [oldDir, candidateDir] = await Promise.all(process.argv.slice(2).map(path => realpath(path)))
const arch = process.arch
assert.ok(['arm64', 'x64'].includes(arch))
const previousVersion = '0.5.16'
const version = '0.5.17'
const oldPrefix = `Rovai-AI-${previousVersion}-${arch}`
const newPrefix = `Rovai-AI-${version}-${arch}`
const oldZip = join(oldDir, oldPrefix + '.zip')
const newZip = join(candidateDir, newPrefix + '.zip')
const oldBlockmap = oldZip + '.blockmap'
const newBlockmap = newZip + '.blockmap'
const oldMapInfo = await verifyMacZipBlockmap(oldZip)
const zipSha512 = await fingerprint(newZip, 'sha512', 'base64')
const zipSize = statSync(newZip).size

function command(program, args) {
  return execFileSync(program, args, { encoding: 'utf8', timeout: 45_000 }).trim()
}
async function fingerprint(path, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(encoding)
}
function binary(bundle) { return join(bundle, 'Contents', 'MacOS', 'Rovai AI') }
function bundleVersion(bundle) {
  return command('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(bundle, 'Contents', 'Info.plist')])
}
function verifySignature(bundle, requirement) {
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  if (requirement) command('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, bundle])
}
async function copyDmg(dmg, destination) {
  const mount = await mkdtemp(join(root, 'mount-'))
  command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, dmg])
  try {
    command('/usr/bin/ditto', [join(mount, 'Rovai AI.app'), destination])
  } finally {
    command('/usr/bin/hdiutil', ['detach', mount])
  }
}
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}
async function withSocket(url, evaluate) {
  const socket = new WebSocket(url)
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Main-process evaluation timed out')), 6000)
      socket.addEventListener('message', event => {
        const reply = JSON.parse(event.data)
        if (reply.id !== 1) return
        clearTimeout(timer)
        const error = reply.error?.message ?? reply.result?.exceptionDetails?.exception?.description
        if (error) reject(Error(error))
        else resolve(reply.result?.result?.value)
      })
      socket.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate', params: { expression: evaluate, returnByValue: true, awaitPromise: true }
      }))
    })
  } finally {
    socket.close()
  }
}
async function setFeed(inspectorPort, baseUrl, cache, data) {
  const [target] = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`).then(response => response.json())
  assert.ok(target?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:'))
  const result = await withSocket(target.webSocketDebuggerUrl, `(async () => {
    const resolve = process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json');
    const { app } = resolve('electron');
    const { autoUpdater } = resolve('electron-updater');
    const expectedData = ${JSON.stringify(data)};
    if (app.getPath('userData') !== expectedData || app.getVersion() !== '0.5.16') throw new Error('Wrong running bundle or test profile');
    if (autoUpdater.downloadedUpdateHelper) throw new Error('Unexpected updater state at launch');
    Object.defineProperty(autoUpdater.app, 'baseCachePath', { value: ${JSON.stringify(cache)} });
    autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(baseUrl)}, useMultipleRangeRequest: false });
    const helper = await autoUpdater.getOrCreateDownloadHelper();
    return { cachePath: helper.cacheDir, userData: app.getPath('userData') };
  })()`)
  assert.equal(result.userData, data)
  assert.ok(result.cachePath.startsWith(cache + '/'))
  return result.cachePath
}
async function openApp(bundle, data, inspectorPort) {
  const args = ['--remote-debugging-port=0', `--user-data-dir=${data}`]
  if (inspectorPort) args.push(`--inspect=127.0.0.1:${inspectorPort}`)
  return await launchAcceptanceBrowser({
    executable: binary(bundle), args,
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' }
  })
}
async function prepareData(path, existing) {
  await mkdir(join(path, 'managed-skill-library'), { recursive: true })
  assert.equal(await realpath(path), path)
  if (existing) seedCompletedOnboardingForAcceptance(path)
}
async function assertCoreReady(browser, data, buildVersion) {
  await browser.wait('window.rovai?.supervisor ? window.rovai.supervisor.getSnapshot().then(s => s.fullCoreState === "ready") : false', 40_000)
  const health = await browser.evaluate('window.rovai.request("health.check", {})')
  assert.equal(health.core.version, buildVersion)
  assert.equal(await realpath(health.database.path), await realpath(join(data, 'rovai.sqlite')))
  return health
}
async function seedThread(browser, directory) {
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  const result = await browser.evaluate(`(async () => {
    const request = (method, params) => window.rovai.request(method, params ?? {});
    const roster = await request('threads.creationPreflight');
    const project = await request('workspaces.inspect', {path: ${JSON.stringify(workspace)}});
    return request('threads.create', {
      commandId: ${JSON.stringify(randomUUID())}, name: 'Signed update acceptance',
      workspace: {projectPath: project.projectPath}, memberAgentIds: roster.presentMembers.map(it => it.agentId),
      defaultLeadAgentId: roster.initialLeadAgentId, collaborationMode: 'peer'
    });
  })()`)
  assert.equal(result.status, 'applied', JSON.stringify(result))
  return result.payload.threadId
}
const manifest = JSON.stringify({
  version, files: [{ url: basename(newZip), sha512: zipSha512, size: zipSize }],
  path: basename(newZip), sha512: zipSha512, releaseDate: '2026-11-26T08:00:00.000Z'
})
function fixture(kind) {
  const transfers = { full: 0, ranges: 0, sourceBytes: 0 }
  const index = new Map([[basename(oldBlockmap), oldBlockmap], [basename(newBlockmap), newBlockmap]])
  const server = createServer((request, response) => {
    const path = request.url.split('?')[0].slice(1)
    if (path === 'latest-mac.yml') return response.end(manifest)
    if (index.has(path)) return response.end(readFileSync(index.get(path)))
    if (path !== basename(newZip)) return response.writeHead(404).end()
    if (request.headers.range) {
      transfers.ranges++
      if (kind === 'fallback') {
        response.writeHead(200, { 'Content-Length': zipSize })
        const fullArchive = createReadStream(newZip)
        response.once('close', () => fullArchive.destroy())
        return fullArchive.pipe(response)
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range)
      if (!match) return response.writeHead(416).end()
      const first = Number(match[1]), last = Number(match[2])
      if (first > last || last >= zipSize) return response.writeHead(416).end()
      const size = last - first + 1
      response.writeHead(206, { 'Content-Range': `bytes ${first}-${last}/${zipSize}`, 'Content-Length': size })
      transfers.sourceBytes += size
      return createReadStream(newZip, { start: first, end: last }).pipe(response)
    }
    transfers.full++
    transfers.sourceBytes += zipSize
    response.writeHead(200, { 'Content-Length': zipSize })
    createReadStream(newZip).pipe(response)
  })
  return { server, transfers }
}
function bundlePids(bundle) {
  const expected = binary(bundle)
  return command('/bin/ps', ['-axo', 'pid=,command=', '-ww']).split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match || !(match[2] === expected || match[2].startsWith(expected + ' '))) return []
    return [Number(match[1])]
  })
}
async function waitForInstalledRestart(bundle, previousPids) {
  let restarted
  for (let i = 0; i < 160; i++) {
    try {
      if (bundleVersion(bundle) === version) restarted = bundlePids(bundle).find(pid => !previousPids.includes(pid))
      if (restarted) break
    } catch {}
    await pause(400)
  }
  assert.ok(restarted, 'The actual macOS updater must install and relaunch the candidate app')
  process.kill(restarted, 'SIGTERM')
  for (let i = 0; i < 45 && bundlePids(bundle).includes(restarted); i++) await pause(200)
  assert.ok(!bundlePids(bundle).includes(restarted), 'The disposable restarted fixture must exit')
}
const manualPath = join(root, 'manual', 'Rovai AI.app')
await mkdir(join(root, 'manual'))
await copyDmg(join(candidateDir, newPrefix + '.dmg'), manualPath)
assert.equal(bundleVersion(manualPath), version)
verifySignature(manualPath)
const manualData = join(root, 'manual', 'data')
await prepareData(manualData, false)
const manual = await openApp(manualPath, manualData)
try {
  await assertCoreReady(manual, manualData, version)
  console.log(`PASS ${arch} new DMG installation and isolated Core startup`)
} finally {
  await manual.close()
}
for (const kind of ['full', 'differential', 'fallback']) {
  const directory = join(root, kind)
  const bundle = join(directory, 'Rovai AI.app')
  const data = join(directory, 'data')
  const cache = join(directory, 'update-cache')
  await prepareData(data, true)
  await mkdir(cache)
  if (kind === 'full') await copyDmg(join(oldDir, oldPrefix + '.dmg'), bundle)
  else command('/usr/bin/ditto', ['-x', '-k', oldZip, directory])
  assert.equal(bundleVersion(bundle), previousVersion)
  verifySignature(bundle)
  const requirement = command('/usr/bin/codesign', ['--display', '--requirements', '-', bundle]).match(/^designated => (.*)$/m)?.[1]
  assert.ok(requirement)
  verifySignature(manualPath, requirement)
  const portProbe = createServer()
  const inspectorPort = await listen(portProbe)
  await new Promise(resolve => portProbe.close(resolve))
  const { server, transfers } = fixture(kind)
  const port = await listen(server)
  let before, after
  try {
    before = await openApp(bundle, data, inspectorPort)
    await assertCoreReady(before, data, previousVersion)
    const threadId = await seedThread(before, directory)
    const cachePath = await setFeed(inspectorPort, `http://127.0.0.1:${port}/`, cache, data)
    if (kind !== 'full') {
      await mkdir(cachePath, { recursive: true })
      await copyFile(oldZip, join(cachePath, 'update.zip'))
      await copyFile(oldBlockmap, join(cachePath, 'current.blockmap'))
      assert.equal(await fingerprint(join(cachePath, 'update.zip'), 'sha512', 'base64'), oldMapInfo.zipSha512)
    }
    await before.evaluate('window.rovai.appUpdates.check()')
    await before.wait(`window.rovai.appUpdates.get().then(s => s.availableRelease?.version === "${version}")`, 15_000)
    await before.evaluate('void window.rovai.appUpdates.download().catch(console.error)')
    await before.wait('window.rovai.appUpdates.get().then(s => s.status === "ready_to_install")', 90_000)
    const expectedFull = kind === 'differential' ? 0 : 1
    assert.equal(transfers.full, expectedFull, kind)
    if (kind === 'full') assert.equal(transfers.ranges, 0)
    else if (kind === 'fallback') assert.equal(transfers.ranges, 1, kind)
    else assert.ok(transfers.ranges > 0, kind)
    if (kind === 'differential') assert.ok(transfers.sourceBytes < zipSize)
    assert.equal(await fingerprint(join(cachePath, 'update.zip'), 'sha512', 'base64'), zipSha512)
    const beforePids = bundlePids(bundle)
    assert.ok(beforePids.length, 'Identify the fixture before staging the update')
    assert.equal(await before.evaluate('window.rovai.appUpdates.install()'), true)
    await waitForInstalledRestart(bundle, beforePids)
    await before.close()
    before = null
    assert.equal(bundleVersion(bundle), version)
    verifySignature(bundle, requirement)
    after = await openApp(bundle, data)
    const health = await assertCoreReady(after, data, version)
    const db = new DatabaseSync(health.database.path, { readOnly: true })
    try {
      assert.equal(db.prepare('SELECT id FROM camp WHERE id = ?').get(threadId)?.id, threadId)
    } finally {
      db.close()
    }
    console.log(`PASS ${arch} ${kind}: signed install, automatic restart, retained conversation, ${JSON.stringify(transfers)}`)
  } finally {
    if (after) await after.close()
    if (before) await before.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
