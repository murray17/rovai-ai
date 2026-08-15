export async function configureProductRuntime(request, adapterKind, agentIds) {
  const allowsExecutionDeferredVerification = adapterKind === 'trae-cn-cli'
  for (const agentId of agentIds) {
    let resolved = null
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await request('runtime.product.check', { runtimeKind: adapterKind })
      const installation = (await request('runtime.installations.list')).find((candidate) =>
        candidate.adapterKind === adapterKind
          && candidate.installationClass === 'managed_default'
          && candidate.authScope === 'default'
          && candidate.memberRuntimeDefaults)
      if (!installation) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
        continue
      }
      const profile = await request('members.get', { agentId })
      const configured = await request('members.runtime.set', {
        commandId: crypto.randomUUID(),
        command: {
          agentId,
          expectedVersion: profile.version,
          adapterKind,
          model: installation.memberRuntimeDefaults.model,
          permissions: installation.memberRuntimeDefaults.permissions
        }
      })
      if (configured.status !== 'applied') {
        throw new Error(`Product Runtime was not selected: ${JSON.stringify({
          adapterKind,
          agentId,
          configured
        })}`)
      }
      resolved = await request('members.get', { agentId })
      if (resolved.runtimeConfiguration?.adapterKind === adapterKind
          && (resolved.runtimeReadiness?.status === 'ready'
            || (allowsExecutionDeferredVerification
              && resolved.runtimeReadiness?.status === 'installed_unverified'))) {
        break
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
    if (resolved?.runtimeConfiguration?.adapterKind !== adapterKind
        || (resolved?.runtimeReadiness?.status !== 'ready'
          && (!allowsExecutionDeferredVerification
            || resolved?.runtimeReadiness?.status !== 'installed_unverified'))) {
      throw new Error(`Product Runtime was not resolved: ${JSON.stringify({
        adapterKind,
        agentId,
        resolved
      })}`)
    }
  }

  const installation = (await request('runtime.installations.list')).find((candidate) =>
    candidate.adapterKind === adapterKind
      && candidate.installationClass === 'managed_default'
      && candidate.authScope === 'default'
  )
  if (installation?.snapshot?.probeStatus !== 'ready'
      && (!allowsExecutionDeferredVerification
        || installation?.snapshot?.probeStatus !== 'installed_unverified')) {
    throw new Error(`Managed Product Runtime is not ready: ${JSON.stringify({
      adapterKind,
      installation
    })}`)
  }
  return installation
}
