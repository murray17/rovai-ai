// Interactive native acceptance controller. Use CUA/person for IME keys; stdin
// controls setup/measurement only. All App/Host data is private and synthetic.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'
import { launchAcceptanceBrowser, pause } from './lib/host-web-browser.mjs'
import { installNativeInputRecorder } from './lib/native-input-recorder.mjs'
import { inputStatistics, nativeTimingCoverage, summarizeNativeImeRound, summarizeNativePlainRound, summarizeNativeKeys } from './lib/native-input-metrics.mjs'

const root = resolve(import.meta.dirname, '..')
const out = resolve(process.argv[2] ?? 'docs/prototypes/native-app-input')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sourceDigest = createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'apps', 'packages'], { cwd: root })).digest('hex')
const appPath = process.env.ROVAI_PERF_APP_PATH
const fixtureLabel = process.env.ROVAI_PERF_LABEL?.trim()
// The worktree revision is not an attestation of a previously packaged App.
// Keep the actual artifact identity alongside the build log when comparing.
const binary = appPath ? await fingerprintApp(resolve(appPath)) : null
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-native-app-input-')))
const data = join(fixture, 'user-data'), controlPath = join(fixture, 'control.json')
const runtime = join(fixture, 'copilot-fixture'), minimal = join(fixture, 'minimal')
const executable = appPath ? join(resolve(appPath), 'Contents/MacOS/Rovai AI') : electron
const host = resolve(appPath ? join(resolve(appPath), 'Contents/Resources/bin/rovai-host')
  : process.env.ROVAI_HOST_BIN ?? join(root, 'resources/bin/macos-arm64/rovai-host'))
// Desktop's production Host embeds Core. The standalone binary is used only
// to create the fixture before that Host starts, and is recorded separately.
const coreExecutable = resolve(process.env.ROVAI_CORE_BIN ?? join(root, 'resources/bin/macos-arm64/rovai-core'))
const seedCoreSha256 = createHash('sha256').update(await readFile(coreExecutable)).digest('hex')
await mkdir(out, { recursive: true }); await mkdir(data, { recursive: true })
console.log(JSON.stringify({ channel: 'automatic_acceptance', fixture, userData: data,
  skillLibrary: join(data, 'managed-skill-library'), sourceCommit, sourceDigest, fixtureLabel,
  productionRenderer: Boolean(appPath), binary, seedCoreSha256, sourceIdentity: 'worktree; map the binary using its package build log',
  actualHost: true, upstream: 'controlled synthetic ACP', realModel: false }))
