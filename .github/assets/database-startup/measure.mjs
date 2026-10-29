// One-off acceptance harness: paired healthy Core starts, never a model request.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir, platform, arch } from 'node:os'
import { join, resolve } from 'node:path'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from '../../../scripts/lib/runtime-camp-files-root.mjs'

const [baselinePath, candidatePath, outputPath] = process.argv.slice(2)
if (!baselinePath || !candidatePath || !outputPath) throw new Error('Usage: node measure.mjs BASELINE_CORE CANDIDATE_CORE OUTPUT_JSON')
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-startup-paired-')))
const data = join(fixture, 'data')
await mkdir(data)
async function start(binary) {
  const started = performance.now()
  let stderr = ''
  const phases = []
  const child = spawn(resolve(binary), [...coreDataDirectoryArguments(data), '--skill-library-root', join(fixture, 'skills'), '--mcp-config-path', join(fixture, 'mcp.json')], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.on('data', bytes => { stderr += bytes })
  const lines = createInterface({ input: child.stdout })
  const exited = new Promise((resolve, reject) => { child.once('exit', code => resolve(code)); child.once('error', reject) })
  let timer
  try {
    const durationMs = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Startup timeout: ${stderr}`)), 30_000)
      child.once('error', reject)
      void exited.then(code => reject(new Error(`Premature exit ${code}: ${stderr}`)), reject)
      lines.on('line', line => {
        let frame
        try { frame = JSON.parse(line) } catch (error) { reject(error); return }
        if (frame.kind !== 'core_startup') return
        phases.push(frame.phase)
        if (frame.status === 'ready') resolve(performance.now() - started)
        if (['failed', 'blocked'].includes(frame.status)) reject(new Error(JSON.stringify(frame)))
      })
    })
    clearTimeout(timer)
    child.stdin.end()
    const shutdown = setTimeout(() => child.kill('SIGKILL'), 15_000)
    try { if (await exited !== 0) throw new Error('Core failed graceful shutdown') } finally { clearTimeout(shutdown) }
    return { durationMs, phases, trace: stderr.split('\n').filter(line => line.startsWith('[startup]')) }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => {})
    lines.close()
  }
}
try {
  await start(baselinePath) // Initialize once, excluded from healthy timing.
  await start(candidatePath) // Warm candidate executable, excluded equally.
  const baseline = [], candidate = []
  // Alternate pair order to reduce cache/load ordering effects.
  for (let i = 0; i < 9; i++) {
    const pairs = [[baselinePath, baseline], [candidatePath, candidate]]
    if (i % 2) pairs.reverse()
    for (const [binary, destination] of pairs) destination.push(await start(binary))
  }
  const median = rows => rows.map(row => row.durationMs).sort((a, b) => a - b)[4]
  const report = { platform: platform(), arch: arch(), samplesPerBinary: 9, scope: 'debug Core process spawn to ready; shared isolated healthy database; warm; no model; not daily session data', medianMs: { baseline: median(baseline), candidate: median(candidate) }, baseline, candidate }
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report.medianMs))
} finally {
  await removeEphemeralRuntimeCampFilesRoot(data, { temporaryDirectory: fixture })
  await rm(fixture, { recursive: true, force: true })
}
