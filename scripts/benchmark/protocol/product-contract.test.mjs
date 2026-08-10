import assert from 'node:assert/strict'
import test from 'node:test'
import { collectProductContractFingerprint } from './product-contract.mjs'

test('Product Contract Fingerprint reads code/build authority and marks unavailable data explicitly', async () => {
  const fingerprint = await collectProductContractFingerprint()
  assert.equal(fingerprint.dataContractVersion.value, 'v0.52')
  assert.equal(fingerprint.dataContractSchemaVersion.value, 28)
  assert.equal(fingerprint.campSnapshotSchemaVersion.value, 27)
  assert.equal(fingerprint.contextManifestVersion.value, 9)
  assert.equal(fingerprint.contextFormatterVersion.value, 11)
  assert.equal(fingerprint.contextDeliveryProfileVersion.value, 2)
  assert.equal(fingerprint.durableTaskContract.value.version, 2)
  assert.equal(fingerprint.builtInTransportVersion.value, 4)
  assert.equal(fingerprint.acceptedInputAckContract.value.semanticClass, 'accepted_input_only')
  assert.equal(fingerprint.coreExecutableDigest.status, 'unavailable')
  assert.equal(fingerprint.builtInCatalogDigest.status, 'unavailable')
  assert.ok(fingerprint.builtInCatalogDigest.reason.code)
})
