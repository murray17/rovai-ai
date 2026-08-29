import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const prototypeDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(prototypeDirectory, '../../..')
const prototypePath = resolve(prototypeDirectory, 'index.html')
const productionStylesPath = resolve(repositoryRoot, 'apps/desktop/src/renderer/src/styles.css')
const startMarker = '<!-- BUNDLED_PRODUCTION_CSS_START -->'
const endMarker = '<!-- BUNDLED_PRODUCTION_CSS_END -->'

const [prototype, productionStyles] = await Promise.all([
  readFile(prototypePath, 'utf8'),
  readFile(productionStylesPath, 'utf8')
])

const start = prototype.indexOf(startMarker)
const end = prototype.indexOf(endMarker)
if (start < 0 || end < start) throw new Error('Bundled production CSS markers are missing or out of order.')

const bundledStyles = `${startMarker}\n  <style data-bundled-production-css>\n${productionStyles}\n  </style>\n  ${endMarker}`
const nextPrototype = `${prototype.slice(0, start)}${bundledStyles}${prototype.slice(end + endMarker.length)}`
await writeFile(prototypePath, nextPrototype, 'utf8')

console.log(`Bundled ${productionStyles.length} bytes of production CSS into ${prototypePath}`)
