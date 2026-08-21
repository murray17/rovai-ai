import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repositoryRoot = resolve(import.meta.dirname, '../..')

export const SKILLS = [
  'analyze-agent-codebase',
  'campfire',
  'cli-operations',
  'diagnosing-bugs',
  'grill-duo',
  'grill-duo-with-docs',
  'member-studio',
  'memory-stewardship',
  'review-duo',
  'tasteful-ui',
  'tdd',
  'worktree',
  'writing-for-agents'
]

export const EXTERNAL_SKILLS = new Set([
  'diagnosing-bugs',
  'grill-duo',
  'grill-duo-with-docs',
  'tasteful-ui',
  'tdd',
  'writing-for-agents'
])

export const BINARY_PRUNE_EXCLUSIONS = new Set([
  '@types/react@19.2.17',
  '@types/react-dom@19.2.3',
  'csstype@3.2.3',
  'has-flag@4.0.0',
  'supports-color@7.2.0'
])

export const EXPECTED_CODEX_SCHEMA = {
  version: '0.144.5',
  file_count: 267,
  byte_identical_upstream_files: 16,
  normalized_equal_upstream_files: 251,
  semantic_differences: 0,
  normalized_aggregate_sha256: 'ccb435118d3dfae2cfe0dff56e4955398edfc5c54351985a45e8de256c34e3bb'
}

export const OPTION_EXT_STATUS = 'APPROVED_COMPLIANCE_PLAN'

export const OPTION_EXT_SOURCE = Object.freeze({
  path: 'legal/sources/rust/option-ext-0.2.0.crate',
  sha256: '04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d',
  format: 'crates.io .crate source archive',
  modified: false,
  license: 'MPL-2.0'
})

const REACT_REMOVE_SCROLL_BAR_LICENSE = `MIT License

Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const SQLITE_PUBLIC_DOMAIN = `# SQLite Public-Domain Statement

Rovai AI uses the SQLite 3.51.1 amalgamation bundled by
\`libsqlite3-sys 0.36.0\`. SQLite is public-domain software; it is not
relicensed by Rovai AI under the project's MIT License.

The bundled \`sqlite3.h\` begins with SQLite's public-domain dedication and
blessing:

> The author disclaims copyright to this source code. In place of a legal
> notice, here is a blessing:
>
> May you do good and not evil.\u0020\u0020
> May you find forgiveness for yourself and forgive others.\u0020\u0020
> May you share freely, never taking more than you give.

Canonical SQLite statement: https://www.sqlite.org/copyright.html

Source package: \`libsqlite3-sys 0.36.0\` from crates.io. The package's
\`sqlite3/bindgen_bundled_version.rs\` and amalgamation identify SQLite
\`3.51.1\`.
`

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function walkFiles(root, directory = root) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walkFiles(root, path) : [relative(root, path).split(sep).join('/')]
    })
    .sort()
}

function run(command, args, options = {}) {
  let executable = command
  let invocationArgs = args
  let shell = false
  if (platform() === 'win32' && command === 'pnpm') {
    assert(args.every((argument) => /^[A-Za-z0-9:._@/+\\=-]+$/.test(argument)), 'pnpm argument requires unsupported Windows shell quoting')
    const lookup = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' })
    assert(lookup.status === 0, 'pnpm.cmd is unavailable on PATH')
    const pnpmCommand = lookup.stdout.split(/\r?\n/).find(Boolean)?.trim()
    assert(pnpmCommand, 'pnpm.cmd lookup returned no executable')
    executable = `"${pnpmCommand}" ${args.join(' ')}`
    invocationArgs = []
    shell = true
  }
  const result = spawnSync(executable, invocationArgs, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    shell
  })
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }
  return result.stdout
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
  }
  return value
}

export function codexSchemaAggregate(root) {
  const schemaRoot = join(root, 'schemas/codex-app-server/0.144.5')
  const files = walkFiles(schemaRoot)
  const hash = createHash('sha256')
  for (const path of files) {
    const parsed = JSON.parse(readFileSync(join(schemaRoot, path), 'utf8'))
    hash.update(`${path}\0${JSON.stringify(stableObject(parsed))}\0`)
  }
  return { file_count: files.length, normalized_aggregate_sha256: hash.digest('hex') }
}

function trackedRasterFiles(root) {
  const output = run('git', ['ls-files', '-z', '*.png', '*.webp', '*.jpg', '*.jpeg'], { cwd: root })
  return output.split('\0').filter(Boolean).sort()
}

function artworkRole(path) {
  if (path.includes('/characters/')) return path.endsWith('/source.png') ? 'character-portrait' : 'character-avatar'
  if (path.includes('/world-map/')) return 'world-map'
  if (path === 'build/icon.png' || path === 'build/icon.svg') return 'application-icon'
  if (path.startsWith('docs/assets/readme/')) return 'readme-screenshot'
  if (path.includes('/conversation-drop-zone/')) return 'prototype-screenshot'
  if (path.includes('/execution-console-command-status/')) return 'prototype-screenshot'
  if (path.includes('/mention-popover/')) return 'duplicate-prototype-character-illustration'
  throw new Error(`unclassified tracked project image: ${path}`)
}

export function generateArtworkManifest(root) {
  const paths = [...trackedRasterFiles(root), 'build/icon.svg'].sort()
  const assets = paths.map((path) => {
    const screenshot = path.startsWith('docs/assets/readme/')
      || path.includes('/acceptance/')
      || path.includes('/execution-console-command-status/')
    const binary = path.startsWith('apps/desktop/') || path.startsWith('build/')
    return {
      path,
      sha256: sha256(readFileSync(join(root, path))),
      role: artworkRole(path),
      source_classification: screenshot
        ? 'FIRST_PARTY_PROJECT_SCREENSHOT'
        : 'AI_GENERATED_FIRST_PARTY',
      source_distribution: 'APPROVED',
      binary_distribution: binary ? 'APPROVED' : 'NOT_INCLUDED',
      status: binary ? 'APPROVED_FOR_SOURCE_AND_BINARY' : 'APPROVED_FOR_SOURCE_ONLY'
    }
  })

  const embeddedContainers = [
    'docs/prototypes/renderer-p2-empty-camp/rovai-p2-empty-camp.html',
    'docs/prototypes/steel-night-full-app/index.html'
  ]
  const embedded_assets = embeddedContainers.flatMap((container) => {
    const content = readFileSync(join(root, container), 'utf8')
    const matches = [...content.matchAll(/data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/g)]
    return matches.map((match, index) => {
      const bytes = Buffer.from(match[2], 'base64')
      return {
        container,
        embedded_index: index + 1,
        media_type: `image/${match[1]}`,
        sha256: sha256(bytes),
        byte_length: bytes.length,
        role: 'prototype-character-illustration',
        source_classification: 'AI_GENERATED_FIRST_PARTY',
        source_distribution: 'APPROVED',
        binary_distribution: 'NOT_INCLUDED',
        status: 'APPROVED_FOR_SOURCE_ONLY'
      }
    })
  })

  const design_records = [
    '.stitch/runtime-not-ready-design.md',
    '.stitch/runtime-not-ready-options.html'
  ].map((path) => ({
    path,
    sha256: sha256(readFileSync(join(root, path))),
    source_classification: 'FIRST_PARTY_PROJECT_DESIGN',
    source_distribution: 'APPROVED',
    binary_distribution: 'NOT_INCLUDED',
    status: 'APPROVED_FOR_SOURCE_ONLY'
  }))

  return {
    schema_version: 1,
    owner_statement: {
      generator: 'OpenAI / ChatGPT image generation',
      classification: 'AI_GENERATED_FIRST_PARTY_PROJECT_ARTWORK',
      source_distribution: 'APPROVED',
      binary_distribution: 'APPROVED',
      limits: 'Does not grant rights in unrelated third-party trademarks, characters, people, or source material.'
    },
    assets,
    embedded_assets,
    design_records
  }
}

