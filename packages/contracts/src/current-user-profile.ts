/** Desktop presentation only. Never part of AgentProfile or model context. */
export interface CurrentUserProfile {
  displayName: string
  avatarDataUrl: string | null
}

export interface CurrentUserProfileApi {
  get(): Promise<CurrentUserProfile>
  save(profile: CurrentUserProfile): Promise<CurrentUserProfile>
}

export const DEFAULT_CURRENT_USER_PROFILE: CurrentUserProfile = {
  displayName: '',
  avatarDataUrl: null
}

export const CURRENT_USER_NAME_LIMIT = 32

export function currentUserDisplayName(profile: Pick<CurrentUserProfile, 'displayName'>): string {
  return profile.displayName.trim() || '你'
}

export function currentUserNameError(value: string): string | null {
  if ([...value.trim()].length > CURRENT_USER_NAME_LIMIT) return '名称最多 32 个字符。'
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) return '名称不能包含换行或控制字符。'
  return null
}
