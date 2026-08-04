import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  verifyStoredCaseSeal,
  writePrivateJsonExclusive
} from './lib/qualification-common.mjs'
import { verifyQualificationEvidenceBundle } from './lib/qualification-bundle-verifier.mjs'
import { readV3SealedMaterialIndex } from './lib/qualification-case-v3.mjs'
import {
  appendDiagnosticPortfolioEvent,
  buildHardOutcomeFingerprint,
  completeVerifiedDiagnosticPortfolio,
  createDiagnosticPortfolioDefinition,
  loadDiagnosticPortfolioDefinition,
  rebuildDiagnosticPortfolioStatus,
  retainDiagnosticPortfolioDefinition,
  scanDiagnosticTrialNonLeakage,
  verifyDiagnosticTrialConfiguration,
  verifyVerifiedDiagnosticPortfolioCompletion
} from './lib/qualification-diagnostic-portfolio.mjs'

const options = parseArguments(process.argv.slice(2))
let output
switch (options.command) {
  case 'define': {
    const configuration = await readPrivateJson(options.config)
    const caseRecords = []
    for (const directory of configuration.caseDirectories ?? []) {
      caseRecords.push(await verifyStoredCaseSeal(resolve(directory)))
    }
    const definition = createDiagnosticPortfolioDefinition({
      caseRecords,
      teamMembers: configuration.teamMembers,
      executionFingerprints: configuration.executionFingerprints,
      producerCodeDigest: configuration.producerCodeDigest,
      portfolioId: configuration.portfolioId,
      portfolioVersion: configuration.portfolioVersion
    })
    await retainDiagnosticPortfolioDefinition(options.portfolio, definition)
    output = { ok: true, definition }
    break
  }
  case 'append': {
    output = await appendDiagnosticPortfolioEvent(options.portfolio, await readJson(options.event))
    break
  }
  case 'status': {
    output = await rebuildDiagnosticPortfolioStatus(options.portfolio)
    break
  }
  case 'fingerprint': {
    const { definition } = await loadDiagnosticPortfolioDefinition(options.portfolio)
    const result = await readJson(join(options.evidence, 'result.json'))
    const bundleVerification = await verifyQualificationEvidenceBundle(options.evidence)
    const fingerprint = buildHardOutcomeFingerprint({
      definition,
      slotId: options.slot,
      result,
      bundleVerification
    })
    await writePrivateJsonExclusive(
      join(options.evidence, `hard-outcome-fingerprint-${options.slot}.json`),
      fingerprint
    )
    output = { ok: true, fingerprint }
    break
  }
  case 'scan': {
    const { definition } = await loadDiagnosticPortfolioDefinition(options.portfolio)
    const caseRecord = await verifyStoredCaseSeal(options.case)
    const slot = definition.slots.find((candidate) => candidate.slotId === options.slot)
    if (!slot || slot.caseId !== caseRecord.contract.manifest.id
        || slot.caseSeal !== `sha256:${caseRecord.seal}`) {
      throw new Error('private Case resolution does not match the frozen Portfolio slot')
    }
    output = await scanDiagnosticTrialNonLeakage({
      definition,
      slotId: options.slot,
      attemptId: options.attempt,
      evidenceDirectory: options.evidence,
      sealedMaterialIndex: await readV3SealedMaterialIndex(caseRecord.contract)
    })
    break
  }
  case 'record': {
    const { definition } = await loadDiagnosticPortfolioDefinition(options.portfolio)
    const caseRecord = await verifyStoredCaseSeal(options.case)
    const slot = definition.slots.find((candidate) => candidate.slotId === options.slot)
    if (!slot || slot.caseId !== caseRecord.contract.manifest.id
        || slot.caseSeal !== `sha256:${caseRecord.seal}`) {
      throw new Error('private Case resolution does not match the frozen Portfolio slot')
    }
    const result = await readJson(join(options.evidence, 'result.json'))
    const environmentManifest = await readJson(join(options.evidence, 'environment-manifest.json'))
    try {
      await verifyDiagnosticTrialConfiguration({
        definition,
        slotId: options.slot,
        result,
        environmentManifest
      })
    } catch {
      const terminal = await appendDiagnosticPortfolioEvent(options.portfolio, {
        slotId: options.slot,
        attemptId: options.attempt,
        eventType: 'irrecoverable',
        payload: { reasonCode: 'portfolio.post_dispatch_configuration_drift' }
      })
      output = {
        ok: false,
        state: 'incomplete',
        reasonCode: 'portfolio.post_dispatch_configuration_drift',
        ledgerHeadDigest: terminal.event.eventDigest
      }
      break
    }
    const bundleVerification = await verifyQualificationEvidenceBundle(options.evidence, {
      deferSafeProjectionChecks: true
    })
    const fingerprint = buildHardOutcomeFingerprint({
      definition,
      slotId: options.slot,
      result,
      bundleVerification
    })
    await writePrivateJsonExclusive(
      join(options.evidence, `hard-outcome-fingerprint-${options.slot}.json`),
      fingerprint
    )
    const report = await scanDiagnosticTrialNonLeakage({
      definition,
      slotId: options.slot,
      attemptId: options.attempt,
      evidenceDirectory: options.evidence,
      sealedMaterialIndex: await readV3SealedMaterialIndex(caseRecord.contract)
    })
    const evidencePayload = {
      trialId: result.trialId,
      evidenceBundleDigest: bundleVerification.manifestDigest,
      hardOutcomeFingerprintDigest: fingerprint.fingerprintDigest,
      canonicalPayloadDigest: fingerprint.canonicalPayloadDigest,
      hardOutcome: result.overall
    }
    await appendDiagnosticPortfolioEvent(options.portfolio, {
      slotId: options.slot,
      attemptId: options.attempt,
      eventType: 'evidence_verified',
      payload: evidencePayload
    })
    if (report.outcome === 'leak_detected') {
      const ledger = await appendDiagnosticPortfolioEvent(options.portfolio, {
        slotId: options.slot,
        attemptId: options.attempt,
        eventType: 'non_leakage_failed',
        payload: {
          nonLeakageReportDigest: report.payloadDigest,
          reasonCode: 'non_leakage.sealed_or_private_material_detected'
        }
      })
      output = {
        ok: false,
        state: 'incomplete',
        fingerprintDigest: fingerprint.fingerprintDigest,
        nonLeakageReportDigest: report.payloadDigest,
        ledgerHeadDigest: ledger.event.eventDigest
      }
      break
    }
    await appendDiagnosticPortfolioEvent(options.portfolio, {
      slotId: options.slot,
      attemptId: options.attempt,
      eventType: 'non_leakage_passed',
      payload: { nonLeakageReportDigest: report.payloadDigest }
    })
    const terminal = await appendDiagnosticPortfolioEvent(options.portfolio, {
      slotId: options.slot,
      attemptId: options.attempt,
      eventType: 'valid_complete',
      payload: { ...evidencePayload, nonLeakageReportDigest: report.payloadDigest }
    })
    output = {
      ok: true,
      state: 'valid_complete',
      hardOutcome: result.overall,
      fingerprintDigest: fingerprint.fingerprintDigest,
      nonLeakageReportDigest: report.payloadDigest,
      ledgerHeadDigest: terminal.event.eventDigest
    }
    break
  }
  case 'complete': {
    output = await completeVerifiedDiagnosticPortfolio(
      options.portfolio,
      await readPrivateJson(options.evidenceMap)
    )
    break
  }
  case 'verify': {
    output = await verifyVerifiedDiagnosticPortfolioCompletion(
      options.portfolio,
      await readPrivateJson(options.evidenceMap)
    )
    break
  }
  default:
    usage()
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)