function flattenPnpmLicenses(grouped, directProduction, directDevelopment, productionIds, binaryIds) {
  return Object.values(grouped)
    .flat()
    .flatMap((row) => row.versions.map((version, index) => {
      const id = `${row.name}@${version}`
      const direct = directProduction.has(row.name) || directDevelopment.has(row.name)
      return {
        id,
        name: row.name,
        version,
        dependency_class: direct ? 'direct' : 'transitive',
        environment: productionIds.has(id) ? 'production' : 'development',
        bundled: binaryIds.has(id),
        license_expression: row.license,
        package_root: row.paths[index] ?? row.paths[0],
        author: row.author ?? null,
        homepage: row.homepage ?? null
      }
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

const LEGAL_FILE_BASENAME = /^(?:licen[cs]e|copying|notice|copyrights?|unlicense|patents?)(?:[-._].+)?$/i
const COPYRIGHT_NOTICE_BASENAME = /^copyrightnotice(?:[-._].+)?$/i
const NON_LEGAL_SOURCE_SUFFIX = /\.(?:c|cc|cjs|cpp|css|gif|go|h|hpp|java|jpeg|jpg|js|jsx|json|kt|less|mjs|png|ps1|py|rb|rs|sass|scss|sh|svg|swift|test|toml|ts|tsx|webp|xml|ya?ml)$/i

export function legalFileKind(sourceName) {
  if (basename(sourceName) !== sourceName || NON_LEGAL_SOURCE_SUFFIX.test(sourceName)) return null
  if (COPYRIGHT_NOTICE_BASENAME.test(sourceName)) return 'COPYRIGHT'
  if (!LEGAL_FILE_BASENAME.test(sourceName)) return null
  if (/^notices?(?:[-._]|$)/i.test(sourceName)) return 'NOTICE'
  if (/^copyrights?(?:[-._]|$)/i.test(sourceName)) return 'COPYRIGHT'
  if (/^patents?(?:[-._]|$)/i.test(sourceName)) return 'PATENT'
  return 'LICENSE'
}

export function isLegalFileBasename(sourceName) {
  return legalFileKind(sourceName) !== null
}

export function packageLegalFiles(packageRoot) {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isLegalFileBasename(entry.name))
    .map((entry) => ({ kind: legalFileKind(entry.name), source_name: entry.name }))
    .sort((left, right) => left.source_name < right.source_name ? -1 : left.source_name > right.source_name ? 1 : 0)
}

function licenseDirectoryName(name, version) {
  return `${name.replaceAll('/', '+')}@${version}`
}

function legalFileRecord(root, path, sourceName, kind = legalFileKind(sourceName)) {
  const bytes = readFileSync(join(root, path))
  return { kind, source_name: sourceName, path, sha256: sha256(bytes), size: bytes.length }
}

function legacyLicenseTexts(legalFiles) {
  return legalFiles.map(({ path, sha256: digest }) => ({ path, sha256: digest }))
}

function evidenceKind(dependency) {
  return typeof dependency.license_evidence === 'string'
    ? dependency.license_evidence
    : dependency.license_evidence?.kind
}

export function summarizeLegalCoverage(dependencies) {
  return {
    package_instances: dependencies.length,
    with_package_legal_files: dependencies.filter((entry) => evidenceKind(entry) === 'PACKAGE_LEGAL_FILES').length,
    with_curated_clarification: dependencies.filter((entry) => evidenceKind(entry) === 'CURATED_LICENSE_CLARIFICATION').length,
    metadata_only: dependencies.filter((entry) => evidenceKind(entry) === 'PACKAGE_METADATA_ONLY').length,
    zero_legal_files: dependencies.filter((entry) => entry.legal_files.length === 0).length,
    with_notice: dependencies.filter((entry) => entry.notice_file_present).length,
    with_notice_copyright_or_patent: dependencies.filter((entry) => entry.legal_files.some((file) => file.kind !== 'LICENSE')).length,
    with_multiple_license_files: dependencies.filter((entry) => entry.legal_files.filter((file) => file.kind === 'LICENSE').length > 1).length,
    legal_file_count: dependencies.reduce((total, entry) => total + entry.legal_files.length, 0)
  }
}

function javascriptDependencyEntries(root) {
  const packageJson = readJson(join(root, 'package.json'))
  const directProduction = new Set(Object.keys(packageJson.dependencies ?? {}))
  const directDevelopment = new Set(Object.keys(packageJson.devDependencies ?? {}))
  const allGrouped = JSON.parse(run('pnpm', ['licenses', 'list', '--json'], { cwd: root }))
  const prodGrouped = JSON.parse(run('pnpm', ['licenses', 'list', '--json', '--prod'], { cwd: root }))
  const prodIds = new Set(Object.values(prodGrouped).flat().flatMap((row) => row.versions.map((version) => `${row.name}@${version}`)))
  const binaryIds = new Set([...prodIds].filter((id) => !BINARY_PRUNE_EXCLUSIONS.has(id)))
  return flattenPnpmLicenses(allGrouped, directProduction, directDevelopment, prodIds, binaryIds)
}

export function generateJavaScriptManifests(root) {
  const entries = javascriptDependencyEntries(root)
  const licenseRoot = join(root, 'legal/licenses/javascript')
  rmSync(licenseRoot, { recursive: true, force: true })
  mkdirSync(licenseRoot, { recursive: true })

  for (const entry of entries) {
    const targetDirectory = join(licenseRoot, licenseDirectoryName(entry.name, entry.version))
    const packageFiles = packageLegalFiles(entry.package_root)
    let legalFiles
    if (entry.id === 'react-remove-scroll-bar@2.3.8') {
      mkdirSync(targetDirectory, { recursive: true })
      writeFileSync(join(targetDirectory, 'LICENSE'), REACT_REMOVE_SCROLL_BAR_LICENSE)
      const path = `legal/licenses/javascript/${licenseDirectoryName(entry.name, entry.version)}/LICENSE`
      legalFiles = [legalFileRecord(root, path, 'LICENSE', 'LICENSE')]
      entry.license_evidence = {
        kind: 'CURATED_LICENSE_CLARIFICATION',
        method: 'EXACT_PACKAGE_METADATA_AND_PINNED_UPSTREAM_LICENSE',
        package_id: entry.id,
        spdx_expression: entry.license_expression,
        npm_tarball_sha256: 'ccc872d7a2dc007cbf9d755f30d56b8d80eabdbe22c44c95a709129bfdc46f01',
        npm_git_head: 'b3b1287aad81def2e2ae707274b74531b61ddbaf',
        upstream_license_revision: '7301c160fda44cb8cf2b9fdfde61efad35736196',
        why_package_file_unavailable: 'The exact npm package tarball contains no license or notice file.',
        curated_file_path: path,
        curated_sha256: legalFiles[0].sha256,
        copyright_attribution: 'Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>',
        manual_review_record: 'TASK_08_RETAIN_EXISTING_CURATED_MIT_SCHEME'
      }
    } else if (packageFiles.length > 0) {
      mkdirSync(targetDirectory, { recursive: true })
      for (const file of packageFiles) {
        const sourcePath = join(entry.package_root, file.source_name)
        const sourceStat = lstatSync(sourcePath)
        assert(sourceStat.isFile() && !sourceStat.isSymbolicLink(), `package legal source must be a regular file: ${entry.id}/${file.source_name}`)
        cpSync(sourcePath, join(targetDirectory, file.source_name))
      }
      legalFiles = packageFiles.map((file) => {
        const path = `legal/licenses/javascript/${licenseDirectoryName(entry.name, entry.version)}/${file.source_name}`
        return legalFileRecord(root, path, file.source_name, file.kind)
      })
      entry.license_evidence = { kind: 'PACKAGE_LEGAL_FILES' }
    } else {
      legalFiles = []
      entry.license_evidence = { kind: 'PACKAGE_METADATA_ONLY' }
    }
    entry.legal_files = legalFiles
    entry.license_texts = legacyLicenseTexts(legalFiles)
    entry.notice_file_present = legalFiles.some((file) => file.kind === 'NOTICE')
    delete entry.package_root
  }

  const sourceManifest = {
    schema_version: 2,
    ecosystem: 'javascript',
    distribution_scope: 'source',
    lockfile: 'pnpm-lock.yaml',
    package_instances: entries.length,
    production_instances: entries.filter((entry) => entry.environment === 'production').length,
    development_instances: entries.filter((entry) => entry.environment === 'development').length,
    coverage: summarizeLegalCoverage(entries),
    dependencies: entries
  }
  const binaryEntries = entries.filter((entry) => entry.bundled)
  const binaryManifest = {
    schema_version: 2,
    ecosystem: 'javascript',
    distribution_scope: 'bundled',
    package_format: 'electron-builder app.asar',
    package_instances: binaryEntries.length,
    prune_exclusions: [...BINARY_PRUNE_EXCLUSIONS].sort(),
    coverage: summarizeLegalCoverage(binaryEntries),
    dependencies: binaryEntries
  }
  writeJson(join(root, 'legal/manifests/javascript-source-dependencies.json'), sourceManifest)
  writeJson(join(root, 'legal/manifests/javascript-binary-dependencies.json'), binaryManifest)
  const table = (title, rows) => `${title}\n\n| Package | Dependency | Environment | License | License evidence |\n|---|---|---|---|---|\n${rows.map((entry) => `| \`${entry.id}\` | ${entry.dependency_class} | ${entry.environment} | \`${entry.license_expression}\` | ${entry.license_texts.map((text) => `\`${text.path}\``).join('<br>') || entry.license_evidence.kind} |`).join('\n')}\n`
  writeFileSync(join(licenseRoot, 'SOURCE_PACKAGES.md'), table('# JavaScript Source Dependency Notice', entries))
  writeFileSync(join(licenseRoot, 'BUNDLED_PACKAGES.md'), table('# Bundled JavaScript Dependency Notice', binaryEntries))
  return { sourceManifest, binaryManifest }
}

function cargoEnvironment() {
  const cargo = run('rustup', ['which', 'cargo']).trim()
  const toolchainBin = dirname(cargo)
  return { cargo, env: { ...process.env, PATH: `${toolchainBin}:${process.env.PATH ?? ''}` } }
}

function parseCargoLock(content) {
  const packages = new Map()
  for (const section of content.split('[[package]]').slice(1)) {
    const name = section.match(/^\s*name = "([^"]+)"/m)?.[1]
    const version = section.match(/^\s*version = "([^"]+)"/m)?.[1]
    if (!name || !version) continue
    const source = section.match(/^\s*source = "([^"]+)"/m)?.[1] ?? null
    const checksum = section.match(/^\s*checksum = "([^"]+)"/m)?.[1] ?? null
    packages.set(`${name}@${version}`, { source, checksum })
  }
  return packages
}

