import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  ELECTRON_INTEGRATION_REQUIRED_ENV,
  admitElectronIntegrationTest,
  classifyMacOsSandboxProbe
} from './electron-sandbox-capability.mjs'

const nestedSandboxProbe = {
  status: 71,
  signal: null,
  stderr: 'sandbox-exec: sandbox_apply: Operation not permitted\n'
}

test('every real Electron fixture uses the shared sandbox capability admission', async () => {
  const files = (await readdir(import.meta.dirname))
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
  const sources = await Promise.all(files.map(async (file) => ({
    file,
    source: await readFile(join(import.meta.dirname, file), 'utf8')
  })))
  const electronFixtures = sources.filter(({ source }) => /from ['"]electron['"]/.test(source))

  assert.ok(electronFixtures.length > 0, 'expected at least one real Electron fixture')
  for (const { file, source } of electronFixtures) {
    assert.match(
      source,
      /from ['"]\.\/electron-sandbox-capability\.mjs['"]/,
      `${file} must import the shared admission`
    )
    assert.match(
      source,
      /if \(!admitElectronIntegrationTest\(t\)\) return/,
      `${file} must run the shared admission`
    )
    const admissionOffset = source.indexOf('if (!admitElectronIntegrationTest(t)) return')
    const fixtureOffset = source.indexOf('mkdtemp(')
    assert.ok(
      fixtureOffset === -1 || admissionOffset < fixtureOffset,
      `${file} must run the shared admission before fixture setup`
    )
  }
})

test('the macOS sandbox probe recognizes only the known nested-sandbox denial', () => {
  assert.deepEqual(classifyMacOsSandboxProbe(nestedSandboxProbe), {
    kind: 'blocked',
    reason: 'nested_macos_sandbox'
  })
  assert.deepEqual(classifyMacOsSandboxProbe({
    status: 1,
    signal: null,
    stderr: 'sandbox-exec: profile syntax error\n'
  }), {
    kind: 'failed',
    status: 1,
    signal: null,
    stderr: 'sandbox-exec: profile syntax error'
  })
})

test('non-macOS Electron integration does not invoke the macOS probe', () => {
  let probed = false
  const admitted = admitElectronIntegrationTest({ skip: () => assert.fail('must not skip') }, {
    platform: 'linux',
    environment: {},
    runProbe: () => {
      probed = true
      return nestedSandboxProbe
    }
  })

  assert.equal(admitted, true)
  assert.equal(probed, false)
})

test('an available macOS sandbox runs the Electron integration assertion', () => {
  const admitted = admitElectronIntegrationTest({ skip: () => assert.fail('must not skip') }, {
    platform: 'darwin',
    environment: {},
    runProbe: () => ({ status: 0, signal: null, stderr: '' })
  })

  assert.equal(admitted, true)
})

test('a nested macOS sandbox is an explicit local skip rather than a product failure', () => {
  const skipped = []
  const admitted = admitElectronIntegrationTest({
    skip: (reason) => skipped.push(reason)
  }, {
    platform: 'darwin',
    environment: {},
    runProbe: () => nestedSandboxProbe
  })

  assert.equal(admitted, false)
  assert.equal(skipped.length, 1)
  assert.match(skipped[0], /BLOCKED: nested macOS sandbox/)
  assert.match(skipped[0], /business assertions did not run/)
})

test('required and CI Electron integration reject the same environment block', () => {
  for (const environment of [
    { [ELECTRON_INTEGRATION_REQUIRED_ENV]: '1' },
    { CI: 'true' }
  ]) {
    assert.throws(() => admitElectronIntegrationTest({
      skip: () => assert.fail('required integration must not skip')
    }, {
      platform: 'darwin',
      environment,
      runProbe: () => nestedSandboxProbe
    }), /Electron integration is required.*nested macOS sandbox/)
  }
})

test('an unexpected sandbox probe failure remains a test failure', () => {
  assert.throws(() => admitElectronIntegrationTest({
    skip: () => assert.fail('unknown failures must not skip')
  }, {
    platform: 'darwin',
    environment: {},
    runProbe: () => ({
      status: null,
      signal: 'SIGKILL',
      stderr: 'unexpected probe failure'
    })
  }), /macOS sandbox capability probe failed.*SIGKILL.*unexpected probe failure/)
})
