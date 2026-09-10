import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

// Explicit real-model acceptance. The caller supplies an isolated HOME with
// official account-login or BYOK configuration, never a production Core root.
const repo = resolve(import.meta.dirname, '..')
const root = await realpath(process.env.ROVAI_ZCODE_IMAGE_SMOKE_ROOT ?? await mkdtemp(join(tmpdir(), 'rvzi-')))
const data = join(root, 'data'), project = join(root, 'project')
const events = [], trace = join(root, 'methods.jsonl'), hook = join(root, 'trace.cjs')
let core, passed = false
await mkdir(project)
await writeFile(join(project, 'README.md'), '# Isolated image input acceptance\n')
for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@rovai.local', 'commit', '-m', 'fixture']]) execFileSync('git', args, { cwd: project, stdio: 'ignore' })
await writeFile(hook, `if(process.argv.some(a=>a.endsWith('/zcode.cjs'))&&process.argv.includes('app-server')){
const fs=require('node:fs');const record=v=>fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(v)+'\\n',{mode:0o600});
const emit=process.stdin.emit;let input='';process.stdin.emit=function(name,...args){if(name==='data'){input+=args[0].toString();let n;while((n=input.indexOf('\\n'))>=0){const line=input.slice(0,n);input=input.slice(n+1);try{const v=JSON.parse(line);if(v.method)record({method:v.method,command:v.params?.type,images:v.params?.payload?.attachments?.length});}catch{}}}return Reflect.apply(emit,this,[name,...args])};
const write=process.stdout.write;let output='';process.stdout.write=function(chunk,...args){output+=chunk.toString();let n;while((n=output.indexOf('\\n'))>=0){const line=output.slice(0,n);output=output.slice(n+1);try{const v=JSON.parse(line);if(v.method==='session/event'&&v.params?.type==='model.streaming'&&v.params?.payload?.kind==='tool_call')record({toolCalled:true,toolName:v.params.payload.toolName});}catch{}}return Reflect.apply(write,this,[chunk,...args])};}
`)
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${hook}`.trim()
console.log(JSON.stringify({ stage: 'fixture', dataDirectory: data, skillLibrary: join(data, 'managed-skill-library'), nativeHome: process.env.HOME }))
const start = () => startQualificationCore({ coreExecutable: join(repo, 'target/debug/rovai-core'), dataDirectory: data, workingDirectory: repo, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'), onNotification: event => events.push(event) })
try {
  core = start()
  const workspace = await core.request('workspaces.inspect', { path: project })
  await configureProductRuntime(core.request, 'zcode-app', ['agent_2'])
  const before = await methods()
  assert(before.every(item => ['workspace/readState', 'session/create', 'session/subscribe', 'session/setMode'].includes(item.method)), 'Probe must not generate or upload')
  const created = await core.request('camps.create', { commandId: crypto.randomUUID(), name: 'ZCode vision acceptance', workspace: { projectPath: workspace.projectPath }, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', collaborationMode: 'peer' })
  assert.equal(created.status, 'applied')
  const campId = created.payload.campId
  const codes = [String(randomInt(100000, 999999)), String(randomInt(100000, 999999))]
  const images = await numberImages(codes)
  let draft = await core.request('camp.composerDraft.get', { campId })
  for (const [index, bytes] of images.entries()) {
    const sourcePath = join(root, `image-${index}.png`)
    await writeFile(sourcePath, bytes)
    draft = await core.request('camp.sourceAttachments.addFromPath', { campId, expectedRevision: draft.revision, sourcePath, displayName: `Image ${index + 1}.png` })
  }
  const first = await send(campId, draft, 'Use the native Read tool to open each of the two image paths in CURRENT_INPUT.attachments. Read the six digit number visible in each image. Answer with only the two numbers in attachment order, separated by a comma. Do not use shell commands or external OCR; the native Read tool supports images.')
  await finish(campId, first)
  const inspection = await core.request('camps.snapshot', { campId })
  const firstBody = inspection.messages.find(message => message.sourceAgentRunId === first)?.body ?? ''
  for (const code of codes) assert(firstBody.includes(code), 'Actual model must read the random number present only in the image')
  assert(firstBody.indexOf(codes[0]) < firstBody.indexOf(codes[1]), 'Image order must be preserved')
  const firstStart = events.find(event => event.method === 'agent_run.started' && event.params?.agentRunId === first)
  const nativeSession = firstStart?.params?.nativeThreadId
  assert(nativeSession)
  const evidence = await core.request('agentRunEvidence.list', { campId, agentRunId: first, afterSequence: 0, limit: 1000 })
  const reads = evidence.evidence.filter(item => item.canonical?.semanticKind === 'file.read')
  assert(reads.length >= 2, 'Both images must have native Read activity')
  assert(!evidence.evidence.some(item => ['file.write','file.edit','file.delete','file.move'].includes(item.canonical?.semanticKind)))
  assert(!inspection.agentRunFileChanges.some(item => item.agentRunId === first))
  assert(!evidence.evidence.some(item => item.canonical?.diffProjection?.status === 'available'), 'Reading an image must not create modification Diff')
  console.log(JSON.stringify({ stage: 'vision-passed', agentRunId: first, imageCount: 2, nativeReadActivity: true, noModificationDiff: true }))
  await core.stop(); core = start()
  const second = await send(campId, await core.request('camp.composerDraft.get', { campId }), 'Repeat the two six digit numbers you read in the previous images, in the same order. Do not call tools.')
  await finish(campId, second)
  const continuation = await core.request('camps.snapshot', { campId })
  const secondBody = continuation.messages.find(message => message.sourceAgentRunId === second)?.body ?? ''
  for (const code of codes) assert(secondBody.includes(code))
  assert(secondBody.indexOf(codes[0]) < secondBody.indexOf(codes[1]))
  assert.equal(events.find(event => event.method === 'agent_run.started' && event.params?.agentRunId === second)?.params?.nativeThreadId, nativeSession)
  const calls = await methods()
  assert(!calls.some(item => item.method?.startsWith('v4/attachment/')), 'Path delivery must not upload attachments')
  assert(calls.filter(item => item.command === 'sendText').every(item => item.images === undefined))
  assert(calls.filter(item => item.toolCalled).every(item => item.toolName === 'Read'), 'Native Read must handle vision without shell or external OCR')
  passed = true
  console.log(JSON.stringify({ stage: 'passed', nativeSessionId: nativeSession, imageCount: 2, nativeUploads: 0, exactColdResume: true, nativeReadOnly: true, probeDidNotGenerateOrUpload: true }))
} finally {
  if (core) { const stopped = await core.stop(); if (!passed) process.stderr.write(stopped.stderrTail) }
  await removeEphemeralRuntimeCampFilesRoot(data)
  if (passed) await rm(root, { recursive: true, force: true })
  else console.log(JSON.stringify({ stage: 'failed-fixture', root }))
}
async function send(campId, draft, body) {
  draft = await core.request('camp.composerDraft.save', { campId, expectedRevision: draft.revision, content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] }, body) })
  const sent = await core.request('camp.messages.send', { commandId: crypto.randomUUID(), campId, draftRevision: draft.revision, execution: { taskId: null, purpose: 'Native image input acceptance', completionRole: 'required' } })
  const result = sent.commandResult ?? sent
  assert.equal(result.status, 'accepted')
  assert(result.payload.agentRunIds[0])
  return result.payload.agentRunIds[0]
}
async function finish(campId, id) {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    const snapshot = await core.request('camps.snapshot', { campId })
    const run = snapshot.agentRuns.find(item => item.id === id)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      assert.equal(run.status, 'succeeded', JSON.stringify(run.failure))
      if (snapshot.turns.find(turn => turn.id === run.campTurnId)?.status === 'completed') return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 300))
  }
  throw new Error('Image Run timed out')
}
async function methods() { return (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }

async function numberImages(codes) {
  // This macOS qualification uses the system font: a tiny bitmap font makes
  // the OCR assertion ambiguous (for example, 5 versus 6) without testing transport.
  execFileSync('swift', ['-e', `
import AppKit
let codes = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8)!.split(separator: "\\n")
for (index, code) in codes.enumerated() {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 900, pixelsHigh: 220, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: 900, height: 220).fill()
    NSAttributedString(string: String(code), attributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 150, weight: .regular), .foregroundColor: NSColor.black]).draw(at: NSPoint(x: 160, y: 25))
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("image-\\(index).png"))
}
`, root], { input: codes.join('\n'), stdio: ['pipe', 'ignore', 'pipe'] })
  return Promise.all(codes.map((_, index) => readFile(join(root, `image-${index}.png`))))
}