function rustReleaseContext(root) {
  const { cargo, env } = cargoEnvironment()
  const tree = run(cargo, [
    'tree', '--locked', '-p', 'rovai-core', '--target', 'aarch64-apple-darwin',
    '-e', 'normal,build', '--prefix', 'none', '--format', '{p}'
  ], { cwd: root, env })
  const releaseIds = new Set(tree.split('\n')
    .map((line) => line.replace(/ \(\*\)$/, '').replace(/ \(proc-macro\)$/, '').trim())
    .filter((line) => line && !line.startsWith('rovai-core ')))
  const metadata = JSON.parse(run(cargo, ['metadata', '--locked', '--format-version', '1'], { cwd: root, env }))
  const core = metadata.packages.find((item) => item.name === 'rovai-core')
  const directNames = new Set(core.dependencies.filter((dependency) => dependency.kind !== 'dev').map((dependency) => dependency.name))
  const lock = parseCargoLock(readFileSync(join(root, 'Cargo.lock'), 'utf8'))
  const packages = metadata.packages.filter((item) => releaseIds.has(`${item.name} v${item.version}`))
  return { directNames, lock, packages }
}

export function generateRustManifest(root) {
  const { directNames, lock, packages } = rustReleaseContext(root)
  const licenseRoot = join(root, 'legal/licenses/rust')
  rmSync(licenseRoot, { recursive: true, force: true })
  mkdirSync(licenseRoot, { recursive: true })

  const dependencies = packages
    .map((item) => {
      const id = `${item.name}@${item.version}`
      const packageRoot = dirname(item.manifest_path)
      const targetDirectory = join(licenseRoot, id)
      const packageFiles = packageLegalFiles(packageRoot)
      if (packageFiles.length > 0) {
        mkdirSync(targetDirectory, { recursive: true })
        for (const file of packageFiles) {
          const sourcePath = join(packageRoot, file.source_name)
          const sourceStat = lstatSync(sourcePath)
          assert(sourceStat.isFile() && !sourceStat.isSymbolicLink(), `package legal source must be a regular file: ${id}/${file.source_name}`)
          cpSync(sourcePath, join(targetDirectory, file.source_name))
        }
      }
      const lockEntry = lock.get(id)
      const legalFiles = packageFiles.map((file) => {
        const path = `legal/licenses/rust/${id}/${file.source_name}`
        return legalFileRecord(root, path, file.source_name, file.kind)
      })
      return {
        id,
        crate: item.name,
        version: item.version,
        dependency_class: directNames.has(item.name) ? 'direct' : 'transitive',
        release: true,
        development: false,
        license_expression: item.license,
        license_file: item.license_file ? basename(item.license_file) : null,
        authors: item.authors,
        source: lockEntry?.source ?? item.source,
        repository: item.repository,
        crates_io_checksum: lockEntry?.checksum ?? null,
        legal_files: legalFiles,
        license_texts: legacyLicenseTexts(legalFiles),
        license_evidence: { kind: legalFiles.length > 0 ? 'PACKAGE_LEGAL_FILES' : 'PACKAGE_METADATA_ONLY' },
        notice_file_present: legalFiles.some((file) => file.kind === 'NOTICE'),
        required_notice: true
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  const sqliteDirectory = join(licenseRoot, 'sqlite-3.51.1')
  mkdirSync(sqliteDirectory, { recursive: true })
  writeFileSync(join(sqliteDirectory, 'PUBLIC-DOMAIN.md'), SQLITE_PUBLIC_DOMAIN)
  const manifest = {
    schema_version: 2,
    ecosystem: 'rust',
    distribution_scope: 'release',
    target: 'aarch64-apple-darwin',
    root_package: 'rovai-core@0.0.1',
    release_package_count: dependencies.length + 1,
    third_party_crate_count: dependencies.length,
    coverage: summarizeLegalCoverage(dependencies),
    dependencies,
    sqlite: {
      version: '3.51.1',
      source_crate: 'libsqlite3-sys@0.36.0',
      wrapper_crate: 'rusqlite@0.38.0',
      feature: 'bundled',
      legal_status: 'PUBLIC_DOMAIN',
      statement_path: 'legal/licenses/rust/sqlite-3.51.1/PUBLIC-DOMAIN.md',
      statement_sha256: sha256(readFileSync(join(sqliteDirectory, 'PUBLIC-DOMAIN.md')))
    },
    option_ext_review_status: OPTION_EXT_STATUS,
    option_ext_source: { ...OPTION_EXT_SOURCE }
  }
  writeJson(join(root, 'legal/manifests/rust-release-dependencies.json'), manifest)
  const rustNotice = `# Rust Release Dependency Notice\n\n| Crate | Dependency | License | Checksum | Legal files |\n|---|---|---|---|---|\n${dependencies.map((entry) => `| \`${entry.id}\` | ${entry.dependency_class} | \`${entry.license_expression}\` | \`${entry.crates_io_checksum}\` | ${entry.legal_files.map((file) => `\`${file.path}\``).join('<br>') || evidenceKind(entry)} |`).join('\n')}\n`
  writeFileSync(join(licenseRoot, 'RELEASE_CRATES.md'), rustNotice)
  return manifest
}

export function generateLegalManifests(root) {
  const artwork = generateArtworkManifest(root)
  writeJson(join(root, 'legal/manifests/project-artwork.json'), artwork)
  const javascript = generateJavaScriptManifests(root)
  const rust = generateRustManifest(root)
  return { artwork, javascript, rust }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function validateArtworkManifest(root, manifest = readJson(join(root, 'legal/manifests/project-artwork.json'))) {
  assert(manifest.owner_statement?.source_distribution === 'APPROVED', 'artwork source distribution is not approved')
  assert(manifest.owner_statement?.binary_distribution === 'APPROVED', 'artwork binary distribution is not approved')
  const expectedPaths = [...trackedRasterFiles(root), 'build/icon.svg'].sort()
  const actualPaths = manifest.assets.map((asset) => asset.path).sort()
  assert(new Set(actualPaths).size === actualPaths.length, 'artwork manifest contains duplicate paths')
  assert(JSON.stringify(actualPaths) === JSON.stringify(expectedPaths), 'artwork manifest does not cover the tracked project images exactly')
  for (const asset of manifest.assets) {
    assert(!isAbsolute(asset.path), `artwork path is absolute: ${asset.path}`)
    assert(asset.status !== 'REVIEW_REQUIRED', `artwork requires review: ${asset.path}`)
    assert(sha256(readFileSync(join(root, asset.path))) === asset.sha256, `artwork digest mismatch: ${asset.path}`)
  }
  const expectedEmbedded = generateArtworkManifest(root).embedded_assets
  assert(JSON.stringify(manifest.embedded_assets) === JSON.stringify(expectedEmbedded), 'embedded prototype artwork coverage or digest mismatch')
  assert(manifest.embedded_assets.length === 16, 'expected sixteen embedded prototype artwork occurrences')
  assert(new Set(manifest.embedded_assets.map((asset) => asset.sha256)).size === 8, 'expected eight unique embedded prototype images')
  for (const record of manifest.design_records) {
    assert(record.status !== 'REVIEW_REQUIRED', `design record requires review: ${record.path}`)
    assert(sha256(readFileSync(join(root, record.path))) === record.sha256, `design record digest mismatch: ${record.path}`)
  }
  return manifest
}

function manifestPackageRoots(root, manifest) {
  if (manifest.ecosystem === 'javascript') {
    return new Map(javascriptDependencyEntries(root).map((entry) => [entry.id, entry.package_root]))
  }
  if (manifest.ecosystem === 'rust') {
    return new Map(rustReleaseContext(root).packages.map((item) => [
      `${item.name}@${item.version}`,
      dirname(item.manifest_path)
    ]))
  }
  return null
}

function legalOutputPrefix(manifest, dependency) {
  if (manifest.ecosystem === 'javascript') {
    return `legal/licenses/javascript/${licenseDirectoryName(dependency.name, dependency.version)}`
  }
  if (manifest.ecosystem === 'rust') return `legal/licenses/rust/${dependency.id}`
  return null
}

function assertCuratedLicenseEvidence(dependency, ecosystem) {
  const evidence = dependency.license_evidence
  assert(evidence && typeof evidence === 'object', `curated license evidence must be structured: ${dependency.id}`)
  for (const field of [
    'method',
    'package_id',
    'spdx_expression',
    'why_package_file_unavailable',
    'curated_file_path',
    'curated_sha256',
    'copyright_attribution',
    'manual_review_record'
  ]) assert(evidence[field], `curated license evidence misses ${field}: ${dependency.id}`)
  assert(evidence.package_id === dependency.id, `curated package identity mismatch: ${dependency.id}`)
  assert(evidence.spdx_expression === dependency.license_expression, `curated SPDX expression mismatch: ${dependency.id}`)
  assert(dependency.legal_files.some((file) => file.path === evidence.curated_file_path && file.sha256 === evidence.curated_sha256), `curated file metadata mismatch: ${dependency.id}`)
  if (ecosystem === 'javascript') {
    for (const field of ['npm_tarball_sha256', 'npm_git_head', 'upstream_license_revision']) {
      assert(evidence[field], `curated JavaScript evidence misses ${field}: ${dependency.id}`)
    }
  }
  if (ecosystem === 'rust') {
    assert(dependency.crates_io_checksum, `curated Rust evidence misses crates.io checksum: ${dependency.id}`)
    assert(evidence.upstream_revision || evidence.fixed_archive_sha256, `curated Rust evidence misses fixed upstream revision or archive: ${dependency.id}`)
  }
}

export function verifyManifestLicenseFiles(root, manifest, options = {}) {
  if (manifest.ecosystem) assert(manifest.schema_version === 2, 'dependency legal manifest schema must be version 2')
  const packageRoots = options.packageRoots ?? manifestPackageRoots(root, manifest)
  for (const dependency of manifest.dependencies) {
    assert(dependency.license_expression, `missing license expression: ${dependency.id}`)
    assert(!/(?:unknown|unlicensed|custom|see license|noassertion)/i.test(dependency.license_expression), `unknown or custom license expression: ${dependency.id}`)
    assert(Array.isArray(dependency.legal_files), `missing legal_files array: ${dependency.id}`)
    assert(Array.isArray(dependency.license_texts), `missing license_texts array: ${dependency.id}`)
    const kind = evidenceKind(dependency)
    const strictDistribution = manifest.distribution_scope === 'bundled' || manifest.distribution_scope === 'release' || dependency.bundled === true
    assert(['PACKAGE_LEGAL_FILES', 'CURATED_LICENSE_CLARIFICATION', 'PACKAGE_METADATA_ONLY'].includes(kind), `unknown license evidence kind: ${dependency.id}`)
    if (kind === 'PACKAGE_METADATA_ONLY') {
      assert(manifest.ecosystem === 'javascript' && manifest.distribution_scope === 'source' && dependency.environment === 'development' && dependency.bundled === false, `metadata-only license evidence is restricted to non-distributed development dependencies: ${dependency.id}`)
    }
    if (strictDistribution) {
      assert(kind !== 'PACKAGE_METADATA_ONLY', `metadata-only license evidence is forbidden for distributed dependency: ${dependency.id}`)
      assert(dependency.legal_files.length > 0, `distributed dependency has zero legal files: ${dependency.id}`)
    }
    if (kind === 'PACKAGE_LEGAL_FILES') assert(dependency.legal_files.length > 0, `package legal file evidence is empty: ${dependency.id}`)
    if (kind === 'CURATED_LICENSE_CLARIFICATION') assertCuratedLicenseEvidence(dependency, manifest.ecosystem)

    const legalPaths = dependency.legal_files.map((file) => file.path)
    assert(new Set(legalPaths).size === legalPaths.length, `duplicate legal file path: ${dependency.id}`)
    assert(JSON.stringify(legalPaths) === JSON.stringify([...legalPaths].sort()), `legal files are not stably sorted: ${dependency.id}`)
    for (const file of dependency.legal_files) {
      assert(['LICENSE', 'NOTICE', 'COPYRIGHT', 'PATENT'].includes(file.kind), `unknown legal file kind: ${dependency.id}/${file.source_name}`)
      assert(legalFileKind(file.source_name) === file.kind, `legal file kind or source basename mismatch: ${dependency.id}/${file.source_name}`)
      assert(basename(file.path) === file.source_name, `legal file path loses source basename: ${dependency.id}/${file.source_name}`)
      assert(!isAbsolute(file.path), `absolute legal path: ${file.path}`)
      const absolutePath = resolve(root, file.path)
      assert(absolutePath.startsWith(`${resolve(root)}${sep}`), `legal path escapes repository root: ${file.path}`)
      assert(existsSync(absolutePath), `missing legal file: ${file.path}`)
      const fileStat = lstatSync(absolutePath)
      assert(fileStat.isFile() && !fileStat.isSymbolicLink(), `legal output must be a regular file: ${file.path}`)
      const bytes = readFileSync(absolutePath)
      assert(bytes.length === file.size, `legal file size mismatch: ${file.path}`)
      assert(sha256(bytes) === file.sha256, `license digest mismatch: ${file.path}`)
    }
    assert(JSON.stringify(dependency.license_texts) === JSON.stringify(legacyLicenseTexts(dependency.legal_files)), `legacy license_texts does not cover every legal file: ${dependency.id}`)
    assert(dependency.notice_file_present === dependency.legal_files.some((file) => file.kind === 'NOTICE'), `notice presence mismatch: ${dependency.id}`)

    const outputPrefix = legalOutputPrefix(manifest, dependency)
    if (outputPrefix) {
      const expectedPaths = dependency.legal_files.map((file) => `${outputPrefix}/${file.source_name}`)
      assert(JSON.stringify(legalPaths) === JSON.stringify(expectedPaths), `legal output path mismatch: ${dependency.id}`)
      const outputDirectory = join(root, outputPrefix)
      const actualOutputNames = existsSync(outputDirectory)
        ? readdirSync(outputDirectory, { withFileTypes: true }).map((entry) => {
            assert(entry.isFile(), `dependency legal output contains a directory or symlink: ${dependency.id}/${entry.name}`)
            return entry.name
          }).sort()
        : []
      assert(JSON.stringify(actualOutputNames) === JSON.stringify(dependency.legal_files.map((file) => file.source_name)), `tracked legal output is not represented exactly in manifest: ${dependency.id}`)
    }

    if (packageRoots) {
      const packageRoot = packageRoots.get(dependency.id)
      if (!packageRoot) {
        // pnpm installs only the host-compatible optional packages. A source
        // checkout on Windows therefore cannot inspect macOS-only development
        // packages (and vice versa), even though their tracked legal output is
        // still validated above. This exception never applies to anything
        // bundled or released by the current artifact.
        assert(
          manifest.ecosystem === 'javascript'
            && manifest.distribution_scope === 'source'
            && dependency.environment === 'development'
            && dependency.bundled === false,
          `exact package root is unavailable: ${dependency.id}`
        )
        continue
      }
      const packageFiles = packageLegalFiles(packageRoot)
      const packageNames = packageFiles.map((file) => file.source_name)
      if (packageNames.length > 0) {
        assert(kind === 'PACKAGE_LEGAL_FILES', `package legal files were replaced by non-package evidence: ${dependency.id}`)
        assert(JSON.stringify(packageNames) === JSON.stringify(dependency.legal_files.map((file) => file.source_name)), `package legal files are not represented exactly in manifest: ${dependency.id}`)
        for (const file of dependency.legal_files) {
          const packagePath = join(packageRoot, file.source_name)
          const packageStat = lstatSync(packagePath)
          assert(packageStat.isFile() && !packageStat.isSymbolicLink(), `package legal source is not a regular file: ${dependency.id}/${file.source_name}`)
          assert(sha256(readFileSync(packagePath)) === file.sha256, `package legal source differs from tracked output: ${dependency.id}/${file.source_name}`)
        }
      } else {
        assert(kind !== 'PACKAGE_LEGAL_FILES', `package legal file evidence has no package source files: ${dependency.id}`)
      }
    }
  }
  if (manifest.coverage) assert(JSON.stringify(manifest.coverage) === JSON.stringify(summarizeLegalCoverage(manifest.dependencies)), 'manifest legal coverage summary is stale')
}

export function validateSkillLineage(skill, notice) {
  assert(!notice.includes('EXTERNAL_LINEAGE_UNRESOLVED'), `${skill} lineage remains unresolved`)
  if (skill === 'grill-duo' || skill === 'grill-duo-with-docs') {
    assert(notice.includes('84fdeffd12f2ee307994d1eb6feb48173b6e0502'), `${skill} notice lacks exact upstream revision`)
  }
}

function cargoPackageMetadata(content, label) {
  const field = (name) => content.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'))?.[1]
  const metadata = {
    name: field('name'),
    version: field('version'),
    license: field('license'),
    repository: field('repository')
  }
  assert(Object.values(metadata).every(Boolean), `option-ext archive ${label} metadata is incomplete`)
  return metadata
}

export function inspectOptionExtArchive(archivePath, expectedSha256 = OPTION_EXT_SOURCE.sha256) {
  assert(existsSync(archivePath), `option-ext source archive is missing: ${OPTION_EXT_SOURCE.path}`)
  assert(statSync(archivePath).isFile(), 'option-ext source archive must be a regular file')
  assert(basename(archivePath) === 'option-ext-0.2.0.crate', 'option-ext source archive filename or version changed')
  const bytes = readFileSync(archivePath)
  assert(sha256(bytes) === expectedSha256, 'option-ext source archive digest mismatch')

  const entries = run('tar', ['-tzf', archivePath]).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
  assert(entries.length > 0, 'option-ext source archive is empty')
  assert(entries.every((entry) => entry.startsWith('option-ext-0.2.0/')), 'option-ext source archive has an unexpected root')
  for (const required of [
    'option-ext-0.2.0/Cargo.toml',
    'option-ext-0.2.0/Cargo.toml.orig',
    'option-ext-0.2.0/LICENSE.txt'
  ]) {
    assert(entries.includes(required), `option-ext source archive misses ${required}`)
  }
  assert(entries.some((entry) => entry.startsWith('option-ext-0.2.0/src/') && !entry.endsWith('/')), 'option-ext source archive misses source files')

  const expectedMetadata = {
    name: 'option-ext',
    version: '0.2.0',
    license: 'MPL-2.0',
    repository: 'https://github.com/soc/option-ext.git'
  }
  for (const manifest of ['Cargo.toml', 'Cargo.toml.orig']) {
    const content = run('tar', ['-xOzf', archivePath, `option-ext-0.2.0/${manifest}`])
    assert(JSON.stringify(cargoPackageMetadata(content, manifest)) === JSON.stringify(expectedMetadata), `option-ext archive ${manifest} metadata changed`)
  }
  const license = run('tar', ['-xOzf', archivePath, 'option-ext-0.2.0/LICENSE.txt'])
  assert(license.includes('Mozilla Public License Version 2.0'), 'option-ext archive LICENSE.txt is not MPL-2.0')
  return { sha256: expectedSha256, entries, metadata: expectedMetadata }
}

export function validateOptionExtCompliance(root, options = {}) {
  const rust = options.rustManifest ?? readJson(join(root, 'legal/manifests/rust-release-dependencies.json'))
  const provenance = options.provenance ?? readFileSync(join(root, 'legal/provenance/option-ext-0.2.0.md'), 'utf8')
  const notice = options.thirdPartyNotice ?? readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const sourceReadme = options.sourceReadme ?? readFileSync(join(root, 'legal/sources/rust/README.md'), 'utf8')
  const archivePath = options.archivePath ?? join(root, OPTION_EXT_SOURCE.path)
  const licensePath = options.licensePath ?? join(root, 'legal/licenses/rust/option-ext@0.2.0/LICENSE.txt')

  assert(rust.option_ext_review_status === OPTION_EXT_STATUS, `option-ext review status must be ${OPTION_EXT_STATUS}`)
  assert(JSON.stringify(rust.option_ext_source) === JSON.stringify(OPTION_EXT_SOURCE), 'option-ext source manifest metadata changed')
  const optionExt = rust.dependencies.find((entry) => entry.id === 'option-ext@0.2.0')
  assert(optionExt?.license_expression === 'MPL-2.0', 'option-ext MPL-2.0 entry is missing')
  assert(optionExt?.crates_io_checksum === OPTION_EXT_SOURCE.sha256, 'option-ext checksum changed')

  if (options.requireTracked !== false) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', OPTION_EXT_SOURCE.path], {
      cwd: root,
      encoding: 'utf8'
    })
    assert(tracked.status === 0 && tracked.stdout.trim() === OPTION_EXT_SOURCE.path, 'option-ext source archive is not tracked by Git')
  }
  inspectOptionExtArchive(archivePath)

  assert(existsSync(licensePath), 'option-ext MPL-2.0 license text is missing')
  assert(readFileSync(licensePath, 'utf8').includes('Mozilla Public License Version 2.0'), 'option-ext packaged license text is not MPL-2.0')
  assert(provenance.includes('| Review status | `APPROVED_COMPLIANCE_PLAN` |'), 'option-ext provenance review status is not approved')
  assert(provenance.includes('| Rovai modifications | none |'), 'option-ext provenance does not record the unmodified component')
  assert(provenance.includes(OPTION_EXT_SOURCE.path), 'option-ext provenance misses the repository source path')

  const packagedSourcePath = 'Contents/Resources/legal/rust/sources/option-ext-0.2.0.crate'
  const packagedLicensePath = 'Contents/Resources/legal/rust/licenses/option-ext@0.2.0/LICENSE.txt'
  for (const [label, content] of [['THIRD_PARTY_NOTICES', notice], ['source README', sourceReadme]]) {
    assert(content.includes(OPTION_EXT_SOURCE.path), `${label} misses the repository source path`)
    assert(content.includes(packagedSourcePath), `${label} misses the packaged source path`)
    assert(content.includes(OPTION_EXT_SOURCE.sha256), `${label} misses the option-ext source checksum`)
  }
  assert(notice.includes(packagedLicensePath), 'THIRD_PARTY_NOTICES misses the packaged MPL license path')
  assert(/copy, inspect, (?:extract, )?and modify/i.test(notice), 'THIRD_PARTY_NOTICES does not explain recipient source access')

  const boundaryText = `${provenance}\n${notice}\n${sourceReadme}`
  for (const prohibited of [
    /option-ext is MIT/i,
    /all Rovai source is MPL/i,
    /all binary contents are relicensed under MPL/i,
    /external counsel approved/i
  ]) {
    assert(!prohibited.test(boundaryText), `option-ext license-boundary claim is prohibited: ${prohibited}`)
  }
  return { status: OPTION_EXT_STATUS, source: { ...OPTION_EXT_SOURCE } }
}

