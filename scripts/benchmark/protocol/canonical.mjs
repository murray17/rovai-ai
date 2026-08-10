import { createHash } from 'node:crypto'

export const SHA256_PATTERN = /^[a-f0-9]{64}$/

export function canonicalJson(value) {
  assertCanonicalValue(value, '$')
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function digestJson(value) {
  return sha256(canonicalJson(value))
}

export function materializeJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertCanonicalValue(value, path) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
      || typeof value === 'bigint') {
    throw new TypeError(`value at ${path} is not canonical JSON`)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`number at ${path} is not finite`)
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCanonicalValue(entry, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`value at ${path} is not a plain JSON object`)
    }
    for (const [key, entry] of Object.entries(value)) assertCanonicalValue(entry, `${path}.${key}`)
  }
}
