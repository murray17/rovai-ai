import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export const name = 'rovai-model-configuration'
export const inject = ['loader']
const MODEL_ENTRY = 'llm-pi-ai'
const MODEL_PLUGIN = '@deepseek-ai/dsh-llm-pi-ai'
const own = (value, key) => Object.hasOwn(value, key)
const record = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !own(value, '__jsExpr')
const clone = value => structuredClone(value)

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!record(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function configurationInputs(home) {
  return [...['settings.yaml', '.credentials.yaml', '.env', 'cordis.patch.yml',
    'profiles/acp/package.json', 'profiles/acp/cordis.patch.yml',
    'profiles/web/package.json', 'profiles/web/cordis.patch.yml'].map(name => join(home, name)), join(process.cwd(), '.env')].map(path => {
    try { return { path, digest: createHash('sha256').update(readFileSync(path)).digest('hex') } }
    catch (error) { return { path, digest: error.code === 'ENOENT' ? null : 'unreadable' } }
  })
}
function contains(actual, expected) {
  if (!record(expected)) return isDeepStrictEqual(actual, expected)
  return record(actual) && Object.entries(expected).every(([key, value]) => own(actual, key) && contains(actual[key], value))
}
function descriptor(settings, id = MODEL_ENTRY) {
  return settings?.describe?.().find(value => value.ns === id)
}

// Observe the native promise; never invoke migration, write a Profile, rename
// settings.yaml, or use settings.yaml.imported as an input. The native method
// catches section failures, so completion also checks each model-section write.
// Older Settings providers have no importer and incur no migration wait.
export function observeNativeImport(settings, profile, diagnostics) {
  const original = settings.importLegacyDocument
  if (typeof original !== 'function') return Promise.resolve()
  let resolve
  const completion = new Promise(done => { resolve = done })
  const update = settings.update
  settings.importLegacyDocument = async function (...args) {
    const modelWrites = []
    const trackedUpdate = async function (ns, patch, ...rest) {
      const tracked = ns === MODEL_ENTRY || ns === 'llm-deepseek'
      try {
        const result = await update.call(this, ns, patch, ...rest)
        if (tracked) modelWrites.push({ ns, expected: clone(patch) })
        return result
      } catch (error) {
        if (tracked) diagnostics.push({ code: 'native_model_import_failed' })
        throw error
      }
    }
    try {
      const legacy = join(profile.home, 'settings.yaml')
      if (existsSync(legacy)) {
        const bytes = readFileSync(legacy)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const root = join(profile.home, 'backups')
        mkdirSync(root, { recursive: true, mode: 0o700 })
        const backup = join(root, `rovai-settings-${hash}.yaml`)
        try { writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 }) }
        catch (error) {
          if (error.code !== 'EEXIST' || !lstatSync(backup).isFile()
            || !readFileSync(backup).equals(bytes)) throw new Error('native_configuration_backup_failed')
        }
      }
      settings.update = trackedUpdate
      await original.apply(this, args)
      for (const { ns, expected } of modelWrites) {
        if (!contains(descriptor(settings, ns)?.user, expected)) diagnostics.push({ code: 'native_model_import_incomplete' })
      }
    } catch {
      diagnostics.push({ code: 'native_initialization_failed' })
    } finally {
      if (settings.update === trackedUpdate) settings.update = update
      settings.importLegacyDocument = original
      resolve()
    }
  }
  return completion
}

function explicitProviders(patches) {
  const result = new Set()
  for (const patch of patches.flatMap(patch => patch.insert ?? [patch])) {
    if (patch.id !== MODEL_ENTRY || !record(patch.config?.providers)) continue
    for (const id of Object.keys(patch.config.providers)) result.add(id)
  }
  return result
}

function opaqueModelBlock(patches) {
  return patches.flatMap(patch => patch.insert ?? [patch]).some(patch => patch.id === MODEL_ENTRY && patch.config !== undefined
    && (!record(patch.config) || (patch.config.providers !== undefined && !record(patch.config.providers))))
}