export function verifySource(root = process.cwd()) {
  const required = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'legal/provenance/ai-generated-project-artwork.md',
    'legal/provenance/codex-schema.md',
    'legal/provenance/option-ext-0.2.0.md',
    'legal/sources/rust/README.md',
    OPTION_EXT_SOURCE.path,
    'legal/manifests/project-artwork.json',
    'legal/manifests/javascript-source-dependencies.json',
    'legal/manifests/javascript-binary-dependencies.json',
    'legal/manifests/rust-release-dependencies.json'
  ]
  for (const path of required) assert(existsSync(join(root, path)), `missing required legal source: ${path}`)
  validateArtworkManifest(root)

  const logoNotice = readFileSync(join(root, 'apps/desktop/src/renderer/src/assets/runtime-logos/ASSET-NOTICE.md'), 'utf8')
  const logos = readdirSync(join(root, 'apps/desktop/src/renderer/src/assets/runtime-logos'))
    .filter((name) => name.endsWith('.svg')).sort()
  assert(logos.length === 11, 'runtime logo directory must contain eleven SVGs')
  for (const logo of logos) assert(logoNotice.includes(`\`${logo}\``), `runtime logo notice misses ${logo}`)
  assert((logoNotice.match(/\| `[^`]+\.svg` \| `BYTE_IDENTICAL` \|/g) ?? []).length === 9, 'runtime logo notice must record nine byte-identical files')
  assert((logoNotice.match(/\| `[^`]+\.svg` \| `FORMAT_ONLY_TRAILING_NEWLINE` \|/g) ?? []).length === 2, 'runtime logo notice must record two trailing-newline-only files')
  assert(logoNotice.includes('Material SVG changes: `0`'), 'runtime logo notice must record zero material changes')

  for (const skill of SKILLS) {
    assert(existsSync(join(root, `skills/${skill}/NOTICE`)), `missing Skill NOTICE: ${skill}`)
    if (EXTERNAL_SKILLS.has(skill)) assert(existsSync(join(root, `skills/${skill}/LICENSE`)), `missing Skill LICENSE: ${skill}`)
  }
  for (const skill of ['grill-duo', 'grill-duo-with-docs']) {
    const notice = readFileSync(join(root, `skills/${skill}/NOTICE`), 'utf8')
    validateSkillLineage(skill, notice)
  }

  const codex = codexSchemaAggregate(root)
  assert(codex.file_count === EXPECTED_CODEX_SCHEMA.file_count, 'Codex schema file count changed')
  assert(codex.normalized_aggregate_sha256 === EXPECTED_CODEX_SCHEMA.normalized_aggregate_sha256, 'Codex schema normalized digest changed')
  const codexProvenance = readFileSync(join(root, 'legal/provenance/codex-schema.md'), 'utf8')
  assert(codexProvenance.includes('87db9bc18ba5bc82c1cb4e4381b44f693ee35623'), 'Codex schema exact revision is missing')
  assert(codexProvenance.includes('0 semantic differences'), 'Codex schema semantic comparison is unresolved')

  const jsSource = readJson(join(root, 'legal/manifests/javascript-source-dependencies.json'))
  const jsBinary = readJson(join(root, 'legal/manifests/javascript-binary-dependencies.json'))
  assert(jsSource.package_instances === 494, 'expected 494 JavaScript source dependency instances')
  assert(jsSource.production_instances === 149, 'expected 149 JavaScript production dependency instances')
  assert(jsSource.development_instances === 345, 'expected 345 JavaScript development-only dependency instances')
  assert(jsBinary.package_instances === 144, 'expected 144 bundled JavaScript package instances')
  verifyManifestLicenseFiles(root, jsSource)
  verifyManifestLicenseFiles(root, jsBinary)
  const sourceIds = jsSource.dependencies.map((entry) => entry.id)
  const binaryIds = jsBinary.dependencies.map((entry) => entry.id)
  assert(new Set(sourceIds).size === sourceIds.length && JSON.stringify(sourceIds) === JSON.stringify([...sourceIds].sort((left, right) => left.localeCompare(right))), 'JavaScript source manifest must be uniquely and stably sorted')
  assert(JSON.stringify(binaryIds) === JSON.stringify(jsSource.dependencies.filter((entry) => entry.bundled).map((entry) => entry.id)), 'JavaScript binary manifest must equal the bundled source subset')
  assert(jsBinary.dependencies.every((entry) => entry.license_texts.length > 0), 'every bundled JavaScript package must include license text')
  assert(jsBinary.coverage.metadata_only === 0 && jsBinary.coverage.zero_legal_files === 0, 'bundled JavaScript legal file coverage is incomplete')
  const scrollBar = jsBinary.dependencies.find((entry) => entry.id === 'react-remove-scroll-bar@2.3.8')
  assert(scrollBar?.license_texts.length === 1, 'react-remove-scroll-bar license text is missing')
  assert(evidenceKind(scrollBar) === 'CURATED_LICENSE_CLARIFICATION', 'react-remove-scroll-bar curated clarification changed')
  assert(scrollBar.license_evidence?.npm_tarball_sha256 === 'ccc872d7a2dc007cbf9d755f30d56b8d80eabdbe22c44c95a709129bfdc46f01', 'react-remove-scroll-bar tarball provenance changed')

  const rust = readJson(join(root, 'legal/manifests/rust-release-dependencies.json'))
  assert(rust.third_party_crate_count === 119, 'expected 119 third-party Rust release crates')
  assert(rust.release_package_count === 120, 'expected 120 Rust release packages including rovai-core')
  verifyManifestLicenseFiles(root, rust)
  const rustIds = rust.dependencies.map((entry) => entry.id)
  assert(new Set(rustIds).size === rustIds.length && JSON.stringify(rustIds) === JSON.stringify([...rustIds].sort((left, right) => left.localeCompare(right))), 'Rust release manifest must be uniquely and stably sorted')
  assert(rust.coverage.metadata_only === 0, 'Rust release manifest contains metadata-only license evidence')
  assert(rust.coverage.zero_legal_files === 0, 'Rust release manifest contains a dependency with zero legal files')
  const anyhow = rust.dependencies.find((entry) => entry.id === 'anyhow@1.0.103')
  assert(anyhow?.license_expression === 'MIT OR Apache-2.0', 'anyhow 1.0.103 license expression changed')
  assert(anyhow?.crates_io_checksum === '2a4385e2e34eb35d6b3efe798b9eb88096925d87726c0798709bf56d9ed84af3', 'anyhow 1.0.103 crates.io checksum changed')
  assert(JSON.stringify(anyhow.legal_files.map((file) => file.source_name)) === JSON.stringify(['LICENSE-APACHE', 'LICENSE-MIT']), 'anyhow 1.0.103 legal files are incomplete')
  assert(rust.sqlite?.version === '3.51.1' && rust.sqlite?.legal_status === 'PUBLIC_DOMAIN', 'SQLite provenance is incomplete')
  validateOptionExtCompliance(root, { rustManifest: rust })

  for (const path of walkFiles(join(root, 'legal'))) {
    if (path.endsWith('.crate')) continue
    const content = readFileSync(join(root, 'legal', path), 'utf8')
    assert(!/\/Users\/[^/]+\//.test(content), `local absolute path leaked into legal/${path}`)
    assert(!/[A-Za-z]:\\Users\\[^\\]+\\/.test(content), `Windows absolute path leaked into legal/${path}`)
  }
  return {
    source_release_gate: 'PASS',
    binary_release_gate: 'PASS',
    javascript_source_instances: jsSource.package_instances,
    javascript_binary_instances: jsBinary.package_instances,
    rust_third_party_crates: rust.third_party_crate_count
  }
}