seedCompletedOnboardingForAcceptance(data)
await writeFile(join(data, 'window-state.json'), JSON.stringify({ schemaVersion: 1, width: 1440, height: 800, x: 0, y: 30 }))
let browser, core, commandInput, isMinimal = false, selectedCase, threads, currentControl = {}, activeRuns = []
let traceChunks = null, removeTraceListener, publicationTimer
const publications = new Map()
const env = { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_HOST_BIN: host, ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const setControl = async value => {
  currentControl = { ...currentControl, ...value }
  await writeFile(controlPath + '.next', JSON.stringify(currentControl))
  await (await import('node:fs/promises')).rename(controlPath + '.next', controlPath)
}
const request = async (method, params = {}) => {
  const result = await browser.evaluate(`window.rovai.request(${JSON.stringify(method)},${JSON.stringify(params)}).then(value=>({value}),error=>({error:{code:error?.code,message:error?.message??String(error)}}))`)
  if (result.error) throw new Error(`${method}: ${JSON.stringify(result.error)}`)
  return result.value
}
const waitUntil = async (operation, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await operation(); if (value) return value; await pause(100) }
  throw new Error('Timed out: ' + label)
}
try {
  await setControl({ current: false, other: false, finish: false })
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  await writeFile(runtime, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'scripts/fixtures/input-performance-acp-runtime.mjs'))} --fixture-control ${quote(controlPath)} "$@"\n`)
  await chmod(runtime, 0o700)
  for (const name of ['short', 'current', 'other']) await mkdir(join(fixture, 'project-' + name))
  await access(coreExecutable); await access(host)
  core = startQualificationCore({ coreExecutable, dataDirectory: data, workingDirectory: root,
    runtimeCacheDirectory: join(fixture, 'cache'), mcpConfigPath: join(data, 'mcp.json') })
  await core.request('health.check')
  console.log(JSON.stringify({ stage: 'seed-core-ready' }))
  const startup = await core.request('runtime.startup.get', { runtimeKind: 'copilot-cli' })
  await core.request('runtime.startup.save', { runtimeKind: 'copilot-cli', expectedRevision: startup.revision,
    configuration: { programPath: runtime, environment: [] } })
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  const check = await core.request('runtime.product.check', { runtimeKind: 'copilot-cli' })
  console.log(JSON.stringify({ stage: 'synthetic-runtime-check', check }))
  assert.equal(check.ready, true)
  await core.request('runtime.modelCatalog.open', { runtimeKind: 'copilot-cli', waitForRefresh: true, forceRefresh: true })
  const installation = await waitUntil(async () => {
    const installations = (await core.request('runtime.installations.list')).filter(item => item.adapterKind === 'copilot-cli')
    await writeFile(join(out, 'runtime-admission.json'), JSON.stringify(installations, null, 2))
    // Product check owns version admission; the static installation snapshot can
    // remain installed_unverified until execution. Actual Runs below must pass
    // the unchanged production launch gate and emit real Host events.
    return installations.find(item => item.executablePath === runtime && item.memberRuntimeDefaults)
  }, 'synthetic ACP admission')
  assert.equal(await realpath(installation.executablePath), await realpath(runtime))
  const members = (await core.request('members.list')).filter(member => member.presence === 'present').slice(0, 2)
  assert.equal(members.length, 2)
  for (const member of members) {
    const result = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
      agentId: member.agentId, expectedVersion: member.version, adapterKind: 'copilot-cli',
      model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions
    } })
    assert.equal(result.status, 'applied')
  }
  threads = {}
  for (const [name, count] of [['short', 20], ['current', 1000], ['other', 20]]) {
    const member = members[name === 'other' ? 1 : 0]
    const title = `原生输入性能对照 · ${fixtureLabel ? fixtureLabel + ' · ' : ''}${name} · ${count}`
    const created = await core.request('camps.create', { commandId: randomUUID(), name: title,
      workspace: { projectPath: join(fixture, 'project-' + name) }, memberAgentIds: [member.agentId],
      defaultLeadAgentId: member.agentId, collaborationMode: 'peer', activationState: 'active' })
    assert.equal(created.status, 'applied', JSON.stringify(created))
    threads[name] = { id: created.payload.threadId, title, count, agentId: member.agentId }
  }
  await core.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
  assert.equal((await core.stop()).code, 0); core = null
  const db = new DatabaseSync(join(data, 'rovai.sqlite'))
  const insert = db.prepare(`INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,structured_content_json,address_mode,addressed_agent_ids_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'default','[]',1,?,?)`)
  db.exec('BEGIN IMMEDIATE')
  for (const [name, thread] of Object.entries(threads)) for (let index = 1; index <= thread.count; index++) {
    const body = `会话输入与执行进展核对 ${index}。\n\n- 保留草稿和选区\n- 保留消息顺序\n\n| 项目 | 状态 |\n| --- | --- |\n| 草稿 | 已保存 |\n\n~~~ts\nconst sample = { count: 42, active: true };\nconsole.log(sample);\n~~~`
    const author = index % 2 ? 'user' : 'agent'
    const at = new Date(1_700_000_000_000 + index * 8_000).toISOString()
    insert.run(`native-${name}-${index}`, thread.id, index, author, author === 'agent' ? thread.agentId : 'local_user',
      body, JSON.stringify([{ kind: 'text', text: body }]), at, at)
  }
  for (const thread of Object.values(threads)) db.prepare('UPDATE camp SET last_message_sequence=? WHERE id=?').run(thread.count, thread.id)
  db.exec('COMMIT'); db.close()
  await build({ configFile: false, root: join(root, 'scripts/fixtures/native-input-minimal'), base: './', logLevel: 'error',
    plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } }, build: { outDir: minimal, minify: true } })
  await writeFile(join(fixture, 'minimal.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(fixture, 'minimal-user-data'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:true,width:1440,height:800,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});w.loadFile(${JSON.stringify(join(minimal, 'index.html'))})});app.on('window-all-closed',()=>app.quit());`)
  await writeFile(join(out, 'fixture.json'), JSON.stringify({ fixture, data, threads, host, coreExecutable, seedCoreSha256, sourceCommit, sourceDigest, binary }, null, 2))
  await selectCase(process.argv[3] ?? 'minimal')
  commandInput = createInterface({ input: process.stdin })
  process.once('SIGINT', () => commandInput.close())
  process.once('SIGTERM', () => commandInput.close())
  for await (const line of commandInput) {
    if (!line.trim()) continue
    try {
      const command = JSON.parse(line)
      if (command.op === 'quit') break
      if (command.op === 'case') await selectCase(command.name)
      else if (command.op === 'save') await save(command)
      else if (command.op === 'software-plain') await softwarePlain(command)
      else if (command.op === 'trace-start') {
        assert.equal(traceChunks, null)
        traceChunks = []
        removeTraceListener = browser.onProtocolEvent(message => {
          if (message.method === 'Tracing.dataCollected') traceChunks.push(...message.params.value)
        })
        await browser.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,input,latencyInfo,cc', transferMode: 'ReportEvents' })
        console.log(JSON.stringify({ tracing: true }))
      }
      else if (command.op === 'trace-stop') {
        assert.ok(traceChunks)
        const complete = new Promise(resolve => {
          const remove = browser.onProtocolEvent(message => {
            if (message.method === 'Tracing.tracingComplete') { remove(); resolve() }
          })
        })
        await browser.send('Tracing.end'); await complete
        assert.match(command.label, /^[a-zA-Z0-9_-]+$/)
        await writeFile(join(out, command.label + '.trace.json'), JSON.stringify({ traceEvents: traceChunks }), { flag: 'wx' })
        removeTraceListener(); traceChunks = null
        console.log(JSON.stringify({ tracing: false, saved: command.label }))
      }
      else if (command.op === 'status') console.log(JSON.stringify({ selectedCase, state: await browser.evaluate(`({round:window.__nativeInputRecorder.snapshot().at(-1).round,editor:document.querySelector('[contenteditable=true]')?.textContent,activity:document.querySelector('.run-presence-preview')?.textContent})`) }))
      else if (command.op === 'publish') {
        assert.ok(['current', 'both'].includes(selectedCase), 'publication requires the fixture current Run')
        const publicationId = randomUUID(), file = join(fixture, 'large-reply-' + publicationId + '.md')
        const publicationResult = join(fixture, 'publication-' + publicationId + '.json')
        const text = '大回复到达性能检查。\n\n| 项目 | 结果 |\n| --- | --- |\n| 输入 | 持续 |\n\n~~~ts\nconsole.log("large reply");\n~~~\n\n'.repeat(150) + publicationId
        await writeFile(file, text)
        publications.set(publicationId, { result: publicationResult, threadId: threads.current.id })
        clearTimeout(publicationTimer)
        publicationTimer = setTimeout(async () => {
          try {
            await browser.evaluate("window.__nativeInputRecorder.mark('large-reply-request'," + JSON.stringify({ publicationId, expectedCodeBlocks: 150 }) + ")")
            await setControl({ publishFile: file, publicationResult, publicationThreadId: threads.current.id })
          } catch (error) { console.error(JSON.stringify({ publicationError: String(error) })) }
        }, command.delayMs ?? 3_000)
        console.log(JSON.stringify({ scheduled: 'large-reply', delayMs: command.delayMs ?? 3_000 }))
      }
    } catch (error) { console.error(JSON.stringify({ error: error.stack ?? String(error) })) }
  }
} finally {
  commandInput?.close(); process.stdin.pause()
  clearTimeout(publicationTimer)
  await archiveRecorder('final').catch(error => console.error(String(error)))
  await setControl({ current: false, other: false, finish: true })
  if (browser && !isMinimal) await waitUntil(async () => (await Promise.all(activeRuns.map(async active =>
    (await request('threads.snapshot', { threadId: active.threadId })).agentRuns.find(run => run.id === active.id)
  ))).every(run => !run || ['succeeded', 'failed', 'cancelled'].includes(run.status)), 'terminal Run flush').catch(error => console.error(String(error)))
  await browser?.close(); await core?.stop()
  await removeEphemeralRuntimeCampFilesRoot(data).catch(error => console.error(error.message))
  await rm(fixture, { recursive: true, force: true })
}

