import { spawnSync } from 'node:child_process'

export const ELECTRON_INTEGRATION_REQUIRED_ENV = 'ROVAI_REQUIRE_ELECTRON_INTEGRATION'

const MACOS_SANDBOX_EXECUTABLE = '/usr/bin/sandbox-exec'
const MACOS_SANDBOX_PROFILE = '(version 1) (allow default)'
const MACOS_SANDBOX_PROBE_TIMEOUT_MS = 5_000
const PROBE_OUTPUT_LIMIT = 1_024

export function classifyMacOsSandboxProbe(result) {
  const status = Number.isInteger(result?.status) ? result.status : null
  const signal = typeof result?.signal === 'string' ? result.signal : null
  const stderr = boundedProbeText([
    result?.error instanceof Error ? result.error.message : '',
    decodeProbeText(result?.stderr)
  ].filter(Boolean).join(' '))

  if (!result?.error && status === 0) return { kind: 'available' }
  if (
    !result?.error
    && status === 71
    && signal === null
    && /sandbox-exec:\s+sandbox_apply:\s+Operation not permitted/i.test(stderr)
  ) {
    return { kind: 'blocked', reason: 'nested_macos_sandbox' }
  }
  return { kind: 'failed', status, signal, stderr }
}

export function admitElectronIntegrationTest(testContext, {
  platform = process.platform,
  environment = process.env,
  runProbe = runMacOsSandboxProbe
} = {}) {
  if (platform !== 'darwin') return true

  const capability = classifyMacOsSandboxProbe(runProbe())
  if (capability.kind === 'available') return true
  if (capability.kind === 'failed') {
    throw new Error(
      'macOS sandbox capability probe failed: '
      + `status=${capability.status ?? 'none'} `
      + `signal=${capability.signal ?? 'none'} `
      + `stderr=${capability.stderr || 'none'}`
    )
  }

  const required = environment[ELECTRON_INTEGRATION_REQUIRED_ENV] === '1'
    || environment.CI === 'true'
  if (required) {
    throw new Error(
      'Electron integration is required, but a nested macOS sandbox prevents Chromium '
      + 'sandbox initialization; run this required check from an ordinary Terminal or CI host.'
    )
  }
  testContext.skip(
    'BLOCKED: nested macOS sandbox prevents Chromium sandbox initialization; '
    + 'business assertions did not run and this skip is not a passing acceptance result.'
  )
  return false
}

function runMacOsSandboxProbe() {
  return spawnSync(MACOS_SANDBOX_EXECUTABLE, [
    '-p',
    MACOS_SANDBOX_PROFILE,
    '--',
    '/usr/bin/true'
  ], {
    encoding: 'utf8',
    timeout: MACOS_SANDBOX_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function decodeProbeText(value) {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return ''
}

function boundedProbeText(value) {
  return value.trim().replaceAll(/\s+/g, ' ').slice(0, PROBE_OUTPUT_LIMIT)
}
