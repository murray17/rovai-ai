import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join, resolve } from 'node:path'

/**
 * Sequential matrix driver for the real-token Memory Camp diagnostic.
 *
 * Environment:
 *   ROVAI_MEMORY_CAMP_ADAPTERS=all|adapter,adapter  (default: all)
 *   ROVAI_MEMORY_CAMP_MODE=preflight|natural|stewarded|both
 *   ROVAI_MEMORY_CAMP_SUITE=probe|quick|full
 *   ROVAI_MEMORY_CAMP_STRICT=0|1                    (default: 1)
 *   ROVAI_MEMORY_CAMP_REPORT_DIR=<directory>
 *   ROVAI_MEMORY_CAMP_MATRIX_REPORT=<json path>
 *
 * All worker-specific environment variables are forwarded unchanged.
 */

const root = resolve(import.meta.dirname, '..')
const workerPath = join(root, 'scripts', 'diagnose-memory-camp-behavior.mjs')
const allAdapterKinds = [
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'antigravity-app',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli'
]
const adapters = selectAdapters(process.env.ROVAI_MEMORY_CAMP_ADAPTERS ?? 'all')
const runStamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const reportDirectory = process.env.ROVAI_MEMORY_CAMP_REPORT_DIR
  ? resolve(process.env.ROVAI_MEMORY_CAMP_REPORT_DIR)
  : join(root, 'artifacts', `memory-camp-matrix-${runStamp}`)
const aggregatePath = process.env.ROVAI_MEMORY_CAMP_MATRIX_REPORT
  ? resolve(process.env.ROVAI_MEMORY_CAMP_MATRIX_REPORT)
  : join(reportDirectory, 'summary.json')
const aggregate = {
  schemaVersion: 1,
  status: 'running',
  ok: false,
  startedAt: new Date().toISOString(),
  completedAt: null,
  mode: process.env.ROVAI_MEMORY_CAMP_MODE ?? 'both',
  suite: process.env.ROVAI_MEMORY_CAMP_SUITE ?? 'probe',
  strict: (process.env.ROVAI_MEMORY_CAMP_STRICT ?? '1') === '1',
  adapters,
  reportDirectory,
  results: []
}

await persistAggregate()
for (const [index, adapterKind] of adapters.entries()) {
  const reportPath = join(reportDirectory, `${String(index + 1).padStart(2, '0')}-${adapterKind}.json`)
  process.stderr.write(`[memory-camp-matrix] ${index + 1}/${adapters.length} ${adapterKind}: start\n`)
  const startedAt = Date.now()
  const child = await runWorker(adapterKind, reportPath)
  let workerReport = null
  try {
    workerReport = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch (error) {
    child.stderrTail.push(`Unable to read worker report: ${safeMessage(error)}`)
  }
  const ok = child.code === 0 && workerReport?.ok === true
  const result = {
    adapterKind,
    ok,
    status: workerReport?.status ?? (child.code === 0 ? 'unknown' : 'failed'),
    exitCode: child.code,
    signal: child.signal,
    durationMs: Date.now() - startedAt,
    runtimeVersion: workerReport?.runtimeVersion ?? null,
    configuredModel: workerReport?.configuredModel ?? null,
    observedModels: workerReport?.observedModels ?? [],
    metrics: workerReport?.metrics ?? null,
    fixtureRoot: workerReport?.fixtureRoot ?? null,
    fixtureRetained: workerReport?.fixtureRetained ?? null,
    reportPath,
    error: workerReport?.error ?? null,
    workerStderrTail: ok ? [] : child.stderrTail.slice(-20)
  }
  aggregate.results.push(result)
  await persistAggregate()
  process.stderr.write(
    `[memory-camp-matrix] ${index + 1}/${adapters.length} ${adapterKind}: ${ok ? 'passed' : 'failed'} (${result.durationMs} ms)\n`
  )
}

aggregate.ok = aggregate.results.every((result) => result.ok)
aggregate.status = aggregate.ok ? 'passed' : 'failed'
aggregate.completedAt = new Date().toISOString()
await persistAggregate()

console.log(JSON.stringify({
  ok: aggregate.ok,
  status: aggregate.status,
  mode: aggregate.mode,
  suite: aggregate.suite,
  reportPath: aggregatePath,
  results: aggregate.results.map((result) => ({
    adapterKind: result.adapterKind,
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    configuredModel: result.configuredModel,
    observedModels: result.observedModels,
    naturalCaptured: result.metrics?.naturalCaptured ?? null,
    stewardedCapturedCount: result.metrics?.stewardedCapturedCount ?? null,
    strictPassed: result.metrics?.strictPassed ?? null,
    diagnosis: result.metrics?.diagnosis ?? null,
    reportPath: result.reportPath,
    error: result.error
  }))
}, null, 2))
if (!aggregate.ok) process.exitCode = 1

function selectAdapters(value) {
  const selected = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  if (selected.length === 1 && selected[0] === 'all') return [...allAdapterKinds]
  if (selected.length === 0) throw new Error('ROVAI_MEMORY_CAMP_ADAPTERS selected no Runtime')
  const unique = [...new Set(selected)]
  for (const adapterKind of unique) {
    if (!allAdapterKinds.includes(adapterKind)) {
      throw new Error(`Unsupported ROVAI_MEMORY_CAMP_ADAPTERS value: ${adapterKind}`)
    }
  }
  return unique
}

function runWorker(adapterKind, reportPath) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [workerPath], {
      cwd: root,
      env: {
        ...process.env,
        ROVAI_MEMORY_CAMP_ADAPTER: adapterKind,
        ROVAI_MEMORY_CAMP_MODE: aggregate.mode,
        ROVAI_MEMORY_CAMP_SUITE: aggregate.suite,
        ROVAI_MEMORY_CAMP_STRICT: aggregate.strict ? '1' : '0',
        ROVAI_MEMORY_CAMP_REPORT: reportPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    let stdoutBytes = 0
    const stderrTail = []
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolveRun(result)
    }
    child.stdout.on('data', (chunk) => {
      const value = String(chunk)
      stdout.push(value)
      stdoutBytes += value.length
      while (stdoutBytes > 256_000 && stdout.length > 1) {
        stdoutBytes -= stdout.shift().length
      }
    })
    createInterface({ input: child.stderr }).on('line', (line) => {
      const safeLine = redact(line)
      if (safeLine.startsWith('[memory-camp]')) process.stderr.write(`${safeLine}\n`)
      else {
        stderrTail.push(safeLine)
        if (stderrTail.length > 80) stderrTail.shift()
      }
    })
    child.once('error', (error) => finish({
      code: null,
      signal: null,
      stdout: redact(stdout.join('')),
      stderrTail: [...stderrTail, safeMessage(error)]
    }))
    child.once('close', (code, signal) => finish({
      code,
      signal,
      stdout: redact(stdout.join('')),
      stderrTail
    }))
  })
}

async function persistAggregate() {
  await mkdir(dirname(aggregatePath), { recursive: true })
  await writeFile(aggregatePath, `${JSON.stringify(redactDeep(aggregate), null, 2)}\n`)
}

function redact(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_TEST_SECRET]')
    .replaceAll('43127', '[REDACTED_TRANSIENT_PORT]')
}

function redactDeep(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactDeep(child)]))
  }
  return value
}

function safeMessage(error) {
  return redact(error instanceof Error ? error.message : String(error))
}
