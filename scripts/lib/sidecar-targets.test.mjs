import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  hostSidecarTargetKey,
  sidecarExecutableName,
  sidecarTarget,
  serverTarget,
  hostServerTargetKey,
  stagedSidecarPath
} from './sidecar-targets.mjs'

test('Windows release verification matches the current Core transport versions', () => {
  const transport = readFileSync(new URL('../../crates/rovai-core/src/builtin_tool_transport.rs', import.meta.url), 'utf8')
  const verifier = readFileSync(new URL('../verify-windows-release.mjs', import.meta.url), 'utf8')
  const contract = transport.match(/BUILTIN_TOOL_CONTRACT_VERSION: u32 = (\d+);/)?.[1]
  const ipc = transport.match(/BUILTIN_TOOL_IPC_PROTOCOL_VERSION: u32 = (\d+);/)?.[1]
  assert.ok(contract && ipc, 'Core transport version constants must be present')
  assert.deepEqual(verifier.match(/contract-v(\d+) ipc-v(\d+)/)?.slice(1), [contract, ipc],
    'packaged CLI verification must use current transport versions')
  assert.equal(verifier.match(/health\.core\.builtinToolContractVersion !== (\d+)/)?.[1], contract,
    'packaged Core health verification must use the current contract version')
  assert.equal(verifier.match(/health\.core\.builtinToolIpcProtocolVersion !== (\d+)/)?.[1], ipc,
    'packaged Core health verification must use the current IPC version')
  assert.equal(verifier.match(/builtinToolContractVersion: (\d+)/)?.[1], contract,
    'release manifest must record the current contract version')
  assert.equal(verifier.match(/builtinToolIpcProtocolVersion: (\d+)/)?.[1], ipc,
    'release manifest must record the current IPC version')
})

test('maps only the three shipped sidecar targets', () => {
  assert.equal(hostSidecarTargetKey('darwin', 'arm64'), 'macos-arm64')
  assert.equal(hostSidecarTargetKey('darwin', 'x64'), 'macos-x64')
  assert.equal(hostSidecarTargetKey('win32', 'x64'), 'windows-x64')
  assert.throws(() => hostSidecarTargetKey('linux', 'x64'), /Unsupported Rovai sidecar host/)
  assert.throws(() => sidecarTarget('linux-x64'), /Unsupported Rovai sidecar target/)
  assert.equal(hostServerTargetKey('linux', 'x64'), 'linux-x64')
  assert.equal(serverTarget('linux-x64').rustTarget, 'x86_64-unknown-linux-gnu')
  assert.equal(serverTarget('macos-arm64'), sidecarTarget('macos-arm64'))
  assert.throws(() => serverTarget('linux-arm64'), /Unsupported Rovai Server target/)
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
