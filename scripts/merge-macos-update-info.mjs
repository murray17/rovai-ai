import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { mergeMacUpdateInfoYaml } from './lib/macos-update-info.mjs'

const [outputArgument, ...inputArguments] = process.argv.slice(2)
if (!outputArgument || inputArguments.length < 2) {
  console.error(
    'Usage: node scripts/merge-macos-update-info.mjs <output.yml> <first.yml> <second.yml> [...]'
  )
  process.exit(2)
}

const outputPath = resolve(outputArgument)
const inputPaths = inputArguments.map((input) => resolve(input))
const documents = await Promise.all(inputPaths.map((input) => readFile(input, 'utf8')))
await writeFile(outputPath, mergeMacUpdateInfoYaml(documents), { mode: 0o644 })

console.log(`Merged ${inputPaths.length} macOS update manifests into ${outputPath}`)
