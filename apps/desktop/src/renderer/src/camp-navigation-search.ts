import { isCampId, type NavigationCampTarget } from '@contracts'
import { formatCampTitle } from './camp-title'
import { uiAttribute } from './interface-language'

export function navigationCampSearch(
  query: string,
  camps: readonly NavigationCampTarget[],
  projectNameByPath: ReadonlyMap<string, string>
): { kind: 'id'; campId: string } | { kind: 'text'; camps: NavigationCampTarget[] } {
  const trimmed = query.trim()
  if (isCampId(trimmed)) return { kind: 'id', campId: trimmed }

  const text = query.trim().toLowerCase()
  return {
    kind: 'text',
    camps: (text ? camps.filter((camp) => {
      const projectName = camp.projectBindingKind === 'directory'
        ? projectNameByPath.get(camp.projectPath) ?? ''
        : uiAttribute('快速对话')
      return formatCampTitle(camp).toLowerCase().includes(text)
        || projectName.toLowerCase().includes(text)
    }) : camps).slice(0, 12)
  }
}

export interface NavigationCampLookup {
  campId: string
  camp: NavigationCampTarget | null
  error: string | null
}

export function startNavigationCampLookup(
  campId: string,
  publish: (result: NavigationCampLookup) => void,
  findCamp: (campId: string) => Promise<NavigationCampTarget | null> = (id) =>
    window.rovai.request('navigation.findCamp', { campId: id })
): () => void {
  let cancelled = false
  // A complete ID can still be edited quickly; only dispatch the settled input.
  const timer = setTimeout(() => {
    void findCamp(campId).then(
      (camp) => {
        if (!cancelled) publish({ campId, camp, error: null })
      },
      () => {
        if (!cancelled) publish({ campId, camp: null, error: '暂时无法查询会话，请重试。' })
      }
    )
  }, 150)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}
