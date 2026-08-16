import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireDevelopmentLaunchLock,
  assertDevelopmentUserDataIsIsolated,
  assertUserDataIsIsolated,
  defaultDevelopmentUserDataDirectory,
  seedCompletedOnboardingForAcceptance
} from './dev-desktop.mjs'

test('default development userData is deterministic per repository and outside daily data', () => {
  const first = defaultDevelopmentUserDataDirectory({
    repositoryRoot: '/workspace/rovai-ai',
    temporaryRoot: '/temporary'
  })
  const second = defaultDevelopmentUserDataDirectory({
    repositoryRoot: '/workspace/rovai-ai',
    temporaryRoot: '/temporary'
  })
  assert.equal(first, second)
  assert.match(first, /rovai-ai-development\/[^/]+\/user-data$/)
})

test('development userData rejects daily directories and their descendants', () => {
  const dailyDirectory = '/users/example/application-support/Rovai-ai'
  assert.throws(
    () => assertDevelopmentUserDataIsIsolated(dailyDirectory, { dailyDirectories: [dailyDirectory] }),
    /must not use the daily Rovai directory/
  )
  assert.throws(
    () => assertDevelopmentUserDataIsIsolated(join(dailyDirectory, 'child'), { dailyDirectories: [dailyDirectory] }),
    /must not use the daily Rovai directory/
  )
  assert.equal(
    assertDevelopmentUserDataIsIsolated('/temporary/rovai-dev', { dailyDirectories: [dailyDirectory] }),
    '/temporary/rovai-dev'
  )
})

test('every isolated channel requires an explicit path and rejects aliases of daily data', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-user-data-alias-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const dailyDirectory = join(root, 'daily')
  const alias = join(root, 'daily-alias')
  mkdirSync(dailyDirectory)
  symlinkSync(dailyDirectory, alias)

  assert.throws(() => assertUserDataIsIsolated(), /explicit isolated userData/)
  assert.throws(
    () => assertUserDataIsIsolated(join(alias, 'child'), { dailyDirectories: [dailyDirectory] }),
    /must not use the daily Rovai directory/
  )
})

test('development launch lock rejects a live owner and can be released', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-dev-lock-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const release = acquireDevelopmentLaunchLock(root)
  assert.equal(readFileSync(join(root, '.development-instance.lock'), 'utf8').trim(), String(process.pid))
  assert.throws(() => acquireDevelopmentLaunchLock(root), /already in use/)
  release()
  const releaseAgain = acquireDevelopmentLaunchLock(root)
  releaseAgain()
})

test('generic App acceptance can seed a private completed onboarding fixture', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-onboarding-fixture-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const dailyDirectory = join(root, 'daily')
  const userDataDirectory = join(root, 'isolated')
  const path = seedCompletedOnboardingForAcceptance(userDataDirectory, {
    dailyDirectories: [dailyDirectory]
  })
  const snapshot = JSON.parse(readFileSync(path, 'utf8'))

  assert.equal(snapshot.status, 'completed')
  assert.equal(snapshot.origin, 'existing_installation')
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(seedCompletedOnboardingForAcceptance(userDataDirectory, {
    dailyDirectories: [dailyDirectory]
  }), path)
  assert.throws(
    () => seedCompletedOnboardingForAcceptance(dailyDirectory, {
      dailyDirectories: [dailyDirectory]
    }),
    /must not use the daily Rovai directory/
  )
})
