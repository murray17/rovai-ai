// Runs only in the native workflow's draft-release job, after every target passed.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [artifactsArgument, outputArgument] = process.argv.slice(2)
if (!artifactsArgument || !outputArgument || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) throw new Error('Expected artifact directory, output directory, and workflow source SHA')
const artifacts = resolve(artifactsArgument), output = resolve(outputArgument)
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const skillsRoot = join(import.meta.dirname, '../skills')
const requiredSkills = readdirSync(skillsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => existsSync(join(skillsRoot, name, 'SKILL.md')))
mkdirSync(output, { recursive: true })
const sums = []
for (const target of ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']) {
  const asset = `rovai-server-${version}-${target}.${target === 'windows-x64' ? 'zip' : 'tar.gz'}`
  const directories = readdirSync(artifacts).filter(name => name === `rovai-server-archive-${target}-${process.env.GITHUB_SHA}`)
  if (directories.length !== 1) throw new Error(`Missing native archive: ${target}`)
  const directory = join(artifacts, directories[0]), archive = join(directory, asset)
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (readFileSync(join(directory, 'SHA256SUMS'), 'utf8') !== `${digest}  ${asset}\n`) throw new Error(`Checksum mismatch: ${target}`)
  const manifest = JSON.parse(target === 'windows-x64'
    ? execFileSync('unzip', ['-p', archive, 'rovai-server/manifest.json'], { encoding: 'utf8' })
    : execFileSync('tar', ['-xzOf', archive, 'rovai-server/manifest.json'], { encoding: 'utf8' }))
  if (manifest.schemaVersion !== 1 || manifest.version !== version || manifest.commit !== process.env.GITHUB_SHA || manifest.dirty || manifest.profile !== 'release' || manifest.target !== target) throw new Error(`Package provenance mismatch: ${target}`)
  for (const name of requiredSkills) {
    const path = `skills/${name}/SKILL.md`
    const sourceDigest = createHash('sha256').update(readFileSync(join(skillsRoot, name, 'SKILL.md'))).digest('hex')
    if (manifest.files[path] !== sourceDigest) throw new Error(`Bundled Skill mismatch: ${target} ${name}`)
  }
  sums.push(`${digest}  ${asset}`)
  copyFileSync(archive, join(output, asset))
}
writeFileSync(join(output, 'SHA256SUMS'), sums.join('\n') + '\n')
writeFileSync(join(output, 'RELEASE-NOTES.md'), `Rovai Server ${version} native packages, built from ${process.env.GITHUB_SHA}.\n\nThis is a draft. Native build and bounded lifecycle checks do not certify clean-machine dependencies, Windows console shutdown, or every Agent runtime. Review platform evidence before publication. Publishing the draft does not change the official channel; channel promotion is reviewed separately.\n\nThe complete package includes the shared Rust Host and matching WebUI. Data remains in the selected --data-dir (default ~/.rovai-server); Desktop storage and installations are unchanged. Docker is outside this release.\n`)
console.log(`Prepared draft assets for server-v${version}`)
