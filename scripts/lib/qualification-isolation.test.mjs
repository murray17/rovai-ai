import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  admitInterventionIsolationProfile,
  loadAndAdmitInterventionIsolationProfile,
  verifyInterventionIsolationContinuity
} from './qualification-isolation.mjs'
import { digestJson } from './qualification-common.mjs'

const IDENTITY_DIGEST = digest('runner-identity')
const EXPECTED = {
  suiteId: 'suite-1',
  plannedSlotId: 'slot-1',
  trialId: 'trial-1',
  caseId: 'TQ001',
  caseSeal: digest('case-seal'),
  dedicatedIdentityDigest: IDENTITY_DIGEST
}

test('complete versioned Isolation Profile is admitted only for its exact binding and identity', () => {
  const profile = validProfile()
  const admission = admitInterventionIsolationProfile(profile, EXPECTED)

  assert.equal(admission.status, 'admitted')
  assert.equal(admission.profileId, 'formal-cli-isolation')
  assert.equal(admission.payloadDigest, profile.payloadDigest)
  assert.equal(admission.formalAdmissible, true)
  assert.equal(admission.channels.workspaceWriters.coverage.state, 'complete')
  assert.equal(admission.artifact, profile)

  assert.throws(
    () => admitInterventionIsolationProfile(profile, { ...EXPECTED, suiteId: 'suite-2' }),
    (error) => error.code === 'intervention_isolation.binding_mismatch'
  )
  assert.throws(
    () => admitInterventionIsolationProfile(profile, {
      ...EXPECTED,
      dedicatedIdentityDigest: digest('different-identity')
    }),
    (error) => error.code === 'intervention_isolation.identity_mismatch'
  )
})

test('Profile digest, uncontrolled channels, incomplete coverage and Runner action drift fail closed', () => {
  const badDigest = validProfile()
  badDigest.payload.profileVersion = '1.0.1'
  assert.throws(
    () => admitInterventionIsolationProfile(badDigest, EXPECTED),
    (error) => error.code === 'intervention_isolation.payload_digest_mismatch'
  )

  const uncontrolled = validProfile()
  uncontrolled.payload.channels.externalMcpMutation.state = 'uncontrolled'
  reseal(uncontrolled)
  assert.throws(
    () => admitInterventionIsolationProfile(uncontrolled, EXPECTED),
    (error) => error.code === 'intervention_isolation.channel_uncontrolled'
  )

  const incomplete = validProfile()
  incomplete.payload.channels.workspaceWriters.coverage = {
    state: 'partial',
    reason: { code: 'coverage.watcher_gap' }
  }
  reseal(incomplete)
  assert.throws(
    () => admitInterventionIsolationProfile(incomplete, EXPECTED),
    (error) => error.code === 'intervention_isolation.channel_coverage_incomplete'
  )

  const changedActions = validProfile()
  changedActions.payload.authorizedRunnerActions.pop()
  reseal(changedActions)
  assert.throws(
    () => admitInterventionIsolationProfile(changedActions, EXPECTED),
    (error) => error.code === 'intervention_isolation.runner_actions_invalid'
  )

  const weakWriterAuthority = validProfile()
  weakWriterAuthority.payload.channels.workspaceWriters.authority = 'runner'
  reseal(weakWriterAuthority)
  assert.throws(
    () => admitInterventionIsolationProfile(weakWriterAuthority, EXPECTED),
    (error) => error.code === 'intervention_isolation.channel_authority_insufficient'
  )
})

test('Profile file must be private, regular and non-symlinked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-isolation-profile-'))
  const profilePath = join(directory, 'profile.json')
  const symlinkPath = join(directory, 'profile-link.json')
  await writeFile(profilePath, `${JSON.stringify(validProfile())}\n`, { mode: 0o600 })

  const admitted = await loadAndAdmitInterventionIsolationProfile(profilePath, EXPECTED)
  assert.equal(admitted.status, 'admitted')

  await chmod(profilePath, 0o644)
  await assert.rejects(
    loadAndAdmitInterventionIsolationProfile(profilePath, EXPECTED),
    (error) => error.code === 'intervention_isolation.profile_file_not_private'
  )
  await chmod(profilePath, 0o600)
  await symlink(profilePath, symlinkPath)
  await assert.rejects(
    loadAndAdmitInterventionIsolationProfile(symlinkPath, EXPECTED),
    (error) => error.code === 'intervention_isolation.profile_file_invalid'
  )
})

