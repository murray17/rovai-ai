export function migrateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object')
  const version = state.version
  if (![1, 2, 3].includes(version)) throw new RangeError('unsupported state version')
  const name = text(version === 1 ? state.name : state.profile?.name) || 'unnamed'
  const sourceRecords = version === 1 ? state.items : state.records
  if (!Array.isArray(sourceRecords)) throw new TypeError('state records must be an array')
  const seen = new Set()
  const records = []
  for (const record of sourceRecords) {
    const key = text(version === 1 ? record?.id : record?.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    records.push({ key, value: record?.value })
  }
  return {
    version: 3,
    profile: { name },
    records,
    metadata: { migratedFrom: version }
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
