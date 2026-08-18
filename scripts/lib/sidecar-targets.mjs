import { resolve } from 'node:path'

const TARGETS = Object.freeze({
  'macos-arm64': Object.freeze({
    key: 'macos-arm64',
    platform: 'darwin',
    arch: 'arm64',
    rustTarget: 'aarch64-apple-darwin',
    executableSuffix: ''
  }),
  'macos-x64': Object.freeze({
    key: 'macos-x64',
    platform: 'darwin',
    arch: 'x64',
    rustTarget: 'x86_64-apple-darwin',
    executableSuffix: ''
  }),
  'windows-x64': Object.freeze({
    key: 'windows-x64',
    platform: 'win32',
    arch: 'x64',
    rustTarget: 'x86_64-pc-windows-msvc',
    executableSuffix: '.exe'
  })
})

export function sidecarTarget(targetKey) {
  const target = TARGETS[targetKey]
  if (!target) {
    throw new Error(`Unsupported Rovai sidecar target: ${targetKey}`)
  }
  return target
}

export function hostSidecarTargetKey(platform = process.platform, arch = process.arch) {
  const target = Object.values(TARGETS).find(
    (candidate) => candidate.platform === platform && candidate.arch === arch
  )
  if (!target) {
    throw new Error(`Unsupported Rovai sidecar host: ${platform}-${arch}`)
  }
  return target.key
}

export function sidecarExecutableName(binary, targetKey = hostSidecarTargetKey()) {
  return `${binary}${sidecarTarget(targetKey).executableSuffix}`
}

export function stagedSidecarDirectory(repositoryRoot, targetKey = hostSidecarTargetKey()) {
  sidecarTarget(targetKey)
  return resolve(repositoryRoot, 'resources', 'bin', targetKey)
}

export function stagedSidecarPath(
  repositoryRoot,
  binary,
  targetKey = hostSidecarTargetKey()
) {
  return resolve(
    stagedSidecarDirectory(repositoryRoot, targetKey),
    sidecarExecutableName(binary, targetKey)
  )
}
