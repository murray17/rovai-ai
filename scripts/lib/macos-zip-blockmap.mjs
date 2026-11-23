import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

// Use the same chunker as the electron-builder version that produces the release.
const fromBuilder = createRequire(import.meta.resolve('electron-builder'))
const { buildBlockMap } = fromBuilder('app-builder-lib/out/targets/blockmap/blockmap')

export async function verifyMacZipBlockmap(zipPath) {
  const published = await readFile(`${zipPath}.blockmap`)
  const directory = await mkdtemp(join(tmpdir(), 'rovai-zip-blockmap-'))
  try {
    const regenerated = join(directory, 'expected.blockmap')
    const zip = await buildBlockMap(zipPath, 'gzip', regenerated)
    if (!gunzipSync(published).equals(gunzipSync(await readFile(regenerated)))) {
      throw new Error(`Blockmap does not match the final ZIP: ${zipPath}`)
    }
    return {
      zipSha512: zip.sha512,
      blockmapSize: published.length,
      blockmapSha256: createHash('sha256').update(published).digest('hex')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