function findElectronArchive(version, platform, arch) {
  const filename = `electron-v${version}-${platform}-${arch}.zip`
  const cacheRoots = platform === 'darwin'
    ? [join(homedir(), 'Library/Caches/electron')]
    : platform === 'win32'
      ? [join(homedir(), 'AppData/Local/electron/Cache'), join(homedir(), '.cache/electron')]
      : [join(homedir(), '.cache/electron')]
  const candidates = cacheRoots
    .filter((root) => existsSync(root))
    .flatMap((root) => walkFiles(root).map((path) => ({ root, path })))
    .filter(({ path }) => path.endsWith(`/${filename}`) || path === filename)
  assert(candidates.length > 0, `Electron archive is not cached: ${filename}; run the frozen install/build first`)
  return { filename, path: join(candidates[0].root, candidates[0].path) }
}

function extractElectronArchiveFile(archive, name) {
  const command = platform() === 'win32' ? 'tar.exe' : 'unzip'
  const args = platform() === 'win32' ? ['-xOf', archive, name] : ['-p', archive, name]
  const result = spawnSync(command, args, { encoding: null, maxBuffer: 64 * 1024 * 1024 })
  assert(result.status === 0 && result.stdout.length > 0, `Electron archive misses ${name}`)
  return result.stdout
}

