import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_CURRENT_USER_PROFILE, type CurrentUserProfile, type CurrentUserProfileApi } from '@contracts'
import './current-user-profile.css'
import { readErrorMessage } from './error-message'

type ProfileState = {
  profile: CurrentUserProfile
  ready: boolean
  error: string | null
  reload(): void
  save(profile: CurrentUserProfile): Promise<CurrentUserProfile>
}

export const CurrentUserProfileContext = createContext<ProfileState>({
  profile: DEFAULT_CURRENT_USER_PROFILE,
  ready: false,
  error: null,
  reload: () => undefined,
  save: async () => { throw new Error('个人资料尚未加载。') }
})

export function CurrentUserProfileProvider({ children, api: providedApi }: { children: ReactNode; api?: CurrentUserProfileApi }): React.JSX.Element {
  const api = providedApi ?? (typeof window !== 'undefined' ? window.rovai?.currentUserProfile : undefined)
  if (!api) throw new Error('共享个人资料缺少显式适配。')
  const [profile, setProfile] = useState(DEFAULT_CURRENT_USER_PROFILE)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setReady(false)
    setError(null)
    if (!api) {
      setError('当前版本的个人资料服务不可用。')
      return
    }
    void api.get().then((next) => {
      if (!active) return
      setProfile(next)
      setReady(true)
    }).catch((failure) => {
      if (active) setError(readErrorMessage(failure))
    })
    return () => { active = false }
  }, [attempt, api])
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const save = useCallback(async (draft: CurrentUserProfile): Promise<CurrentUserProfile> => {
    const saved = await api.save(draft)
    setProfile(saved)
    return saved
  }, [api])
  const value = useMemo(() => ({ profile, ready, error, reload, save }), [profile, ready, error, reload, save])
  return <CurrentUserProfileContext.Provider value={value}>{children}</CurrentUserProfileContext.Provider>
}

export function useCurrentUserProfile(): ProfileState { return useContext(CurrentUserProfileContext) }

export function CurrentUserAvatar({
  profile, size = 32, className = 'profile-portrait'
}: { profile: CurrentUserProfile; size?: number; className?: string }): React.JSX.Element {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return <span className={className}
    style={className === 'profile-portrait' ? { width: size, height: size, fontSize: Math.round(size * 0.4) } : undefined}
    aria-hidden="true">
    {profile.avatarDataUrl && failedSource !== profile.avatarDataUrl
      ? <img src={profile.avatarDataUrl} alt="" onError={() => setFailedSource(profile.avatarDataUrl)} />
      : '你'}
  </span>
}
