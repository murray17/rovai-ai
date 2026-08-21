import { generateLegalManifests } from './lib/legal-common.mjs'

const result = generateLegalManifests(process.cwd())
console.log(`Generated legal manifests: ${result.artwork.assets.length} tracked artwork files, ${result.javascript.sourceManifest.package_instances} JavaScript source instances, ${result.javascript.binaryManifest.package_instances} bundled JavaScript instances, ${result.rust.third_party_crate_count} Rust release crates.`)