function copySource(root, payload, source, target = source) {
  const from = join(root, source)
  assert(existsSync(from), `missing legal payload source: ${source}`)
  const to = join(payload, target)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
}

export function prepareLegalPayload(root = process.cwd(), output = join(root, '.legal-payload')) {
  verifySource(root)
  const payload = resolve(output)
  assert(payload !== resolve(root), 'legal payload output cannot be the repository root')
  rmSync(payload, { recursive: true, force: true })
  mkdirSync(payload, { recursive: true })
  copySource(root, payload, 'LICENSE')
  copySource(root, payload, 'THIRD_PARTY_NOTICES.md')
  copySource(root, payload, 'legal/README.md', 'README.md')
  copySource(root, payload, 'legal/provenance', 'provenance')
  copySource(root, payload, 'legal/manifests', 'manifests')
  copySource(root, payload, 'legal/licenses/javascript', 'javascript/licenses')
  copySource(root, payload, 'legal/licenses/rust', 'rust/licenses')
  copySource(root, payload, 'legal/sources/rust', 'rust/sources')
  copySource(root, payload, 'legal/licenses/codex', 'schemas/codex/LICENSE')
  copySource(root, payload, 'legal/licenses/runtime-logos', 'assets/runtime-logos/LICENSE')
  copySource(root, payload, 'apps/desktop/src/renderer/src/assets/characters/ASSET-NOTICE.md', 'assets/characters/ASSET-NOTICE.md')
  copySource(root, payload, 'apps/desktop/src/renderer/src/assets/world-map/ASSET-NOTICE.md', 'assets/world-map/ASSET-NOTICE.md')
  copySource(root, payload, 'apps/desktop/src/renderer/src/assets/runtime-logos/ASSET-NOTICE.md', 'assets/runtime-logos/ASSET-NOTICE.md')
  copySource(root, payload, 'build/ASSET-NOTICE.md', 'assets/application-icon/ASSET-NOTICE.md')
  for (const skill of SKILLS) {
    copySource(root, payload, `skills/${skill}/NOTICE`, `skills/${skill}/NOTICE`)
    if (EXTERNAL_SKILLS.has(skill)) copySource(root, payload, `skills/${skill}/LICENSE`, `skills/${skill}/LICENSE`)
  }

  const electronVersion = readJson(join(root, 'node_modules/electron/package.json')).version
  const electronPlatform = platform()
  const electronArch = arch()
  assert(['darwin', 'win32'].includes(electronPlatform), `legal payload packaging is unsupported on ${electronPlatform}`)
  assert(['arm64', 'x64'].includes(electronArch), `legal payload packaging is unsupported on ${electronArch}`)
  const { filename, path: archive } = findElectronArchive(electronVersion, electronPlatform, electronArch)
  const checksums = readJson(join(root, 'node_modules/electron/checksums.json'))
  const expectedArchiveSha = checksums[filename]
  assert(expectedArchiveSha, `Electron checksum manifest misses ${filename}`)
  assert(sha256(readFileSync(archive)) === expectedArchiveSha, 'Electron release archive checksum mismatch')
  const electronDirectory = join(payload, 'electron')
  mkdirSync(electronDirectory, { recursive: true })
  const electronFiles = ['LICENSE', 'LICENSES.chromium.html'].map((name) => {
    const bytes = extractElectronArchiveFile(archive, name)
    writeFileSync(join(electronDirectory, name), bytes)
    return { path: `electron/${name}`, sha256: sha256(bytes), size: bytes.length }
  })
  writeJson(join(electronDirectory, 'manifest.json'), {
    schema_version: 1,
    electron_version: electronVersion,
    archive: filename,
    archive_sha256: expectedArchiveSha,
    files: electronFiles
  })

  const files = walkFiles(payload).filter((path) => path !== 'manifest.json').map((path) => {
    const bytes = readFileSync(join(payload, path))
    return { path, sha256: sha256(bytes), size: bytes.length }
  })
  writeJson(join(payload, 'manifest.json'), {
    schema_version: 1,
    deterministic: true,
    files
  })
  verifyPayload(payload, { enforceReleaseGate: false })
  return { payload, files: files.length }
}

