import { resolve } from 'node:path'
import {
  discoverSkillDirectories,
  validateSkillDirectory,
} from './lib/skill-authoring.mjs'

const roots = process.argv.length > 2 ? process.argv.slice(2) : ['skills']
const directories = []
for (const root of roots) {
  directories.push(...(await discoverSkillDirectories(resolve(root))))
}

const errors = []
for (const directory of [...new Set(directories)].sort()) {
  errors.push(...(await validateSkillDirectory(directory)))
}

if (errors.length > 0) {
  console.error('Skill authoring checks failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Skill authoring checks passed for ${new Set(directories).size} Skills.`)
}
