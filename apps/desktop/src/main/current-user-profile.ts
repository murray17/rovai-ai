import { readFile } from 'node:fs/promises'
import {
  DEFAULT_CURRENT_USER_PROFILE,
  MEMBER_AVATAR_LIMITS,
  currentUserNameError,
  type CurrentUserProfile,
  type StructuredError
} from '@contracts'
import { writePrivateJson } from './general-preferences'
import { inspectPng } from './member-avatar-assets'

const PNG_PREFIX = 'data:image/png;base64,'

export function parseCurrentUserProfile(input: unknown): CurrentUserProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('个人资料格式无效。')
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 2 || typeof value.displayName !== 'string'
    || !(value.avatarDataUrl === null || typeof value.avatarDataUrl === 'string')) {
    throw new Error('个人资料格式无效。')
  }
  const nameError = currentUserNameError(value.displayName)
  if (nameError) throw new Error(nameError)
  if (typeof value.avatarDataUrl === 'string') {
    if (!value.avatarDataUrl.startsWith(PNG_PREFIX)
      || value.avatarDataUrl.length > PNG_PREFIX.length + Math.ceil(MEMBER_AVATAR_LIMITS.iconBytes / 3) * 4) {
      throw new Error('头像必须是有效的 PNG 小图。')
    }
    const base64 = value.avatarDataUrl.slice(PNG_PREFIX.length)
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.toString('base64') !== base64 || bytes.length > MEMBER_AVATAR_LIMITS.iconBytes) {
      throw new Error('头像数据无效。')
    }
    const { width, height } = inspectPng(bytes)
    if (width !== MEMBER_AVATAR_LIMITS.iconEdge || height !== MEMBER_AVATAR_LIMITS.iconEdge) {
      throw new Error('头像需要裁剪为 192×192 像素。')
    }
  }
  return { displayName: value.displayName.trim(), avatarDataUrl: value.avatarDataUrl }
}

/** One atomic local file owns both fields; Core never reads this store. */
export class CurrentUserProfileStore {
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly filePath: string,
    private profile: CurrentUserProfile,
    readonly loadDegradation: StructuredError | null
  ) {}

  static async load(filePath: string): Promise<CurrentUserProfileStore> {
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8'))
      if (!value || value.schemaVersion !== 1 || Object.keys(value).length !== 3) {
        throw new Error('Unsupported personal profile schema')
      }
      const { schemaVersion: _, ...profile } = value
      return new CurrentUserProfileStore(filePath, parseCurrentUserProfile(profile), null)
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      return new CurrentUserProfileStore(filePath, { ...DEFAULT_CURRENT_USER_PROFILE }, missing ? null : {
        code: 'current_user_profile_unreadable',
        message: '个人资料暂时无法读取，当前使用默认名称和头像；原文件未改动。',
        retryable: true,
        details: {}
      })
    }
  }

  get(): CurrentUserProfile { return { ...this.profile } }

  save(input: unknown): Promise<CurrentUserProfile> {
    const next = parseCurrentUserProfile(input)
    const operation = this.#writeTail.then(async () => {
      await writePrivateJson(this.filePath, { schemaVersion: 1, ...next })
      this.profile = next
      return this.get()
    })
    this.#writeTail = operation.then(() => undefined, () => undefined)
    return operation
  }
}
