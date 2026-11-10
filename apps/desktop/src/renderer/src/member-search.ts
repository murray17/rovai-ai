import { match } from 'pinyin-pro'
import { fuzzyContains } from './thread-reference'

export type MemberSearchMatch = 'exact' | 'prefix' | 'fuzzy'

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase()

function matchPinyin(text: string, input: string, precision: 'start' | 'every' | 'first' = 'start'): number[] | null {
  if (!/\p{Script=Han}/u.test(text) || !/[a-zü]/u.test(input)) return null
  return match(text, input, {
    precision,
    lastPrecision: precision,
    continuous: true,
    v: true,
    space: 'ignore'
  })
}

/** Pinyin expands member lookup only; query offsets and stored identities stay untouched. */
export function memberSearchMatches(value: string, query: string): boolean {
  return fuzzyContains(value, query) || matchPinyin(normalize(value), normalize(query)) !== null
}

/** A name's leading pinyin match outranks Runtime lookup; interior matches stay fuzzy. */
export function memberSearchMatch(value: string, query: string): MemberSearchMatch | null {
  const text = normalize(value).replace(/ /gu, '')
  const input = normalize(query).replace(/[\p{White_Space}\uFEFF]/gu, '')
  if (text === input) return 'exact'
  if (text.startsWith(input)) return 'prefix'
  const indices = matchPinyin(text, input)
  if (indices !== null) {
    if (indices[0] !== 0) return 'fuzzy'
    const coversName = (positions: number[] | null): boolean =>
      positions?.[0] === 0 && positions.at(-1) === text.length - 1
    if (coversName(indices) && (coversName(matchPinyin(text, input, 'every'))
      || coversName(matchPinyin(text, input, 'first')))) return 'exact'
    return 'prefix'
  }
  return fuzzyContains(value, query) ? 'fuzzy' : null
}
