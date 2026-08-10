import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { validateCatalogedV036Artifact } from './qualification-v036-schema-validation.mjs'

const SCHEMA_DIRECTORY = resolve(
  import.meta.dirname,
  '../../docs/versions/v0.34/schemas'
)
const CONTRACT_SCHEMA_DIRECTORY = resolve(
  import.meta.dirname,
  '../../docs/contracts/schemas'
)

let registry = null
let contractRegistry = null

export function validateQualificationSchemaCatalog() {
  return loadRegistry().catalog
}

export function validateQualificationArtifactSchema(schemaFile, artifact) {
  const loaded = loadRegistry()
  const schema = loaded.schemas.get(schemaFile)
  if (!schema) throw new Error(`Qualification schema is not cataloged: ${schemaFile}`)
  const validate = loaded.ajv.getSchema(schema.$id)
  if (!validate) throw new Error(`Qualification schema did not compile: ${schemaFile}`)
  if (!validate(artifact)) {
    throw new Error(
      `Qualification artifact violates ${schemaFile}: ${loaded.ajv.errorsText(validate.errors, { separator: '; ' })}`
    )
  }
  return artifact
}

export function validateQualificationContractSchemaCatalog() {
  return loadContractRegistry().catalog
}

export function validateQualificationContractArtifactSchema(schemaFile, artifact) {
  const loaded = loadContractRegistry()
  const schema = loaded.schemas.get(schemaFile)
  if (!schema) throw new Error(`Qualification contract schema is not cataloged: ${schemaFile}`)
  const validate = loaded.ajv.getSchema(schema.$id)
  if (!validate) throw new Error(`Qualification contract schema did not compile: ${schemaFile}`)
  if (!validate(artifact)) {
    throw new Error(
      `Qualification artifact violates ${schemaFile}: ${loaded.ajv.errorsText(validate.errors, { separator: '; ' })}`
    )
  }
  return artifact
}

export function validateCatalogedQualificationArtifact(artifact) {
  const loaded = loadRegistry()
  const contract = loadContractRegistry()
  const legacyMatches = [...loaded.schemas].filter(([, schema]) => (
    schema.properties?.schemaId?.const === artifact?.schemaId
      && schema.properties?.schemaVersion?.const === artifact?.schemaVersion
  ))
  const contractMatches = [...contract.schemas].filter(([, schema]) => (
    schema.properties?.schemaId?.const === artifact?.schemaId
      && schema.properties?.schemaVersion?.const === artifact?.schemaVersion
  ))
  if (legacyMatches.length + contractMatches.length !== 1) {
    if (legacyMatches.length + contractMatches.length === 0) {
      return validateCatalogedV036Artifact(artifact)
    }
    throw new Error(`Qualification artifact schema identity is duplicated: ${artifact?.schemaId ?? 'missing'}@${artifact?.schemaVersion ?? 'missing'}`)
  }
  return legacyMatches.length === 1
    ? validateQualificationArtifactSchema(legacyMatches[0][0], artifact)
    : validateQualificationContractArtifactSchema(contractMatches[0][0], artifact)
}

export function qualificationSchemaReference(schemaFile) {
  const loaded = loadRegistry()
  const entry = loaded.catalog.schemas.find((item) => item.file === schemaFile)
  if (!entry) throw new Error(`Qualification schema is not cataloged: ${schemaFile}`)
  return {
    artifactId: `json-schema:${schemaFile.replace(/\.schema\.json$/, '')}:${entry.schemaVersion}`,
    schemaId: 'rovai.qualification.json-schema',
    schemaVersion: entry.schemaVersion,
    payloadDigest: entry.digest
  }
}

function loadRegistry() {
  if (registry) return registry
  const catalogPath = join(SCHEMA_DIRECTORY, 'schema-catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const ajv = new Ajv2020({
    allErrors: true,
    strictSchema: true,
    strictTypes: false,
    strictRequired: false,
    strictTuples: false,
    validateSchema: true
  })
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value) => (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value))
    )
  })
  const schemas = new Map()
  const catalogFiles = new Set()
  for (const entry of catalog.schemas) {
    if (catalogFiles.has(entry.file)) {
      throw new Error(`Qualification schema catalog repeats ${entry.file}`)
    }
    catalogFiles.add(entry.file)
    const bytes = readFileSync(join(SCHEMA_DIRECTORY, entry.file))
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (digest !== entry.digest) {
      throw new Error(`Qualification schema digest mismatch: ${entry.file}`)
    }
    const schema = JSON.parse(bytes.toString('utf8'))
    if (schema.$id !== entry.schemaUri) {
      throw new Error(`Qualification schema URI mismatch: ${entry.file}`)
    }
    schemas.set(entry.file, schema)
  }
  for (const schema of schemas.values()) ajv.addSchema(schema)
  for (const [file, schema] of schemas) {
    if (!ajv.getSchema(schema.$id)) {
      throw new Error(`Qualification schema failed to compile: ${file}`)
    }
  }
  registry = { ajv, catalog, schemas }
  return registry
}

function loadContractRegistry() {
  if (contractRegistry) return contractRegistry
  const base = loadRegistry()
  const catalogPath = join(CONTRACT_SCHEMA_DIRECTORY, 'schema-catalog.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const schemas = new Map()
  const catalogFiles = new Set()
  for (const entry of catalog.schemas) {
    if (catalogFiles.has(entry.file)) {
      throw new Error(`Qualification contract schema catalog repeats ${entry.file}`)
    }
    catalogFiles.add(entry.file)
    const bytes = readFileSync(join(CONTRACT_SCHEMA_DIRECTORY, entry.file))
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (digest !== entry.digest) {
      throw new Error(`Qualification contract schema digest mismatch: ${entry.file}`)
    }
    const schema = JSON.parse(bytes.toString('utf8'))
    if (schema.$id !== entry.schemaUri) {
      throw new Error(`Qualification contract schema URI mismatch: ${entry.file}`)
    }
    schemas.set(entry.file, schema)
  }
  for (const schema of schemas.values()) base.ajv.addSchema(schema)
  for (const [file, schema] of schemas) {
    if (!base.ajv.getSchema(schema.$id)) {
      throw new Error(`Qualification contract schema failed to compile: ${file}`)
    }
  }
  contractRegistry = { ajv: base.ajv, catalog, schemas }
  return contractRegistry
}
