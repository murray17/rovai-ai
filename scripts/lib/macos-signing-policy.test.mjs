import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MACOS_SIGNING_POLICY,
  assertAdhocMacosSignature,
  assertStableMacosSignature
} from './macos-signing-policy.mjs'

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
    details: `Authority=${MACOS_SIGNING_POLICY.authority}`,
    designatedRequirement: [
      'designated => identifier "ai.rovai.desktop"',
      `and certificate root = H"${MACOS_SIGNING_POLICY.certificateRoot}"`
    ].join(' ')
  }), /not ad-hoc signed/)

  assert.throws(() => assertAdhocMacosSignature('App', {
    details: [
      'Signature=adhoc',
      `Authority=${MACOS_SIGNING_POLICY.authority}`
    ].join('\n'),
    designatedRequirement: 'designated => cdhash H"1234"'
  }), /certificate authority/)
})

test('accepts the fixed release authority and certificate-root requirement', () => {
  assert.doesNotThrow(() => assertStableMacosSignature('App', {
    details: [
      'Executable=/Applications/Rovai AI.app/Contents/MacOS/Rovai AI',
      `Authority=${MACOS_SIGNING_POLICY.authority}`
    ].join('\n'),
    designatedRequirement: [
      'designated => identifier "ai.rovai.desktop"',
      `and certificate root = H"${MACOS_SIGNING_POLICY.certificateRoot}"`
    ].join(' '),
    expectedIdentifier: MACOS_SIGNING_POLICY.appId
  }))
})

test('rejects ad-hoc, CDHash-only, and wrong-certificate identities', () => {
  assert.throws(() => assertStableMacosSignature('App', {
    details: 'Signature=adhoc',
    designatedRequirement: 'designated => cdhash H"1234"',
    expectedIdentifier: MACOS_SIGNING_POLICY.appId
  }), /ad-hoc/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: `Authority=${MACOS_SIGNING_POLICY.authority}`,
    designatedRequirement: 'designated => cdhash H"1234"',
    expectedIdentifier: MACOS_SIGNING_POLICY.appId
  }), /CDHash-only/)

  assert.throws(() => assertStableMacosSignature('App', {
    details: `Authority=${MACOS_SIGNING_POLICY.authority}`,
    designatedRequirement: 'designated => identifier "ai.rovai.desktop" and certificate root = H"wrong"',
    expectedIdentifier: MACOS_SIGNING_POLICY.appId
  }), /certificate root/)
})

test('pins the same signing identity in the release workflow and verifier', () => {
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
  assert.match(workflow, new RegExp(MACOS_SIGNING_POLICY.authority))
  assert.match(workflow, new RegExp(MACOS_SIGNING_POLICY.certificateSha256))
  assert.match(workflow, /node scripts\/verify-macos-release\.mjs \$\{\{ matrix\.arch \}\}/)
  assert.match(verifier, /macos-signing-policy\.mjs/)
})
