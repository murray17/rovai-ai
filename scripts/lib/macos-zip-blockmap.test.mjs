import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { verifyMacZipBlockmap } from './macos-zip-blockmap.mjs'

const fromBuilder = createRequire(import.meta.resolve('electron-builder'))
const { buildBlockMap } = fromBuilder('app-builder-lib/out/targets/blockmap/blockmap')

test('requires the published index and matches it against the final artifact bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-release-index-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const zip = join(directory, 'Rovai-AI-1.0.0-arm64.zip')
  const map = zip + '.blockmap'
  const bytes = Buffer.alloc(128 * 1024, 'a')
  await writeFile(zip, bytes)
  await assert.rejects(verifyMacZipBlockmap(zip), { code: 'ENOENT' })

  await buildBlockMap(zip, 'gzip', map)
  const repacked = gzipSync(gunzipSync(await readFile(map)), { level: 1 })
  await writeFile(map, repacked)
  assert.deepEqual(await verifyMacZipBlockmap(zip), {
    zipSha512: createHash('sha512').update(bytes).digest('base64'),
    blockmapSize: repacked.length,
    blockmapSha256: createHash('sha256').update(repacked).digest('hex')
  })
  assert.deepEqual(await readFile(zip), bytes)
  assert.deepEqual(await readFile(map), repacked)

  await writeFile(zip, Buffer.alloc(bytes.length, 'b'))
  await assert.rejects(verifyMacZipBlockmap(zip), /does not match the final ZIP/)
  await writeFile(map, 'invalid gzip')
  await assert.rejects(verifyMacZipBlockmap(zip), { code: 'Z_DATA_ERROR' })
})