async function selectCase(name) {
  assert.ok(['minimal', 'short', 'long-idle', 'current', 'other', 'both'].includes(name))
  clearTimeout(publicationTimer)
  await archiveRecorder('before-' + name)
  const nextMinimal = name === 'minimal'
  await setControl({ current: false, other: false, publishFile: null, finish: false })
  if (browser && isMinimal !== nextMinimal) { await browser.close(); browser = null; activeRuns = [] }
  isMinimal = nextMinimal
  if (!browser) {
    browser = await launchAcceptanceBrowser({ executable: isMinimal ? electron : executable,
      args: isMinimal ? [join(fixture, 'minimal.cjs'), '--remote-debugging-port=0']
        : [ ...(appPath ? [] : [root]), `--user-data-dir=${data}`, '--remote-debugging-port=0' ], env })
    await browser.send('Emulation.clearDeviceMetricsOverride')
    await browser.send('Page.bringToFront')
    await browser.wait(`document.visibilityState==='visible'`)
    if (!isMinimal) {
      await browser.wait(`window.rovai?.supervisor.getSnapshot().then(s=>s.fullCoreState==='ready')`, 45_000)
      assert.equal(await realpath((await request('app.info')).dataDir), await realpath(data), 'actual App must own the isolated fixture')
    }
  }
  if (!isMinimal) {
    for (const active of activeRuns) {
      const run = (await request('threads.snapshot', { threadId: active.threadId })).agentRuns.find(run => run.id === active.id)
      if (run && !['succeeded', 'failed', 'cancelled'].includes(run.status))
        await request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId: active.threadId, agentRunId: run.id, expectedVersion: run.version } })
    }
    activeRuns = []
    const thread = threads[name === 'short' ? 'short' : 'current']
    // Fresh profiles can start on Home with collapsed project navigation.
    // Select the real Thread by identity, or its visible recent-Thread card.
    const threadButton = `(document.querySelector(${JSON.stringify(`[data-thread-id="${thread.id}"] .camp-nav-open`)})
      ?? [...document.querySelectorAll('.quick-chat-continue-row')].find(e=>e.querySelector('[title]')?.title===${JSON.stringify(thread.title)}))`
    await browser.wait(`!!${threadButton}`, 30_000)
    await browser.evaluate(`${threadButton}.click();true`)
    await browser.wait(`document.querySelector('[contenteditable=true]')?.dataset.threadId===${JSON.stringify(thread.id)}`)
    for (let page = 0; page < 25; page++) {
      const button = await browser.evaluate(`!!document.querySelector('.camp-history-text-button')`)
      if (!button) break
      await browser.evaluate(`document.querySelector('.timeline-scroll').scrollTop=0;document.querySelector('.camp-history-text-button')?.click()`)
      await pause(100)
      await browser.wait(`!document.querySelector('.camp-history-loader.is-loading')`)
    }
    assert.equal(await browser.evaluate(`!!document.querySelector('.camp-history-text-button')`), false, 'all history pages must be loaded')
    await browser.evaluate(`document.querySelector('.timeline-scroll').scrollTop=document.querySelector('.timeline-scroll').scrollHeight`)
    for (const runName of name === 'both' ? ['current', 'other'] : ['current', 'other'].includes(name) ? [name] : []) {
      const target = threads[runName]
      const sent = await request('thread.messages.send', { commandId: randomUUID(), threadId: target.id,
        content: { version: 2, segments: [{ kind: 'text', text: '原生输入性能验收，请持续输出测试进展。' }] },
        sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
        execution: { taskId: null, purpose: 'Isolated input performance', completionRole: 'required' } })
      assert.equal(sent.commandResult.status, 'accepted', JSON.stringify(sent))
      const run = await waitUntil(async () => (await request('threads.snapshot', { threadId: target.id })).agentRuns.find(run => run.status === 'running'), 'active synthetic ACP Run')
      activeRuns.push({ id: run.id, threadId: target.id })
    }
    await setControl({ current: name === 'current' || name === 'both', other: name === 'other' || name === 'both' })
    if (name === 'current' || name === 'both') await browser.wait(`document.querySelector('.run-presence-preview')?.textContent.includes('进展')`, 20_000)
  }
  await browser.wait(`!!document.querySelector('[contenteditable=true]')`)
  await pause(600)
  selectedCase = name
  await browser.evaluate(`(${installNativeInputRecorder.toString()})(${JSON.stringify({ scenario: name, sourceCommit, sourceDigest, eventIntervalMs: isMinimal || ['short', 'long-idle'].includes(name) ? null : 32, inputSource: 'native-person-or-CUA', actualApp: !isMinimal, upstream: 'synthetic ACP through actual Host' })})`)
  await browser.click(`document.querySelector('[contenteditable=true]')`)
  console.log(JSON.stringify({ ready: true, selectedCase, activeRuns, environment: await browser.evaluate(`({width:innerWidth,height:innerHeight,devicePixelRatio,visibility:document.visibilityState,mounted:document.querySelectorAll('.timeline-scroll [data-message-id]').length})`) }))
}

