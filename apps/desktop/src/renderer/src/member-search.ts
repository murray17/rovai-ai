import { match } from 'pinyin-pro'
import { fuzzyContains } from './thread-reference'

/** Search aliases never replace a member's display name or stable identity. */
export function memberSearchMatches(value: string, query: string): boolean {
  if (fuzzyContains(value, query)) return true

  const text = value.normalize('NFKC').toLowerCase()
  const search = query.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\uFEFF]/gu, '')
  if (!/\p{Script=Han}/u.test(text) || !/[a-zü]/u.test(search)) return false

  // Match adjacent syllables, including initials and unfinished syllables, rather
  // than treating arbitrary letters inside a romanized name as a fuzzy match.
  return match(text, search, { precision: 'start', continuous: true, v: true }) !== null
}
