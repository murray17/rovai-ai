import type { AppUpdateRelease } from '@contracts'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

/** Remove only a redundant first H1 from the display copy, never from release metadata. */
export function displayReleaseNotes(release: AppUpdateRelease): string | null {
  const source = release.releaseNotes
  if (!source) return null
  const first = unified().use(remarkParse).parse(source).children[0]
  if (first?.type !== 'heading' || first.depth !== 1 || !first.position) return source
  if (first.children.some((node) => node.type !== 'text' && node.type !== 'inlineCode')) return source

  const title = normalizedTitle(first.children.map((node) => 'value' in node ? node.value : '').join(''))
  const version = release.version.replace(/^v/iu, '')
  const equivalentTitles = [
    release.releaseName,
    `Rovai AI v${version}`,
    `Rovai AI ${version}`,
    `v${version}`,
    version
  ].filter((value): value is string => Boolean(value)).map(normalizedTitle)
  if (!equivalentTitles.includes(title)) return source

  return source.slice(first.position.end.offset).replace(/^(?:\r?\n)+/u, '')
}
