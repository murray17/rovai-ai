import { describe, expect, it } from 'vitest'
import { localizeExecutionEngineTerms } from './product-copy'

describe('execution engine product copy', () => {
  it('keeps internal Runtime and Adapter terms out of user-visible messages', () => {
    expect(localizeExecutionEngineTerms('Adapter Installation')).toBe('执行引擎')
    expect(localizeExecutionEngineTerms('Agent Runtime')).toBe('执行引擎')
    expect(localizeExecutionEngineTerms('Runtime Adapter')).toBe('执行引擎适配器')
    expect(localizeExecutionEngineTerms('Adapter diagnostic')).toBe('适配器 diagnostic')
  })
})
