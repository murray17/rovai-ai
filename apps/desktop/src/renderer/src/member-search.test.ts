import { describe, expect, it } from 'vitest'
import { memberSearchMatch, memberSearchMatches, type MemberSearchMatch } from './member-search'

describe('member name and role lookup', () => {
  it.each([
    ['爱丽丝', '爱丽'], ['爱丽丝', '爱丝'], ['Alice', 'ali'], ['Alice', 'ae'],
    ['爱丽丝', 'ailisi'], ['爱丽丝', 'aili'], ['爱丽丝', 'ail'],
    ['爱丽丝', 'als'], ['爱丽丝', 'al'], ['爱丽丝', 'lisi'],
    ['爱丽丝', '爱li'], ['爱丽丝', 'ai丽'],
    ['爱丽丝', 'AILI'], ['爱丽丝', 'ＡＩＬＩ'], ['愛麗絲', 'aili'],
    ['吕布', 'lvbu'], ['吕布', 'lübu'], ['吕布', 'LÜBU'],
    ['张三', 'zhs'], ['爱 丽丝', 'aili'], ['UI 设计师', 'uisj'],
    ['五号街卖花女', 'maihua'], ['五号街卖花女', 'mhn'],
    ['单田芳', 'shantianfang'], ['单田芳', 'dantianfang'],
    ['曾国藩', 'zengguofan'], ['曾国藩', 'cengguofan'],
    ['解缙', 'xiejin'], ['仇英', 'qiuying'], ['区楚良', 'ouchuliang'],
    ['爱丽丝', ''], ['', '']
  ])('matches %s using %s', (value, query) => {
    expect(memberSearchMatches(value, query)).toBe(true)
  })

  it.each([
    ['爱丽丝', 'alice'], ['爱丽丝', 'aisi'], ['爱丽丝', 'ili'],
    ['爱 丽丝', 'aisi'], ['爱·丽丝', 'aili'], ['UI 设计师', 'uiss'],
    ['Alice', 'ailisi'], ['', 'ai']
  ])('rejects %s using %s', (value, query) => {
    expect(memberSearchMatches(value, query)).toBe(false)
  })

  it.each<[string, string, MemberSearchMatch | null]>([
    ['PI', 'pi', 'exact'], ['Alice', 'ＡＬＩＣＥ', 'exact'],
    ['皮皮', 'pipi', 'exact'], ['皮皮', 'pp', 'exact'],
    ['爱 丽丝', 'ailisi', 'exact'], ['爱丽丝', 'als', 'exact'],
    ['单田芳', 'dantianfang', 'exact'], ['吕布', 'lvbu', 'exact'],
    ['皮皮', 'pi', 'prefix'], ['爱丽丝', 'aili', 'prefix'],
    ['爱丽丝', 'ailis', 'exact'], ['爱丽丝', 'ailisü', null],
    ['Alice', 'ali', 'prefix'], ['爱丽丝', 'lisi', 'fuzzy'],
    ['Alice', 'ae', 'fuzzy'], ['爱丽丝', '爱丝', 'fuzzy'],
    ['爱丽丝', 'aisi', null], ['爱丽丝', 'ili', null]
  ])('classifies %s using %s as %s', (value, query, expected) => {
    expect(memberSearchMatch(value, query)).toBe(expected)
    expect(memberSearchMatches(value, query)).toBe(expected !== null)
  })
})
