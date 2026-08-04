import { resolve } from 'node:path'
import {
  invalidateQualificationEvaluation,
  recoverQualificationEvaluation
} from './lib/qualification-recovery.mjs'

const options = parseArguments(process.argv.slice(2))

try {
  const evaluated = options.action === 'invalidate'
    ? await invalidateQualificationEvaluation(options.input)
    : await recoverQualificationEvaluation(options.input)
  console.log(JSON.stringify(evaluated.redactedSummary, null, 2))
  if (evaluated.redactedSummary.overall === 'unavailable') process.exitCode = 2
  else if (evaluated.redactedSummary.overall === 'fail') process.exitCode = 1
} catch (error) {
  console.error(error?.code ?? error?.name ?? 'qualification_evaluation_recovery_failed')
  process.exitCode = 2
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (!['evidence', 'case', 'expected-seal', 'mark-irrecoverable'].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!values.evidence) usage()
  if (values['mark-irrecoverable']) {
    if (values.case || values['expected-seal']) usage()
    return {
      action: 'invalidate',
      input: {
        evidenceDirectory: resolve(values.evidence),
        reasonCode: values['mark-irrecoverable']
      }
    }
  }
  if (!values.case) usage()
  return {
    action: 'recover',
    input: {
      evidenceDirectory: resolve(values.evidence),
      caseDirectory: resolve(values.case),
      expectedSeal: values['expected-seal'] ?? null
    }
  }
}

function usage() {
  console.error([
    'Usage:',
    '  node scripts/qualification-evaluate.mjs --evidence <trial-directory> --case <sealed-case-directory> [--expected-seal <sha256>]',
    '  node scripts/qualification-evaluate.mjs --evidence <trial-directory> --mark-irrecoverable <reason-code>'
  ].join('\n'))
  process.exit(2)
}
