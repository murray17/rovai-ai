import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, inflateRawSync } from 'node:zlib'

const VERSION = '1.0.60'
const RELEASE = `https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/v${VERSION}`
const TARGETS = {
  'macos-arm64': {
    asset: 'dws-darwin-arm64.tar.gz',
    archiveSha256: '4ed89f8a6f8341f83c78b48ce765fd18b1d7a305499aea78dfc16c6c5fecff68',
    binarySha256: '5998d83346839048f555c3abe4ff7207191317759dd720ba46e883cefe4bf777',
    executable: 'dws',
    format: 'tar.gz'
  },
  'macos-x64': {
    asset: 'dws-darwin-amd64.tar.gz',
    archiveSha256: '53c569e2c713a8a2a0f73114068669e87d3a5fa78ec2bbeca5e19e49442adb37',
    binarySha256: 'fd66b021f83ea0468e39470b4b9d9736e6b7cac8f2158e09cd9a65da0bad3347',
    executable: 'dws',
    format: 'tar.gz'
  },
  'windows-x64': {
    asset: 'dws-windows-amd64.zip',
    archiveSha256: 'cce1cb02fece17443957441207849f3dd465bb3261377dedc349d27046cedcb6',
    binarySha256: '6eccc842f09e661fa3a1aefd2231b8ae849e9542903bf87da6499e24ab1ae3d3',
    executable: 'dws.exe',
    format: 'zip'
  }
}

const targetKey = argument('--target-key') ?? hostTargetKey()
const target = TARGETS[targetKey]
if (!target) throw new Error(`Unsupported DingTalk DWS target: ${targetKey}`)

const root = new URL('../', import.meta.url)
const binaryPath = new URL(`resources/bin/${targetKey}/${target.executable}`, root)
if (await matchesDigest(binaryPath, target.binarySha256)) {
  console.info(`[dingtalk-dws] ${targetKey} v${VERSION} already staged`)
  process.exit(0)
}

const response = await fetch(`${RELEASE}/${target.asset}`, {
  headers: { 'user-agent': 'rovai-ai-build' },
  signal: AbortSignal.timeout(120_000)
})
if (!response.ok) throw new Error(`DingTalk DWS download failed: HTTP ${response.status}`)
const archive = Buffer.from(await response.arrayBuffer())
requireDigest(archive, target.archiveSha256, 'archive')

const entries = target.format === 'tar.gz'
  ? tarEntries(gunzipSync(archive))
  : zipEntries(archive)
const binary = requiredEntry(entries, target.executable)
requireDigest(binary, target.binarySha256, 'binary')

await atomicWrite(binaryPath, binary, targetKey.startsWith('macos-') ? 0o755 : 0o644)
const licenseRoot = new URL('resources/licenses/dingtalk-dws/', root)
for (const fileName of ['LICENSE', 'NOTICE']) {
  await atomicWrite(new URL(fileName, licenseRoot), requiredEntry(entries, fileName), 0o644)
}
await atomicWrite(
  new URL('PROVENANCE.txt', licenseRoot),
  Buffer.from([
    `DingTalk Workspace CLI v${VERSION}`,
    `Source: https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli`,
    ...Object.entries(TARGETS).flatMap(([key, value]) => [
      `${key} asset: ${value.asset}`,
      `${key} archive SHA-256: ${value.archiveSha256}`,
      `${key} binary SHA-256: ${value.binarySha256}`
    ]),
    ''
  ].join('\n')),
  0o644
)
console.info(`[dingtalk-dws] staged ${targetKey} v${VERSION}`)

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] ?? null
}

function hostTargetKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'macos-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'macos-x64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64'
  throw new Error(`Unsupported DingTalk DWS host: ${process.platform}-${process.arch}`)
}

async function matchesDigest(url, expected) {
  try {
    return digest(await readFile(url)) === expected
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function requireDigest(bytes, expected, label) {
  const actual = digest(bytes)
  if (actual !== expected) {
    throw new Error(`DingTalk DWS ${label} integrity failed: expected ${expected}, got ${actual}`)
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function atomicWrite(url, bytes, mode) {
  const path = fileURLToPath(url)
  const directory = fileURLToPath(new URL('./', url))
  await mkdir(directory, { recursive: true, mode: 0o755 })
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  await writeFile(temporary, bytes, { mode })
  await chmod(temporary, mode)
  await rename(temporary, path)
}

function requiredEntry(entries, requestedName) {
  const entry = entries.find(([name]) => basename(name) === requestedName)
  if (!entry) throw new Error(`DingTalk DWS archive is missing ${requestedName}`)
  return entry[1]
}

function tarEntries(tar) {
  const result = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = cString(header.subarray(0, 100))
    const prefix = cString(header.subarray(345, 500))
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(cString(header.subarray(124, 136)).trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid DingTalk DWS tar entry')
    const start = offset + 512
    const end = start + size
    if (end > tar.length) throw new Error('Truncated DingTalk DWS tar entry')
    const type = header[156]
    if (type === 0 || type === 48) result.push([fullName, Buffer.from(tar.subarray(start, end))])
    offset = start + Math.ceil(size / 512) * 512
  }
  return result
}

function zipEntries(zip) {
  const eocd = findSignatureFromEnd(zip, 0x06054b50)
  if (eocd < 0) throw new Error('Invalid DingTalk DWS zip directory')
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  const result = []
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid DingTalk DWS zip entry')
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid DingTalk DWS local zip entry')
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const compressed = zip.subarray(start, start + compressedSize)
    const bytes = method === 0 ? Buffer.from(compressed)
      : method === 8 ? inflateRawSync(compressed)
        : null
    if (!bytes || bytes.length !== size) throw new Error('Unsupported DingTalk DWS zip compression')
    result.push([name, bytes])
    offset += 46 + nameLength + extraLength + commentLength
  }
  return result
}

function findSignatureFromEnd(bytes, signature) {
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === signature) return offset
  }
  return -1
}

function cString(bytes) {
  const zero = bytes.indexOf(0)
  return bytes.subarray(0, zero === -1 ? bytes.length : zero).toString('utf8')
}
