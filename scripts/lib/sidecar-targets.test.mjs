import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hostSidecarTargetKey,
  sidecarExecutableName,
  sidecarTarget,
  stagedSidecarPath
} from './sidecar-targets.mjs'

test('maps only the three shipped sidecar targets', () => {
  assert.equal(hostSidecarTargetKey('darwin', 'arm64'), 'macos-arm64')
  assert.equal(hostSidecarTargetKey('darwin', 'x64'), 'macos-x64')
  assert.equal(hostSidecarTargetKey('win32', 'x64'), 'windows-x64')
  assert.throws(
    () => hostSidecarTargetKey('win32', 'arm64'),
    /Unsupported Rovai sidecar host/
  )
  assert.throws(
    () => sidecarTarget('windows-arm64'),
    /Unsupported Rovai sidecar target/
  )
})

test('keeps Windows executables and staging isolated from macOS', () => {
  assert.equal(sidecarExecutableName('rovai-core', 'windows-x64'), 'rovai-core.exe')
  assert.equal(sidecarExecutableName('rovai', 'windows-x64'), 'rovai.exe')
  assert.equal(sidecarExecutableName('rovai-core', 'macos-arm64'), 'rovai-core')
  assert.match(
    stagedSidecarPath('/repo', 'rovai-core', 'windows-x64'),
    /resources[\\/]bin[\\/]windows-x64[\\/]rovai-core\.exe$/
  )
  assert.match(
    stagedSidecarPath('/repo', 'rovai-core', 'macos-x64'),
    /resources[\\/]bin[\\/]macos-x64[\\/]rovai-core$/
  )
})
