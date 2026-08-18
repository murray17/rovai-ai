import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdapterPermissionConfig } from '@contracts'
import {
  DEFAULT_ONBOARDING_SNAPSHOT,
  OnboardingStore,
  parseOnboardingSnapshot,
  readOnboardingSnapshot
} from './onboarding-preferences'

const cleanup: string[] = []
const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-onboarding-'))
  cleanup.push(directory)
  return join(directory, 'onboarding.json')
}

describe('onboarding preferences', () => {
  it('starts uninitialized when the file is missing or malformed', async () => {
    const filePath = await temporaryFile()
    expect(await readOnboardingSnapshot(filePath)).toEqual(DEFAULT_ONBOARDING_SNAPSHOT)
    await writeFile(filePath, '{broken')
    expect(await readOnboardingSnapshot(filePath)).toEqual(DEFAULT_ONBOARDING_SNAPSHOT)
  })

  it('skips onboarding for an installation that already has product data', async () => {
    const filePath = await temporaryFile()
    const store = await OnboardingStore.load(filePath)
    const completed = await store.initialize(true)
    expect(completed).toMatchObject({
      schemaVersion: 1,
      status: 'completed',
      origin: 'existing_installation',
      selectedMemberRole: null,
      memberAgentId: null,
      quickChatCampId: null
    })
    expect(await store.initialize(false)).toEqual(completed)
  })

  it('persists every required page and restores the Runtime draft', async () => {
    const filePath = await temporaryFile()
    const store = await OnboardingStore.load(filePath)
    await store.initialize(false)
    await store.completeWelcome()
    await store.selectMember('luoke')
    await store.completeMemberSelection()
    await store.setRuntimeSelection({
      adapterKind: 'codex-cli',
      model: {
        mode: 'explicit',
        modelId: 'gpt-test',
        options: { reasoning_effort: 'medium' }
      }
    })

    const restored = await OnboardingStore.load(filePath)
    expect(restored.get()).toEqual(store.get())
    expect(restored.get()).toMatchObject({
      status: 'in_progress',
      step: 'runtime',
      selectedMemberRole: 'luoke',
      runtimeSelection: {
        adapterKind: 'codex-cli',
        model: {
          mode: 'explicit',
          modelId: 'gpt-test',
          options: { reasoning_effort: 'medium' }
        }
      }
    })
  })

  it('keeps earlier choices when Back returns through the mandatory pages', async () => {
    const filePath = await temporaryFile()
    const store = await OnboardingStore.load(filePath)
    await store.initialize(false)
    await store.completeWelcome()
    await store.selectMember('qilu')
    await store.completeMemberSelection()
    await store.setRuntimeSelection({
      adapterKind: 'codex-cli',
      model: {
        mode: 'explicit',
        modelId: 'gpt-test',
        options: { reasoning_effort: 'medium', ignored: undefined }
      }
    })

    await store.showMemberSelection()
    const welcome = await store.showWelcome()
    expect(welcome).toMatchObject({
      status: 'in_progress',
      step: 'welcome',
      selectedMemberRole: 'qilu',
      runtimeSelection: {
        adapterKind: 'codex-cli',
        model: {
          mode: 'explicit',
          modelId: 'gpt-test',
          options: { reasoning_effort: 'medium' }
        }
      }
    })
    const member = await store.completeWelcome()
    expect(member).toMatchObject({
      status: 'in_progress',
      step: 'member',
      selectedMemberRole: 'qilu'
    })
  })

  it('checkpoints one idempotent provisioning operation before completion', async () => {
    const filePath = await temporaryFile()
    const store = await OnboardingStore.load(filePath)
    await store.initialize(false)
    await store.completeWelcome()
    await store.selectMember('mianzhi')
    await store.completeMemberSelection()
    const started = await store.beginProvisioning({
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' }
    }, codexPermissions())
    expect(started).toMatchObject({
      status: 'in_progress',
      step: 'runtime',
      provisioning: {
        runtimePermissions: codexPermissions(),
        memberAgentId: null,
        memberVersionBeforeRuntime: null,
        memberVersionAfterRuntime: null,
        quickChatCampId: null
      }
    })
    const replay = await store.beginProvisioning({
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' }
    }, codexPermissions())
    expect(replay).toEqual(started)

    await store.recordProvisionedMember('agent-1', 1)
    await store.recordProvisionedRuntime(2)
    await store.recordProvisionedCamp(CAMP_ID)
    const completed = await store.complete()
    expect(completed).toMatchObject({
      status: 'completed',
      origin: 'onboarding',
      selectedMemberRole: 'mianzhi',
      memberAgentId: 'agent-1',
      quickChatCampId: CAMP_ID
    })
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(completed)
  })

  it('rejects skipped pages, changed provisioning input, and incomplete completion', async () => {
    const filePath = await temporaryFile()
    const store = await OnboardingStore.load(filePath)
    await store.initialize(false)
    await expect(store.selectMember('qilu')).rejects.toThrow('不在队员选择页')
    await expect(store.completeMemberSelection()).rejects.toThrow('请先完成欢迎页')
    await store.completeWelcome()
    expect((await store.completeWelcome()).status).toBe('in_progress')
    await store.selectMember('qilu')
    await store.completeMemberSelection()
    expect((await store.completeMemberSelection()).status).toBe('in_progress')
    await expect(store.completeWelcome()).rejects.toThrow('已经完成')
    await store.beginProvisioning({
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' }
    }, codexPermissions())
    await expect(store.beginProvisioning({
      adapterKind: 'codex-cli',
      model: { mode: 'explicit', modelId: 'other', options: {} }
    }, codexPermissions())).rejects.toThrow('请重试当前配置')
    await expect(store.beginProvisioning({
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' }
    }, {
      ...codexPermissions(),
      schemaVersion: 8
    })).rejects.toThrow('请重试当前配置')
    await expect(store.showMemberSelection()).rejects.toThrow('不能返回')
    await expect(store.complete()).rejects.toThrow('尚未完成')
  })

  it('rejects loose or inconsistent persisted shapes', () => {
    expect(parseOnboardingSnapshot({
      schemaVersion: 1,
      status: 'uninitialized',
      extra: true
    })).toBeNull()
    expect(parseOnboardingSnapshot({
      schemaVersion: 1,
      status: 'in_progress',
      step: 'runtime',
      selectedMemberRole: null,
      runtimeSelection: null,
      provisioning: null
    })).toBeNull()
    expect(parseOnboardingSnapshot({
      schemaVersion: 1,
      status: 'completed',
      origin: 'onboarding',
      completedAt: 'not-a-date',
      selectedMemberRole: 'luoke',
      memberAgentId: 'agent-1',
      quickChatCampId: 'camp-1'
    })).toBeNull()
  })
})

function codexPermissions(): AdapterPermissionConfig {
  return {
    adapterKind: 'codex-cli',
    schemaVersion: 7,
    values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' }
  }
}
