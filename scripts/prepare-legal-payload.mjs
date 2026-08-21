import { prepareLegalPayload } from './lib/legal-common.mjs'

const result = prepareLegalPayload(process.cwd())
console.log(`Prepared deterministic legal payload with ${result.files} files.`)
