import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Copy only authentication/provider settings into private native homes, never sessions, hooks or MCP. */
export async function isolatedFileReferenceRuntimeEnvironment(fixture) {
  const codex = join(fixture, 'native-codex'), claude = join(fixture, 'native-claude')
  await mkdir(codex, { mode:0o700 }); await mkdir(claude, { mode:0o700 })
  const sourceCodex = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  try { await cp(join(sourceCodex,'auth.json'), join(codex,'auth.json')) } catch(error) { if(error.code !== 'ENOENT') throw error }
  try {
    const input = await readFile(join(sourceCodex,'config.toml'),'utf8')
    const root = input.split(/^\s*\[/m)[0]
    const fields = root.split('\n').filter(line => /^\s*(model|model_provider)\s*=/u.test(line))
    const providers = [...input.matchAll(/^\[model_providers\.[^\]\n]+\][\s\S]*?(?=^\[|$(?![\s\S]))/gm)].map(match=>match[0])
    await writeFile(join(codex,'config.toml'), [...fields,...providers].join('\n'), { mode:0o600 })
  } catch(error) { if(error.code !== 'ENOENT') throw error }
  const sourceClaude = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  try {
    const input = JSON.parse(await readFile(join(sourceClaude,'settings.json'),'utf8'))
    const env = Object.fromEntries(Object.entries(input.env ?? {}).filter(([name]) => /^(ANTHROPIC_|CLAUDE_CODE_(DISABLE_NONESSENTIAL_TRAFFIC|EFFORT_LEVEL|ATTRIBUTION_HEADER|SIMPLE)$|API_TIMEOUT_MS$)/u.test(name)))
    await writeFile(join(claude,'settings.json'), JSON.stringify({ env, ...(input.model ? { model:input.model } : {}) }), { mode:0o600 })
    try { await cp(join(sourceClaude,'.credentials.json'), join(claude,'.credentials.json')) } catch(error) { if(error.code !== 'ENOENT') throw error }
  } catch(error) { if(error.code !== 'ENOENT') throw error }
  return { env:{ ...process.env, CODEX_HOME:codex, CLAUDE_CONFIG_DIR:claude }, cleanup:async()=>{ await rm(codex,{recursive:true,force:true}); await rm(claude,{recursive:true,force:true}) } }
}

export async function configureFileReferenceRuntime(request, kind, agentId) {
  const check = await request('runtime.product.check', { runtimeKind:kind })
  const installations = await request('runtime.installations.list')
  const installation = installations.find(item => item.adapterKind === kind && item.installationClass === 'managed_default' && item.authScope === 'default' && item.memberRuntimeDefaults)
  if (!installation) throw Error(`${kind}: no available managed installation (${check.status ?? 'unknown'})`)
  const profile = await request('members.get', { agentId })
  const configured = await request('members.runtime.set', { commandId:crypto.randomUUID(), command:{ agentId, expectedVersion:profile.version, adapterKind:kind,
    model:installation.memberRuntimeDefaults.model, permissions:installation.memberRuntimeDefaults.permissions } })
  if (configured.status === 'rejected') throw Error(`${kind}: ${configured.code}`)
  const updated = await request('members.get', { agentId })
  if (!['ready','light_ready','installed_unverified'].includes(updated.runtimeReadiness.status)) throw Error(`${kind}: ${updated.runtimeReadiness.status}`)
  return updated
}