// loadProfileDirectory also sanitizes/writes manifests. Inspection uses its
// native read/resolve/parse primitives, without opening or editing Web's Profile.
function inspectProfile(boot, dir, installAnchor) {
  const manifest = boot.readProfileManifest('dsh', dir)
  const exemptions = boot.readProfileVersionExemptions(dir)
  const layers = [], skippedBundles = []
  for (const packageName of manifest.dsh?.profile?.bundles ?? []) {
    try {
      const packageDir = boot.resolveBundleDir('dsh', packageName, installAnchor, dir)
      const manifest = boot.readProfileManifest('dsh', packageDir)
      const issue = boot.evaluatePluginCompatibility(manifest, exemptions)
      if (!manifest.dsh?.bundle || (issue && !issue.exempted)) throw new Error('bundle_unavailable')
      const paths = boot.bundlePatchPaths(packageDir, manifest.dsh.bundle)
      layers.push({ packageName, patches: paths.flatMap(path => boot.loadOverlayPatches('dsh', path)) })
    } catch { skippedBundles.push(packageName) }
  }
  return { layers, skippedBundles, patches: boot.loadOptionalPatches('dsh', join(dir, 'cordis.patch.yml')) ?? [] }
}

// One Provider is the conflict boundary. Native expressions are retained for
// Loader to evaluate. No credentials are resolved or included in diagnostics.
export function prepareModels(native, web, explicit, diagnostics, builtin = new Set()) {
  if (!record(native) || !record(native.providers ?? {})) {
    diagnostics.push({ code: 'native_model_configuration_opaque' })
    return { config: native, webProviders: [], rejectedProviders: [] }
  }
  const providers = clone(native.providers ?? {})
  const webProviders = []
  const rejectedProviders = []
  if (web !== undefined && !record(web)) diagnostics.push({ code: 'web_model_configuration_opaque' })
  for (const [id, source] of Object.entries(record(web) ? web : {})) {
    if (own(providers, id) && explicit.has(id)) {
      if (!isDeepStrictEqual(providers[id], source)) diagnostics.push({ code: 'native_provider_preferred', provider: id })
      continue
    }
    if (own(providers, id) && (!builtin.has(id) || !record(providers[id]))) {
      diagnostics.push({ code: 'native_provider_source_unknown', provider: id })
      continue
    }
    if (!record(source)) {
      diagnostics.push({ code: 'web_provider_configuration_opaque', provider: id })
      rejectedProviders.push(id)
      continue
    }
    if (isDeepStrictEqual(providers[id], source)) continue
    providers[id] = clone(source)
    webProviders.push(id)
  }
  return { config: { ...clone(native), providers }, webProviders, rejectedProviders }
}

// This is the existing Responses compatibility default, scoped to the same
// protocol. Explicit Provider and Model overrides are left to native precedence.
export function withResponsesDefaults(config, effective = config) {
  if (!record(config) || !record(config.providers ?? {})) return config
  const result = clone(config)
  result.providers ??= {}
  for (const [id, source] of Object.entries(effective?.providers ?? {})) {
    if (!record(source) || source.api !== 'openai-responses'
      || own(source.compat ?? {}, 'supportsStrictMode')) continue
    const raw = result.providers[id] ?? {}
    if (!record(raw) || (raw.compat !== undefined && !record(raw.compat))) continue
    result.providers[id] = { ...raw, compat: { ...raw.compat, supportsStrictMode: true } }
  }
  return result
}

