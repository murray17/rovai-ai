import {
  hasReleaseNotesContent,
  parseReleaseNotesLanguages
} from '../../apps/desktop/src/shared/release-notes-localization.ts'
import { validateReleaseNotesSource } from './release-notes.mjs'

/** 新发布源必须同时提供中英文；历史说明的读取规则不受影响。 */
export function validateBilingualReleaseNotesSource(releaseNotes, version) {
  validateReleaseNotesSource(releaseNotes, version)
  const parsed = parseReleaseNotesLanguages(releaseNotes)
  if (!parsed) throw new Error('release notes must contain unambiguous standalone language markers')
  for (const language of ['en', 'zh-cn']) {
    const section = parsed.sections.find((section) => section.language === language)
    if (!section || !hasReleaseNotesContent(section.content, parsed.definitions)) {
      throw new Error(`release notes must include non-empty ${language} content`)
    }
  }
  return releaseNotes
}
