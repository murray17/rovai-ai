import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MACOS_SIGNING_POLICY,
  assertAdhocMacosSignature,
  assertStableMacosSignature
} from './macos-signing-policy.mjs'

const TEAM_ID = 'ABCDE12345'
const validDetails = [
  'CodeDirectory v=20500 size=433 flags=0x10000(runtime) hashes=3+7 location=embedded',
  'Authority=Developer ID Application: Rovai AI (ABCDE12345)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=Sep 28, 2026 at 00:00:00',
  `TeamIdentifier=${TEAM_ID}`
].join('\n')
const validRequirement = [
  'designated => identifier "ai.rovai.desktop"',
  'and anchor apple generic',
  'and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */',
  'and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */',
  `and certificate leaf[subject.OU] = "${TEAM_ID}"`
].join(' ')

test('accepts only ad-hoc signatures for local daily installation', () => {
  assert.doesNotThrow(() => assertAdhocMacosSignature('App', {
    details: [
      'Identifier=Electron',
      'Signature=adhoc',
      'TeamIdentifier=not set'
    ].join('\n'),
    designatedRequirement: 'designated => cdhash H"1234"'
  }))

  assert.throws(() => assertAdhocMacosSignature('App', {
    details: validDetails,
    designatedRequirement: validRequirement
  }), /not ad-hoc signed/)

  assert.throws(() => assertAdhocMacosSignature('App', {
    details: [
      'Signature=adhoc',
      `Authority=${MACOS_SIGNING_POLICY.authorityPrefix} Rovai AI (${TEAM_ID})`
    ].join('\n'),
    designatedRequirement: 'designated => cdhash H"1234"'
  }), /certificate authority/)
})

test('accepts an Apple Developer ID signature for the configured Team ID', () => {
  assert.doesNotThrow(() => assertStableMacosSignature('App', {
    details: validDetails,
    designatedRequirement: validRequirement,
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }))
})

test('rejects ad-hoc, wrong-team, weakened, and non-Developer-ID signatures', () => {
  assert.throws(() => assertStableMacosSignature('App', {
    details: 'Signature=adhoc',
    designatedRequirement: 'designated => cdhash H"1234"',
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /ad-hoc/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails,
    designatedRequirement: 'designated => cdhash H"1234"',
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /CDHash-only/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails.replace('ABCDE12345', 'ZYXWV98765'),
    designatedRequirement: validRequirement,
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /authority chain/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails,
    designatedRequirement: validRequirement.replace('ABCDE12345', 'ZYXWV98765'),
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /wrong Apple Developer Team ID/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails.replace('runtime', 'linker-signed'),
    designatedRequirement: validRequirement,
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /Hardened Runtime/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails.replace(/^Timestamp=.*\n/m, ''),
    designatedRequirement: validRequirement,
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /timestamp/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: validDetails,
    designatedRequirement: validRequirement.replace('anchor apple generic', 'anchor trusted'),
    expectedIdentifier: MACOS_SIGNING_POLICY.appId,
    expectedTeamId: TEAM_ID
  }), /Developer ID certificate/)
})

test('release workflow requires a pinned Developer ID certificate and notarization', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/macos-signed-build.yml', import.meta.url),
    'utf8'
  )
  const verifier = readFileSync(
    new URL('../verify-macos-release.mjs', import.meta.url),
    'utf8'
  )

  assert.match(workflow, /secrets\.MAC_CSC_LINK/)
  assert.match(workflow, /secrets\.MAC_CSC_KEY_PASSWORD/)
  assert.match(workflow, /vars\.MAC_RELEASE_CERT_SHA256/)
  assert.match(workflow, /vars\.MAC_RELEASE_TEAM_ID/)
  assert.match(workflow, /secrets\.APPLE_API_KEY_BASE64/)
  assert.match(workflow, /xcrun notarytool submit/)
  assert.match(workflow, /xcrun stapler staple/)
  assert.doesNotMatch(workflow, /add-trusted-cert/)
  assert.match(workflow, /node scripts\/verify-macos-release\.mjs \$\{\{ matrix\.arch \}\}/)
  assert.match(verifier, /macos-signing-policy\.mjs/)
  assert.match(verifier, /stapler', 'validate'/)
})
