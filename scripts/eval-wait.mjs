// Read-only helper copied into an explicitly configured analysis workspace.
// It neither executes evaluation nor contacts the owner's App endpoint.
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--camp-id' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(args[1])) throw new Error('Usage: node wait-for-evaluation.mjs --camp-id <current-Camp-ID>')
const root = await realpath(dirname(fileURLToPath(import.meta.url)))
const deadline = Date.now() + 55 * 60_000
for (;;) {
  let receipt = null
  try { receipt = JSON.parse(await readFile(join(root, 'automation', `${args[1]}.json`), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (receipt) {
    if (receipt.schemaVersion !== 1 || receipt.campId !== args[1] || receipt.output !== root || !['running', 'completed', 'failed', 'interrupted'].includes(receipt.state)) throw new Error('Evaluation receipt does not belong to this Camp and workspace')
    if (receipt.state !== 'running') {
      console.log(JSON.stringify(receipt, null, 2))
      process.exitCode = receipt.state === 'completed' ? 0 : 2
      break
    }
  }
  if (Date.now() >= deadline) throw new Error('No completed evaluation for this Camp within the wait budget; do not substitute an older report')
  await new Promise(resolve => setTimeout(resolve, 1000))
}
