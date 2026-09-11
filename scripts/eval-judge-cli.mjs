import { resolve } from 'node:path'
import { prepareCliJudge } from './lib/qualification-cli-judge-adapter.mjs'
const args = process.argv.slice(2)
if (args.length !== 6 || args[0] !== '--executable' || args[2] !== '--model' || args[4] !== '--output') throw new Error('Usage: node scripts/eval-judge-cli.mjs --executable <absolute-codex> --model <model-id> --output <new-directory>')
await prepareCliJudge({ executable: args[1], model: args[3], directory: args[5] })
console.log(JSON.stringify({ configuration: resolve(args[5], 'configuration.json'), modelVersionPolicy: 'catalog_bound_alias', limits: 'A CLI catalog declaration is not immutable provider weights; this Judge is diagnostic, not Formal qualification.' }))
