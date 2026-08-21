import { resolve } from 'node:path'
import { verifyPayload } from './lib/legal-common.mjs'

const args = process.argv.slice(2)
const integrityOnly = args.includes('--integrity-only')
const target = args.find((argument) => !argument.startsWith('--'))
if (!target) throw new Error('usage: node scripts/verify-legal-payload.mjs [--integrity-only] <payload-or-app-path>')
const result = verifyPayload(resolve(target), { enforceReleaseGate: !integrityOnly })
console.log(`Packaged legal payload integrity: ${result.integrity} (${result.files} files).`)
if (integrityOnly) console.log('Binary release gate remains independently enforced; integrity-only verification does not approve release.')
