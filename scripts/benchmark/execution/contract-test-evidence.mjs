import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from '../protocol/canonical.mjs'

export function classifyTestExecution(reference, execution) {
  const escaped = reference.testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const matches = [...execution.stdout.matchAll(new RegExp(`^test ([^\\n ]*::)?${escaped} \\.\\.\\. (ok|FAILED|ignored)(?: .*)?$`, 'gmu'))]
  const observed = matches.map(match => ({ name: `${match[1] ?? ''}${reference.testName}`, status: match[2] }))
  if (execution.timedOut || execution.spawnError || matches.length === 0 || observed.some(test => test.status === 'ignored')) return { status: 'indeterminate', observed }
  if (observed.some(test => test.status === 'FAILED')) return { status: 'failed', observed }
  return { status: execution.code === 0 ? 'passed' : 'indeterminate', observed }
}

export async function collectContractTestEvidence({ repositoryRoot, references, outputDirectory, timeoutMs }) {
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  const deadline = Date.now() + timeoutMs
  const records = []
  const unique = [...new Map(references.map(ref => [`${ref.locator}:${ref.testName}`, ref])).values()]
  for (const [index, reference] of unique.entries()) {
    const target = reference.locator.endsWith('/main.rs') ? ['--bin', 'rovai-core'] : ['--lib']
    const args = ['test', '-p', 'rovai-core', ...target, '--features', 'slow-tests', reference.testName, '--', '--test-threads=1']
    const remaining = deadline - Date.now()
    const execution = remaining <= 0 ? { code: null, stdout: '', stderr: '', timedOut: true, spawnError: null } : await execute('cargo', args, repositoryRoot, remaining)
    const classification = classifyTestExecution(reference, execution)
    const log = `${execution.stdout}\n${execution.stderr}`
    const locator = `test-${String(index + 1).padStart(3, '0')}.log`
    await writeFile(join(outputDirectory, locator), log, { mode: 0o600 })
    let sourceDigest = null
    try { sourceDigest = sha256(await readFile(join(repositoryRoot, reference.locator))) } catch { /* missing source is evidence insufficiency */ }
    records.push({ ...reference, ...classification, sourceDigest, command: ['cargo', ...args], code: execution.code, timedOut: execution.timedOut, spawnError: execution.spawnError, log: locator, logDigest: sha256(log) })
  }
  return records
}

function execute(command, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CARGO_TERM_COLOR: 'never' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let stdout = '', stderr = '', timedOut = false, spawnError = null
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', error => { spawnError = error.message })
    const terminate = signal => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
    let killTimer
    const timer = setTimeout(() => { timedOut = true; terminate('SIGTERM'); killTimer = setTimeout(() => terminate('SIGKILL'), 5_000) }, timeoutMs)
    child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer); resolve({ code, stdout, stderr, timedOut, spawnError }) })
  })
}