test('continuity requires the same private Profile bytes and Runner identity after dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-isolation-continuity-'))
  const profilePath = join(directory, 'profile.json')
  await writeFile(profilePath, `${JSON.stringify(validProfile())}\n`, { mode: 0o600 })
  const initial = await loadAndAdmitInterventionIsolationProfile(profilePath, EXPECTED)

  assert.deepEqual(
    await verifyInterventionIsolationContinuity(profilePath, initial, EXPECTED),
    {
      state: 'complete',
      reason: null,
      artifactId: initial.artifactId,
      artifactDigest: initial.artifactDigest,
      dedicatedIdentityDigest: initial.dedicatedIdentityDigest
    }
  )

  const changed = validProfile()
  changed.payload.profileVersion = '1.0.1'
  reseal(changed)
  await writeFile(profilePath, `${JSON.stringify(changed)}\n`, { mode: 0o600 })
  const lost = await verifyInterventionIsolationContinuity(profilePath, initial, EXPECTED)
  assert.equal(lost.state, 'partial')
  assert.equal(lost.reason.code, 'intervention_isolation.profile_changed_after_dispatch')

  await chmod(profilePath, 0o644)
  const unsafe = await verifyInterventionIsolationContinuity(profilePath, initial, EXPECTED)
  assert.equal(unsafe.state, 'partial')
  assert.equal(unsafe.reason.code, 'intervention_isolation.profile_file_not_private')
})

function validProfile() {
  const payload = {
    profileId: 'formal-cli-isolation',
    profileVersion: '1.0.0',
    executionIsolation: 'dedicated_os_identity',
    dedicatedIdentityDigest: IDENTITY_DIGEST,
    channels: {
      coreControl: channel('isolated', 'runner'),
      approvals: channel('disabled', 'runner'),
      configuration: channel('isolated', 'operating_system'),
      runtimeLifecycle: channel('isolated', 'operating_system'),
      workspaceWriters: channel('isolated', 'operating_system'),
      processAncestry: channel('ledgered', 'operating_system'),
      networkMutation: channel('disabled', 'operating_system'),
      gitRemoteMutation: channel('disabled', 'runner'),
      externalMcpMutation: channel('disabled', 'runner'),
      observationContinuity: channel('ledgered', 'runner')
    },
    authorizedRunnerActions: [
      'passive_observation',
      'deadline_watchdog',
      'evidence_capture',
      'turn_fencing',
      'bounded_cleanup'
    ],
    overallCoverage: { state: 'complete', reason: null },
    formalAdmissible: true
  }
  return {
    artifactId: 'isolation-profile-1',
    schemaId: 'rovai.qualification.intervention-isolation-profile',
    schemaVersion: '1.0.0',
    producer: {
      id: 'test-isolation-controller',
      version: '1.0.0',
      digest: digest('producer')
    },
    binding: { suiteId: EXPECTED.suiteId },
    sourceBoundaries: [{
      authorityClass: 'runner',
      sourceId: 'isolation-controller-observation',
      digest: digest('source-boundary'),
      throughSequence: 7,
      declaredTotal: 7,
      clockDomain: 'controller-monotonic-v1',
      coverage: { state: 'complete', reason: null }
    }],
    payloadDigest: `sha256:${digestJson(payload)}`,
    payload
  }
}

function channel(state, authority) {
  return {
    state,
    authority,
    policyDigest: digest(`${state}:${authority}`),
    coverage: { state: 'complete', reason: null }
  }
}

function reseal(profile) {
  profile.payloadDigest = `sha256:${digestJson(profile.payload)}`
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}