function parseArguments(args) {
  const command = args.shift()
  if (!['define', 'append', 'status', 'fingerprint', 'scan', 'record', 'complete', 'verify'].includes(command)) usage()
  const values = { command }
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (!['portfolio', 'config', 'event', 'slot', 'attempt', 'evidence', 'case', 'evidence-map'].includes(key)) usage()
    const value = args.shift()
    if (!value) usage()
    values[key] = ['portfolio', 'config', 'event', 'evidence', 'case', 'evidence-map'].includes(key)
      ? resolve(value)
      : value
  }
  if (!values.portfolio) usage()
  if (command === 'define' && !values.config) usage()
  if (command === 'append' && !values.event) usage()
  if (command === 'fingerprint' && (!values.slot || !values.evidence)) usage()
  if (command === 'scan' && (!values.slot || !values.attempt || !values.evidence || !values.case)) usage()
  if (command === 'record' && (!values.slot || !values.attempt || !values.evidence || !values.case)) usage()
  if (['complete', 'verify'].includes(command) && !values['evidence-map']) usage()
  values.evidenceMap = values['evidence-map']
  return values
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readPrivateJson(path) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error('Diagnostic Portfolio private operator input must be a regular 0600 file')
  }
  return readJson(path)
}

function usage() {
  console.error([
    'Usage:',
    '  node scripts/qualification-diagnostic-portfolio.mjs define --portfolio <dir> --config <private-json>',
    '  node scripts/qualification-diagnostic-portfolio.mjs append --portfolio <dir> --event <json>',
    '  node scripts/qualification-diagnostic-portfolio.mjs status --portfolio <dir>',
    '  node scripts/qualification-diagnostic-portfolio.mjs fingerprint --portfolio <dir> --slot <id> --evidence <trial-dir>',
    '  node scripts/qualification-diagnostic-portfolio.mjs scan --portfolio <dir> --slot <id> --attempt <id> --evidence <trial-dir> --case <private-case-dir>',
    '  node scripts/qualification-diagnostic-portfolio.mjs record --portfolio <dir> --slot <id> --attempt <id> --evidence <trial-dir> --case <private-case-dir>',
    '  node scripts/qualification-diagnostic-portfolio.mjs complete --portfolio <dir> --evidence-map <private-json>',
    '  node scripts/qualification-diagnostic-portfolio.mjs verify --portfolio <dir> --evidence-map <private-json>'
  ].join('\n'))
  process.exit(2)
}
