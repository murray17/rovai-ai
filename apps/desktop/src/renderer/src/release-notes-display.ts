import type { AppUpdateRelease, InterfaceLanguage } from '@contracts'
import { hasReleaseNotesContent, selectReleaseNotesLanguage } from '../../shared/release-notes-localization'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

function removeReleaseTitle(source: string, release: AppUpdateRelease): string {
  const first = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).parse(source).children
    .find((node) => node.type !== 'definition' && node.type !== 'footnoteDefinition')
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

  return source.slice(0, first.position.start.offset)
    + source.slice(first.position.end.offset).replace(/^(?:\r?\n)+/u, '')
}

/** 只选择标题清理后仍有正文的语言副本；不改写发布元数据。 */
export function displayReleaseNotes(release: AppUpdateRelease, language: InterfaceLanguage): string | null {
  if (!release.releaseNotes) return null
  const source = selectReleaseNotesLanguage(release.releaseNotes, language,
    (candidate) => hasReleaseNotesContent(removeReleaseTitle(candidate, release)))
  const displayed = removeReleaseTitle(source, release)
  return hasReleaseNotesContent(displayed) ? displayed : null
}
