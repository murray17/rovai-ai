// Experimental, source-pinned ACP launcher. Never patches an installed binary.
// Run with Bun 1.4.2 and the unmodified CLI sources at the pinned commit.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceRoot = process.env.CLINE_ACP_EXPERIMENT_SOURCE_ROOT ?? process.env.ROVAI_CLINE_SOURCE_ROOT
const variant = process.env.CLINE_ACP_EXPERIMENT_VARIANT ?? process.env.ROVAI_CLINE_SHIM_VARIANT
if (!sourceRoot || !isAbsolute(sourceRoot) || !['control', 'native-settings'].includes(variant)) {
  throw new Error('Explicit source root and experimental shim variant are required')
}
const cliRoot = join(sourceRoot, 'apps/cli')
const cliPackage = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'))
const acpHash = createHash('sha256').update(readFileSync(join(cliRoot, 'src/acp/acpAgent.ts'))).digest('hex')
if (cliPackage.version !== '3.0.68' || acpHash !== '39f68873abc43f80a858dbdbdfb7b6d3f3d29fb7fdf96157d229c7a71084a165') {
  throw new Error('Only the audited Cline CLI 3.0.68 AcpAgent is accepted')
}
// These upstream packages expose ESM-only entry points. Resolve with the same
// Bun import conditions used to load the unmodified TypeScript ACP entry.
const coreEntry = Bun.resolveSync('@cline/core', cliRoot)
const corePackage = JSON.parse(readFileSync(join(dirname(coreEntry), '../package.json'), 'utf8'))
if (corePackage.version !== '0.0.90') throw new Error('Expected official @cline/core 0.0.90')
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  console.log('3.0.68 (Rovai experimental ACP shim v1; Core 0.0.90)')
  process.exit(0)
}

const { ClineCore, readGlobalSettings } = await import(pathToFileURL(coreEntry).href)
const { createProgram, commanderToParsedArgs } = await import(pathToFileURL(join(cliRoot, 'src/commands/program.ts')).href)
const { resolveStartupCompactionMode } = await import(pathToFileURL(join(cliRoot, 'src/utils/startup-settings.ts')).href)
const { buildCliCompactionConfig } = await import(pathToFileURL(join(cliRoot, 'src/utils/compaction-mode.ts')).href)
const program = createProgram()
program.parse(process.argv)
const args = commanderToParsedArgs(program)
if (!args.acpMode || args.invalidCompactionMode) throw new Error('Valid --acp invocation required')

// Interpose only at the public start boundary. Both source-control and shim use
// the same official ACP implementation and the same published Core module.
const originalStart = ClineCore.prototype.start
if (typeof originalStart !== 'function') throw new Error('ClineCore.start seam changed')
ClineCore.prototype.start = function (input) {
  if (input?.config?.extensionContext?.client?.name !== 'cline-acp') {
    throw new Error('Unexpected non-ACP session at experimental start boundary')
  }
  if (input.config.compaction !== undefined) throw new Error('Upstream now supplies compaction; retire this experiment')
  const compaction = buildCliCompactionConfig(resolveStartupCompactionMode(args, readGlobalSettings()))
  const next = variant === 'native-settings'
    ? { ...input, config: { ...input.config, compaction } }
    : input
  const otherFieldsPreserved = Object.keys(input.config).every(key => Object.is(input.config[key], next.config[key]))
  if (!otherFieldsPreserved) throw new Error('Experimental shim changed another config field')
  const configLog = process.env.CLINE_ACP_EXPERIMENT_CONFIG_LOG ?? process.env.ROVAI_CLINE_SHIM_CONFIG_LOG
  if (configLog) {
    appendFileSync(configLog, JSON.stringify({
      kind: 'experimental_config_witness', variant, upstreamCli: '3.0.68', core: '0.0.90',
      sessionId: input.config.sessionId, compaction: next.config.compaction ?? null,
      resolvedNativePreference: compaction, otherFieldsPreserved,
      observedAt: new Date().toISOString(),
    }) + '\n', { mode: 0o600 })
  }
  return originalStart.call(this, next)
}

const { runAcpMode } = await import(pathToFileURL(join(cliRoot, 'src/acp/index.ts')).href)
const { disposeAll } = await import(pathToFileURL(Bun.resolveSync('@cline/shared', cliRoot)).href)
try {
  await runAcpMode({ autoApproveTools: args.autoApproveOverride === true })
} finally {
  await disposeAll()
}
process.exit(0)
