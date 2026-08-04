import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { canonicalJson, digestJson } from './qualification-common.mjs'

const EXPECTED_IDS = Object.freeze(
  Array.from({ length: 25 }, (_, index) => `ACC-${String(index + 1).padStart(3, '0')}`)
)

export async function validateV034AcceptanceRegistry({
  root = resolve(import.meta.dirname, '../..'),
  registryPath = resolve(
    import.meta.dirname,
    '../../qualification/acceptance/v0.34/acceptance-registry.json'
  )
} = {}) {
  const registry = JSON.parse(await readFile(registryPath, 'utf8'))
  if (registry.schemaVersion !== 1 || registry.version !== 'v0.34') {
    throw new Error('v0.34 acceptance registry identity is invalid')
  }
  const ids = registry.entries.map((entry) => entry.id)
  if (canonicalJson(ids) !== canonicalJson(EXPECTED_IDS)) {
    throw new Error('v0.34 acceptance registry must contain ACC-001 through ACC-025 exactly once and in order')
  }
  for (const entry of registry.entries) {
    if (!/^[a-z0-9_]+$/.test(entry.scenario)
        || !/^[a-z0-9_]+(?:_and_[a-z0-9_]+)*$/.test(entry.proof)
        || typeof entry.selector !== 'string'
        || entry.selector.length < 8) {
      throw new Error(`v0.34 acceptance registry entry is malformed: ${entry.id}`)
    }
    const source = resolve(root, entry.source)
    if (source !== root && !source.startsWith(`${root}${sep}`)) {
      throw new Error(`v0.34 acceptance source escapes the repository: ${entry.id}`)
    }
    const text = await readFile(source, 'utf8')
    if (!text.includes(entry.selector)) {
      throw new Error(`v0.34 acceptance selector is not backed by executable source: ${entry.id}`)
    }
  }
  return {
    ok: true,
    version: registry.version,
    entries: registry.entries.length,
    registryDigest: `sha256:${digestJson(registry)}`
  }
}
