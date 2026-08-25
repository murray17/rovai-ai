import { isDeepStrictEqual } from 'node:util'
import { parse, stringify } from 'yaml'

const ARCHITECTURES = ['x64', 'arm64']

export function mergeMacUpdateInfoDocuments(documents) {
  if (!Array.isArray(documents) || documents.length < 2) {
    throw new Error('at least two latest-mac.yml documents are required')
  }

  const updateInfos = documents.map((document, index) => {
    const value = typeof document === 'string' ? parse(document) : document
    if (!isPlainObject(value)) throw new Error(`update document ${index + 1} is not an object`)
    if (typeof value.version !== 'string' || value.version.length === 0) {
      throw new Error(`update document ${index + 1} has no version`)
    }
    if (!Array.isArray(value.files) || value.files.length === 0) {
      throw new Error(`update document ${index + 1} has no files`)
    }
    return value
  })

  const version = updateInfos[0].version
  for (const updateInfo of updateInfos.slice(1)) {
    if (updateInfo.version !== version) {
      throw new Error(`cannot merge macOS update versions ${version} and ${updateInfo.version}`)
    }
    if (!isDeepStrictEqual(stableReleaseFields(updateInfos[0]), stableReleaseFields(updateInfo))) {
      throw new Error('macOS update documents disagree on release metadata')
    }
  }

  const filesByUrl = new Map()
  for (const [documentIndex, updateInfo] of updateInfos.entries()) {
    for (const [fileIndex, file] of updateInfo.files.entries()) {
      validateFile(file, documentIndex, fileIndex)
      const existing = filesByUrl.get(file.url)
      if (existing && !isDeepStrictEqual(existing, file)) {
        throw new Error(`macOS update file ${file.url} has conflicting metadata`)
      }
      filesByUrl.set(file.url, structuredClone(file))
    }
  }

  const files = [...filesByUrl.values()].sort(compareFiles)
  const zipFiles = files.filter((file) => file.url.toLowerCase().endsWith('.zip'))
  for (const architecture of ARCHITECTURES) {
    if (!zipFiles.some((file) => file.url.includes(`-${architecture}.zip`))) {
      throw new Error(`merged macOS update info has no ${architecture} ZIP`)
    }
  }

  const primaryZip = zipFiles[0]
  const releaseDates = updateInfos
    .map((updateInfo) => updateInfo.releaseDate)
    .filter((releaseDate) => typeof releaseDate === 'string' && releaseDate.length > 0)
    .sort()
  return {
    ...structuredClone(updateInfos[0]),
    files,
    path: primaryZip.url,
    sha512: primaryZip.sha512,
    ...(releaseDates.length > 0 ? { releaseDate: releaseDates.at(-1) } : {})
  }
}

export function mergeMacUpdateInfoYaml(documents) {
  return stringify(mergeMacUpdateInfoDocuments(documents), {
    lineWidth: 0,
    minContentWidth: 0
  })
}

function stableReleaseFields(updateInfo) {
  const { files, path, sha512, releaseDate, ...stable } = updateInfo
  return stable
}

function validateFile(file, documentIndex, fileIndex) {
  const label = `update document ${documentIndex + 1} file ${fileIndex + 1}`
  if (!isPlainObject(file)) throw new Error(`${label} is not an object`)
  if (typeof file.url !== 'string' || file.url.length === 0) {
    throw new Error(`${label} has no URL`)
  }
  if (typeof file.sha512 !== 'string' || file.sha512.length < 80) {
    throw new Error(`${label} has no complete sha512`)
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error(`${label} has no positive integer size`)
  }
}

function compareFiles(left, right) {
  const extensionDifference = extensionRank(left.url) - extensionRank(right.url)
  if (extensionDifference !== 0) return extensionDifference
  const architectureDifference = architectureRank(left.url) - architectureRank(right.url)
  if (architectureDifference !== 0) return architectureDifference
  return left.url.localeCompare(right.url)
}

function extensionRank(url) {
  if (url.toLowerCase().endsWith('.zip')) return 0
  if (url.toLowerCase().endsWith('.dmg')) return 1
  return 2
}

function architectureRank(url) {
  const architecture = ARCHITECTURES.findIndex((candidate) => url.includes(`-${candidate}.`))
  return architecture === -1 ? ARCHITECTURES.length : architecture
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
