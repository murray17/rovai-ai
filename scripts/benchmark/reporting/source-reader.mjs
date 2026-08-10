import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function readJsonSource(path) {
  const raw = await readFile(path, 'utf8')
  return { raw, value: JSON.parse(raw), path }
}

export async function readLegacyTrialSource(trialRoot, trialId) {
  const directory = join(trialRoot, trialId)
  const result = await readJsonSource(join(directory, 'result.json'))
  const observationsRaw = await readFile(join(directory, 'observations.ndjson'), 'utf8')
  return {
    trialId,
    result,
    observationsRaw,
    observations: observationsRaw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }
}
