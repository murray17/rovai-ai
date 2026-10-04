import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THREAD_SNAPSHOT_SCHEMA_VERSION } from './index'

describe('Thread snapshot wire version', () => {
  it('keeps the Renderer contract aligned with the Rust snapshot producer', () => {
    const producer = readFileSync(new URL('../../../crates/rovai-core/src/read_model.rs', import.meta.url), 'utf8')
    const version = producer.match(/pub const READ_MODEL_SCHEMA_VERSION:\s*i64\s*=\s*(\d+);/u)
    expect(version, 'Rust must expose its snapshot schema version').not.toBeNull()
    expect(THREAD_SNAPSHOT_SCHEMA_VERSION).toBe(Number(version![1]))
  })
})