function verifyPackagedDependencyLegalFiles(payload, manifest) {
  assert(manifest.schema_version === 2, 'packaged dependency legal manifest schema must be version 2')
  assert(JSON.stringify(manifest.coverage) === JSON.stringify(summarizeLegalCoverage(manifest.dependencies)), 'packaged dependency legal coverage summary is stale')
  const sourcePrefix = manifest.ecosystem === 'javascript'
    ? 'legal/licenses/javascript/'
    : 'legal/licenses/rust/'
  const payloadPrefix = manifest.ecosystem === 'javascript'
    ? 'javascript/licenses/'
    : 'rust/licenses/'
  for (const dependency of manifest.dependencies) {
    const kind = evidenceKind(dependency)
    assert(dependency.license_expression && !/(?:unknown|unlicensed|custom|see license|noassertion)/i.test(dependency.license_expression), `packaged dependency has an unknown license expression: ${dependency.id}`)
    assert(['PACKAGE_LEGAL_FILES', 'CURATED_LICENSE_CLARIFICATION', 'PACKAGE_METADATA_ONLY'].includes(kind), `packaged dependency has invalid license evidence: ${dependency.id}`)
    assert(kind !== 'PACKAGE_METADATA_ONLY', `packaged dependency uses metadata-only license evidence: ${dependency.id}`)
    assert(dependency.legal_files.length > 0, `packaged dependency has zero legal files: ${dependency.id}`)
    if (kind === 'CURATED_LICENSE_CLARIFICATION') assertCuratedLicenseEvidence(dependency, manifest.ecosystem)
    assert(JSON.stringify(dependency.license_texts) === JSON.stringify(legacyLicenseTexts(dependency.legal_files)), `packaged legacy license_texts is incomplete: ${dependency.id}`)
    assert(dependency.notice_file_present === dependency.legal_files.some((file) => file.kind === 'NOTICE'), `packaged notice presence mismatch: ${dependency.id}`)
    for (const file of dependency.legal_files) {
      assert(legalFileKind(file.source_name) === file.kind, `packaged legal file kind or basename mismatch: ${dependency.id}/${file.source_name}`)
      assert(file.path.startsWith(sourcePrefix), `packaged dependency legal path has an unexpected prefix: ${file.path}`)
      const payloadPath = `${payloadPrefix}${file.path.slice(sourcePrefix.length)}`
      assert(basename(payloadPath) === file.source_name, `packaged legal path loses source basename: ${dependency.id}/${file.source_name}`)
      const absolutePath = resolve(payload, payloadPath)
      assert(absolutePath.startsWith(`${resolve(payload)}${sep}`), `packaged legal path escapes payload root: ${payloadPath}`)
      assert(existsSync(absolutePath), `packaged legal payload misses ${payloadPath}`)
      const bytes = readFileSync(absolutePath)
      assert(bytes.length === file.size, `packaged legal file size mismatch: ${payloadPath}`)
      assert(sha256(bytes) === file.sha256, `packaged legal file digest mismatch: ${payloadPath}`)
    }
  }
}

