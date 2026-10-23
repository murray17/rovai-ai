import { describe, expect, it } from 'vitest'
import { memberSearchMatches } from './member-search'

describe('member search aliases', () => {
  it.each([
    ['爱丽丝', 'aili'],
    ['爱丽丝', 'ailisi'],
    ['爱丽丝', 'als'],
    ['爱丽丝', 'al'],
    ['爱丽丝', 'ail'],
    ['爱丽丝', 'AILI'],
    ['爱丽丝', 'ＡＩＬＩ'],
    ['爱丽丝', '爱li'],
    ['爱丽丝', 'ai丽'],
    ['爱丽丝', 'a丽s'],
    ['愛麗絲', 'aili'],
    ['吕布', 'lvbu'],
    ['吕布', 'LÜBU'],
    ['单田芳', 'shantian'],
    ['单田芳', 'dantian'],
    ['曾国藩', 'zengg'],
    ['曾国藩', 'cengg'],
    ['区楚良', 'ouchu'],
    ['重华', 'chonghua'],
    ['五号街卖花女', 'maihua'],
    ['爱丽丝', '爱丝'],
    ['Alice', 'ACE'],
    ['Ａlice', 'ali'],
    ['爱丽丝', '']
  ])('finds %s with %s', (value, query) => {
    expect(memberSearchMatches(value, query)).toBe(true)
  })

  it.each([
    ['爱丽丝', 'bob'],
    ['爱丽丝', 'alice'],
    ['爱丽丝', 'aisi'],
    ['爱丽丝', 'ili'],
    ['爱丽丝', 'ailisix'],
    ['', 'aili']
  ])('does not find %s with %s', (value, query) => {
    expect(memberSearchMatches(value, query)).toBe(false)
  })
})