async function archiveRecorder(reason) {
  if (!browser || !selectedCase) return
  const rows = await browser.evaluate('window.__nativeInputRecorder?.snapshot()')
  if (rows?.length) await writeFile(join(out, `raw-${selectedCase}-${reason}-${Date.now()}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' })
}

// Separate software-injected ordinary keys from native-person/CUA/IME rounds.
// Node's fixed cadence continues while the Renderer is busy, so slow UI work
// cannot quietly reduce the input or background load offered to the App.
async function softwarePlain(command) {
  const samples = command.samples ?? 180, rounds = command.rounds ?? 3
  const timestampMode = command.timestampMode ?? 'browser-arrival'
  assert.ok(['browser-arrival', 'planned'].includes(timestampMode))
  assert.ok(Number.isInteger(samples) && samples > 0 && samples <= 1000)
  assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 10)
  assert.match(command.label, /^[a-zA-Z0-9_-]+$/)
  await archiveRecorder('before-software')
  await browser.evaluate(`(${installNativeInputRecorder.toString()})(${JSON.stringify({
    scenario: selectedCase, sourceCommit, sourceDigest, inputSource: 'CDP-software-keys', timestampMode,
    actualApp: !isMinimal, eventIntervalMs: activeRuns.length ? 32 : null,
    upstream: 'synthetic ACP through actual Host', keyIntervalMs: 100
  })})`)
  await browser.click(`document.querySelector('[contenteditable=true]')`)
  const dispatch = [], clocks = []
  const key = async (value, code, virtualKey, modifiers = 0, commands) => {
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code,
      windowsVirtualKeyCode: virtualKey, modifiers, ...(commands ? { commands } : {}) })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: virtualKey })
  }
  for (let round = 1; round <= rounds; round++) {
    await key('Escape', 'Escape', 27)
    await key('a', 'KeyA', 65, process.platform === 'darwin' ? 4 : 2, ['selectAll'])
    await key('Backspace', 'Backspace', 8)
    assert.equal(await browser.evaluate(`document.querySelector('[contenteditable=true]').textContent.replaceAll('\\u200b','')`), '')
    const hostBefore = Date.now()
    const clock = await browser.evaluate(`({dateNow:Date.now(),timeOrigin:performance.timeOrigin,now:performance.now()})`)
    clocks.push({ round, hostBefore, ...clock, hostAfter: Date.now() })
    console.log(JSON.stringify({ phase: 'software-plain', selectedCase, round, rounds, samples }))
    const origin = Date.now() + 150, pending = [], failures = []
    await Promise.all(Array.from({ length: samples }, (_, index) => new Promise(resolve => {
      setTimeout(() => {
        const plannedAt = origin + index * 100, sentAt = Date.now()
        dispatch.push({ round, index, plannedAt, sentAt, delayMs: sentAt - plannedAt })
        pending.push(browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', text: 'a',
          windowsVirtualKeyCode: 65, ...(timestampMode === 'planned' ? { timestamp: plannedAt / 1000 } : {}) }).catch(error => failures.push(error)))
        resolve()
      }, Math.max(0, origin + index * 100 - Date.now()))
    })))
    await Promise.all(pending)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
    await pause(800)
    // Retain the raw round even if delivery or content validation fails.
    await archiveRecorder('software-round-' + round)
    await writeFile(join(out, command.label + '-dispatch-' + round + '.json'), JSON.stringify({ timestampMode, clocks, dispatch }), { flag: 'wx' })
    assert.deepEqual(failures, [])
  }
  await save({ label: command.label, kind: 'plain', samples, rounds: Array.from({ length: rounds }, (_, index) => index + 1),
    driver: { timestampMode, clocks, delayMs: inputStatistics(dispatch.map(row => row.delayMs)), maxDelayMs: Math.max(...dispatch.map(row => row.delayMs)) } })
}

async function save(command) {
  const rows = await browser.evaluate(`window.__nativeInputRecorder.snapshot()`)
  const label = command.label ?? selectedCase
  assert.match(label, /^[a-zA-Z0-9_-]+$/)
  await writeFile(join(out, label + '-events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' })
  const rounds = command.rounds ?? [...new Set(rows.filter(row => row.type === 'keydown' && row.round > 0).map(row => row.round))]
  const results = command.kind === 'plain'
    ? rounds.map(round => summarizeNativePlainRound(rows, round, { samples: command.samples ?? 180 }))
    : rounds.map(round => summarizeNativeImeRound(rows, round, { repetitions: command.repetitions ?? 30 }))
  for (const result of results) {
    const keys = rows.filter(row => row.type === 'keydown' && row.round === result.round
      && !row.metaKey && !row.ctrlKey && !row.altKey && (/^Key/.test(row.code ?? '') || row.code === 'Space'))
    const first = keys[0].start, end = keys.at(-1).start + 100
    result.backgroundRuns = activeRuns.map(run => {
      const events = rows.filter(row => row.type === 'backgroundEvent' && row.runId === run.id && row.at >= first && row.at < end)
      assert.ok(events.length, 'the declared background Run must emit during the input round')
      return { ...run, events: events.length, eventsPerSecond: events.length * 1000 / (end - first) }
    })
    result.focusedKeys = keys.filter(key => key.focused === true).length
    assert.equal(result.focusedKeys, keys.length, 'visible native acceptance requires a focused editor for every key')
    assert.ok(keys.every(key => key.visibility === 'visible' && key.trusted), 'native acceptance requires visible trusted input')
    const targetThreadId = isMinimal ? null : threads[selectedCase === 'short' ? 'short' : 'current'].id
    result.messageArrivalWindows = rows.filter(row => row.type === 'messageChange' && row.threadId === targetThreadId
      && row.at >= first && row.at < end).map(marker => ({ at: marker.at,
      ...summarizeNativeKeys(keys.filter(key => key.start >= marker.at - 100 && key.start < marker.at + 700),
        rows.filter(row => row.type === 'eventTiming'), { coverage: nativeTimingCoverage(rows) }) }))
  }
  const publicationEvidence = []
  for (const marker of rows.filter(row => row.type === 'marker' && row.name === 'large-reply-request')) {
    const completed = rows.find(row => row.type === 'bodyReady' && row.publicationId === marker.publicationId)
    assert.ok(completed, 'the published large reply must finish all independent code blocks')
    const publication = publications.get(marker.publicationId)
    const sent = JSON.parse(await readFile(publication.result, 'utf8'))
    assert.equal(sent.code, 0); assert.equal(sent.threadId, publication.threadId)
    assert.equal(completed.messageId, sent.ack.messageId)
    const hint = rows.find(row => row.type === 'messageChange' && row.threadId === publication.threadId && row.at >= marker.at)
    assert.ok(hint, 'the production message event must arrive in the recorder')
    publicationEvidence.push({ publicationId: marker.publicationId, messageId: completed.messageId,
      domReadyFromRequestMs: completed.at - marker.at, codeBlocks: completed.codeBlocks,
      hintAt: hint.at, domReadyFromHintMs: completed.at - hint.at,
      endpoint: completed.endpoint })
  }
  const report = { scenario: selectedCase, sourceCommit, sourceDigest, binary, environment: rows.find(row => row.type === 'environment'), results,
    driver: command.driver,
    longTasks: rows.filter(row => row.type === 'longtask'), backgroundLoad: rows.find(row => row.type === 'backgroundLoad'),
    markers: rows.filter(row => row.type === 'marker'), publicationEvidence, errors: browser.errors }
  await writeFile(join(out, label + '-results.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ saved: label, results, longTasks: report.longTasks.length }))
}

async function fingerprintApp(app) {
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const directoryDigest = async directory => {
    const hash = createHash('sha256')
    const visit = async (path, prefix = '') => {
      for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const relative = prefix + entry.name
        if (entry.isDirectory()) await visit(join(path, entry.name), relative + '/')
        else if (entry.isFile()) hash.update(relative + '\0' + digest(await readFile(join(path, entry.name))) + '\n')
        else throw new Error('Unsupported bundle entry: ' + relative)
      }
    }
    await visit(directory)
    return hash.digest('hex')
  }
  const resources = join(app, 'Contents/Resources')
  const asar = await access(join(resources, 'app.asar')).then(() => true, () => false)
  return { appPath: app, rendererSha256: await directoryDigest(join(resources, 'web-ui')),
    mainSha256: asar ? digest(await readFile(join(resources, 'app.asar'))) : await directoryDigest(join(resources, 'app')),
    hostSha256: digest(await readFile(join(resources, 'bin/rovai-host'))), coreImplementation: 'embedded-in-host' }
}