export function verifyPayload(path, { enforceReleaseGate = true } = {}) {
  const packagedApp = path.endsWith('.app') ? path : null
  const payload = packagedApp ? join(packagedApp, 'Contents/Resources/legal') : path
  assert(existsSync(payload), `legal payload does not exist: ${payload}`)
  const required = [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'README.md',
    'provenance/ai-generated-project-artwork.md',
    'provenance/codex-schema.md',
    'provenance/option-ext-0.2.0.md',
    'assets/runtime-logos/ASSET-NOTICE.md',
    'javascript/licenses/react-remove-scroll-bar@2.3.8/LICENSE',
    'javascript/licenses/BUNDLED_PACKAGES.md',
    'rust/licenses/option-ext@0.2.0/LICENSE.txt',
    'rust/licenses/anyhow@1.0.103/LICENSE-APACHE',
    'rust/licenses/anyhow@1.0.103/LICENSE-MIT',
    'rust/licenses/RELEASE_CRATES.md',
    'rust/licenses/sqlite-3.51.1/PUBLIC-DOMAIN.md',
    'rust/sources/option-ext-0.2.0.crate',
    'rust/sources/README.md',
    'electron/LICENSE',
    'electron/LICENSES.chromium.html',
    'schemas/codex/LICENSE',
    'manifest.json'
  ]
  for (const item of required) assert(existsSync(join(payload, item)), `packaged legal payload misses ${item}`)
  for (const skill of SKILLS) assert(existsSync(join(payload, `skills/${skill}/NOTICE`)), `packaged legal payload misses ${skill} NOTICE`)
  const manifest = readJson(join(payload, 'manifest.json'))
  const actual = walkFiles(payload).filter((item) => item !== 'manifest.json')
  assert(JSON.stringify(manifest.files.map((item) => item.path)) === JSON.stringify(actual), 'legal payload manifest paths are not stable and complete')
  for (const item of manifest.files) {
    assert(!isAbsolute(item.path), `legal payload manifest contains an absolute path: ${item.path}`)
    const bytes = readFileSync(join(payload, item.path))
    assert(bytes.length === item.size, `legal payload size mismatch: ${item.path}`)
    assert(sha256(bytes) === item.sha256, `legal payload digest mismatch: ${item.path}`)
  }
  const serialized = JSON.stringify(manifest)
  assert(!/\/Users\/[^/]+\//.test(serialized), 'legal payload manifest contains a local absolute path')
  assert(!/(created|generated|timestamp|time)_at/i.test(serialized), 'legal payload manifest contains a time-varying field')
  if (packagedApp) {
    const appAsar = join(packagedApp, 'Contents/Resources/app.asar')
    assert(existsSync(appAsar), 'packaged application is missing app.asar')
    const pnpmDirectory = join(repositoryRoot, 'node_modules/.pnpm')
    const asarPackage = readdirSync(pnpmDirectory).find((name) => name.startsWith('@electron+asar@'))
    assert(asarPackage, 'installed @electron/asar is required to inspect the packaged dependency graph')
    const asar = require(join(pnpmDirectory, asarPackage, 'node_modules/@electron/asar/lib/asar.js'))
    const asarPaths = asar.listPackage(appAsar)
    assert(!asarPaths.some((item) => item === '/legal' || item.startsWith('/legal/')), 'legal payload must remain outside app.asar')
    const packageJsonPaths = asarPaths
      .filter((item) => item.startsWith('/node_modules/') && item.endsWith('/package.json'))
      .sort()
    const packagedDependencies = packageJsonPaths.flatMap((item) => {
      const metadata = JSON.parse(asar.extractFile(appAsar, item.slice(1)).toString('utf8'))
      return metadata.name && metadata.version ? [`${metadata.name}@${metadata.version}`] : []
    }).sort()
    const expectedDependencies = readJson(join(payload, 'manifests/javascript-binary-dependencies.json'))
      .dependencies.map((item) => item.id).sort()
    assert(packagedDependencies.length === 144, 'packaged app.asar must contain 144 package instances')
    assert(JSON.stringify(packagedDependencies) === JSON.stringify(expectedDependencies), 'packaged app.asar dependency graph differs from the legal manifest')
  }
  const javascriptManifest = readJson(join(payload, 'manifests/javascript-binary-dependencies.json'))
  verifyPackagedDependencyLegalFiles(payload, javascriptManifest)
  const rustManifest = readJson(join(payload, 'manifests/rust-release-dependencies.json'))
  verifyPackagedDependencyLegalFiles(payload, rustManifest)
  validateOptionExtCompliance(payload, {
    rustManifest,
    provenance: readFileSync(join(payload, 'provenance/option-ext-0.2.0.md'), 'utf8'),
    thirdPartyNotice: readFileSync(join(payload, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    sourceReadme: readFileSync(join(payload, 'rust/sources/README.md'), 'utf8'),
    archivePath: join(payload, 'rust/sources/option-ext-0.2.0.crate'),
    licensePath: join(payload, 'rust/licenses/option-ext@0.2.0/LICENSE.txt'),
    requireTracked: false
  })
  if (enforceReleaseGate) assert(rustManifest.option_ext_review_status === OPTION_EXT_STATUS, 'binary release blocked by option-ext compliance status')
  return { legal_path: payload, files: manifest.files.length, integrity: 'PASS' }
}
