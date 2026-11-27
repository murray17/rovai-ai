import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdapterKind, NativeSkillScan, ToolboxSkillView } from '@contracts'
import { nativeSkillCatalogNotices } from './native-skill-diagnostics'
import type { ThreadClient } from './camp-client'
import type { ComposerSkillOption } from './composer-skill-picker'

export async function chatSkillOptions(client: ThreadClient, runtime: AdapterKind | null, refresh: boolean) {
  const [toolbox, native] = await Promise.allSettled([
    client.request<ToolboxSkillView[]>('toolbox.list'),
    runtime ? client.request<NativeSkillScan>('nativeSkills.list', { adapterKind: runtime, refresh }) : Promise.resolve({ skills: [], diagnostics: [] })
  ])
  const skills: ComposerSkillOption[] = []
  const errors: string[] = []
  if (toolbox.status === 'fulfilled') {
    for (const item of toolbox.value) {
      if (item.sourceError) { errors.push(item.sourceError); continue }
      skills.push({ id: 'rovai:' + item.name, name: item.name, description: item.description ?? '', origin: 'official', source: 'toolbox' })
    }
  } else errors.push(String(toolbox.reason))
  if (native.status === 'fulfilled') {
    for (const item of native.value.skills) {
      if (item.sourceScope === 'user' && item.adapterKind === runtime)
        skills.push({ ...item, origin: 'imported', source: 'native' })
    }
    errors.push(...nativeSkillCatalogNotices(native.value.diagnostics))
  } else errors.push(String(native.reason))
  return { skills, errors, status: toolbox.status === 'rejected' && native.status === 'rejected' ? 'error' as const : 'ready' as const }
}

export function useChatSkills(client: ThreadClient, agentId: string, runtime: AdapterKind | null) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof chatSkillOptions>> | null>(null)
  const generation = useRef(0)
  const requested = useRef(false)
  useEffect(() => {
    requested.current = false
    setCatalog(null)
    return () => { generation.current++ }
  }, [client, agentId, runtime])
  const load = useCallback((refresh = false) => {
    if (requested.current && !refresh) return
    requested.current = true
    const version = ++generation.current
    void chatSkillOptions(client, runtime, refresh).then(next => {
      if (generation.current === version) setCatalog(next)
    })
  }, [client, runtime])
  return { skills: catalog?.skills ?? [], skillCatalogStatus: catalog?.status ?? 'loading' as const,
    skillCatalogErrors: catalog?.errors ?? [], onNeedSkills: load, onRefreshSkills: () => load(true) }
}
