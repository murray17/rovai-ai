import { verifySource } from './lib/legal-common.mjs'

const result = verifySource(process.cwd())
console.log(`Source release gate: ${result.source_release_gate}`)
console.log(`Binary release gate: ${result.binary_release_gate}`)
if (process.argv.includes('--binary-release') && result.binary_release_gate !== 'PASS') {
  throw new Error(`binary release blocked: ${result.binary_release_gate}`)
}