async function prepare(ctx, settings, profile, diagnostics) {
  const entries = [...ctx.loader.entries()].filter(entry => entry.options.id === MODEL_ENTRY)
  const entry = entries.length === 1 ? entries[0] : undefined
  if (!entry || entry.disabled || entry.options.name !== MODEL_PLUGIN || !entry.fiber) {
    diagnostics.push({ code: 'native_model_entry_unavailable' })
    return { webProviders: [], rejectedProviders: [] }
  }
  const original = clone(entry.options.config ?? {})
  const effective = descriptor(settings)?.value ?? original
  const baseline = withResponsesDefaults(original, effective)
  let prepared = { config: baseline, webProviders: [], rejectedProviders: [] }
  let webUnavailable = false
  let inspectingWeb = false
  try {
    // Earlier Settings providers already load shared settings themselves. The
    // newer profile inspection capability is optional, including for compat.
    if (!profile || diagnostics.some(value => value.code.startsWith('native_'))) throw new Error('profile_inspection_unavailable')
    const boot = await ctx.loader.import('@deepseek-ai/dsh-app-boot')
    const nativeProfile = inspectProfile(boot, profile.dir, profile.installAnchor)
    const home = boot.loadOptionalPatches('dsh', join(profile.home, 'cordis.patch.yml')) ?? []
    const nativePatches = [
      ...nativeProfile.layers.filter(layer => !['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'].includes(layer.packageName)).flatMap(layer => layer.patches),
      ...nativeProfile.patches, ...home, ...profile.overlays,
    ]
    if (opaqueModelBlock(nativePatches)) {
      diagnostics.push({ code: 'native_model_configuration_opaque' })
      throw new Error('native_model_configuration_opaque')
    }
    const explicit = explicitProviders(nativePatches)
    const builtin = explicitProviders(nativeProfile.layers.filter(layer =>
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'].includes(layer.packageName)).flatMap(layer => layer.patches))
    for (const id of Object.keys(descriptor(settings)?.user?.providers ?? {})) explicit.add(id)
    // Shared settings are still applied by old native plugins, above composition.
    // Represent these routes only for conflict decisions, never replace that layer.
    const nativeRoutes = { ...original.providers }
    for (const [id, source] of Object.entries(effective?.providers ?? {})) {
      if (explicit.has(id) && !own(nativeRoutes, id)) nativeRoutes[id] = source
    }
    const webDir = join(profile.home, 'profiles', 'web')
    if (existsSync(join(webDir, 'package.json'))) {
      inspectingWeb = true
      const bundles = boot.readProfileManifest('dsh', webDir).dsh?.profile?.bundles ?? []
      if (bundles.some(name => !['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].includes(name))) {
        // Custom bundles can introduce arbitrary model dependencies. Keep this
        // first adapter bounded to the standard Web Profile, rather than add a
        // second module resolver or a persistent dependency/source registry.
        diagnostics.push({ code: 'web_plugin_configuration_unavailable' })
        throw new Error('web_custom_bundle_unsupported')
      }
      const webProfile = inspectProfile(boot, webDir, profile.installAnchor)
      const webRows = boot.composeEntries([...webProfile.layers.map(layer => layer.patches), webProfile.patches, home])
      const webEntries = webRows.filter(row => row.id === MODEL_ENTRY)
      const row = webEntries.length === 1 ? webEntries[0] : undefined
      const declared = explicitProviders([
        ...webProfile.layers.filter(layer => !['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].includes(layer.packageName)).flatMap(layer => layer.patches),
        ...webProfile.patches,
      ])
      if (row && !row.disabled && row.name === MODEL_PLUGIN && record(row.config?.providers)) {
        const web = Object.fromEntries(Object.entries(row.config.providers).filter(([id]) => declared.has(id)))
        prepared = prepareModels({ ...baseline, providers: nativeRoutes }, web, explicit, diagnostics, builtin)
        // A native user route remains exactly in its original composition layer.
        for (const id of explicit) {
          if (own(baseline.providers ?? {}, id)) prepared.config.providers[id] = clone(baseline.providers[id])
          else delete prepared.config.providers[id]
        }
        prepared.config = withResponsesDefaults(prepared.config)
      } else if (row?.config?.providers !== undefined && !record(row.config.providers)) {
        webUnavailable = true
        diagnostics.push({ code: 'web_model_configuration_opaque' })
      }
      if (webProfile.skippedBundles.length) {
        webUnavailable = true
        diagnostics.push({ code: 'web_plugin_configuration_unavailable' })
      }
    }
  } catch {
    if (profile) {
      webUnavailable = inspectingWeb
      diagnostics.push({ code: 'web_configuration_unavailable' })
    }
  }
  const apply = async config => {
    const { resolveConfig } = await ctx.loader.import('@deepseek-ai/cordis')
    resolveConfig(entry.fiber.runtime,
      entry.fiber.ctx.waterfall(entry.fiber, 'internal/config', config, () => config))
    await entry.update({ config })
    await entry.fiber?.await()
    if (entry.fiber?.state !== 2) throw new Error('model_configuration_rejected')
  }
  try {
    if (!isDeepStrictEqual(original, prepared.config)) await apply(prepared.config)
  } catch {
    // At most one rollback, retaining native compatibility and every unrelated
    // Host setting. No business input has been submitted at this point.
    prepared.rejectedProviders.push(...prepared.webProviders)
    prepared.webProviders = []
    prepared.config = baseline
    try {
      if (!isDeepStrictEqual(entry.options.config ?? {}, baseline)) await apply(baseline)
    } catch {
      // Validation can reject an optional capability before mutating the entry.
      // Only a proven unchanged, still-active native route is safe to retain.
      if (entry.fiber?.state !== 2 || !isDeepStrictEqual(entry.options.config ?? {}, original)) throw new Error('native_model_compatibility_failed')
      prepared.config = original
      diagnostics.push({ code: 'native_model_compatibility_unavailable' })
    }
    if (prepared.rejectedProviders.length) diagnostics.push({ code: 'web_supplement_rejected' })
  }
  return { webProviders: prepared.webProviders, rejectedProviders: prepared.rejectedProviders,
    webUnavailable, modelDigest: digest(prepared.config) }
}

export function apply(ctx, config) {
  const diagnostics = []
  let settings, profile, migration = Promise.resolve(), active = true
  ctx.effect(() => () => { active = false })
  ctx.inject(['settings'], child => {
    settings = child.settings
    profile = child.get('profileContext')
    if (profile) migration = observeNativeImport(settings, profile, diagnostics)
  })
  const publish = result => {
    if (!active) return
    const path = config.resultPath
    writeFileSync(`${path}.tmp`, JSON.stringify({ schemaVersion: 1, ...result, diagnostics }), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  // Do not hold a Loader lifecycle promise while its native Settings importer
  // waits for that same Loader. Core waits for this private result before ACP.
  ctx.loader.await().then(async () => {
    await migration
    if (!active) return
    if (!settings) {
      diagnostics.push({ code: 'native_model_preparation_unsupported' })
      publish({ status: 'native_only', webProviders: [], rejectedProviders: [] })
      return
    }
    if (profile && existsSync(join(profile.home, 'settings.yaml'))
      && typeof settings.importLegacyDocument !== 'function' && typeof settings.installSection !== 'function') {
      // Unknown newer initialization contract: do not risk feeding a temporary
      // model block into an importer whose completion we cannot observe.
      diagnostics.push({ code: 'native_migration_isolation_unavailable' })
      publish({ status: 'native_only', webProviders: [], rejectedProviders: [] })
      return
    }
    const home = profile?.home ?? ctx.get('dshHomePath')?.()
    const inputs = home ? configurationInputs(home) : []
    const prepared = await prepare(ctx, settings, profile, diagnostics)
    publish({ status: 'ready', ...prepared, inputs })
  }).catch(() => publish({ status: 'error', webProviders: [], rejectedProviders: [], error: 'model_configuration_preparation_failed' }))
}
