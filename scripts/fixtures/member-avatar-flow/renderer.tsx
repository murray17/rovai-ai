import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemberAvatarEditor } from '../../../apps/desktop/src/renderer/src/MemberAvatarEditor'
import { MemberAvatar } from '../../../apps/desktop/src/renderer/src/MemberAvatar'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { browserMemberAvatars } from '../../../apps/web/src/member-avatars'
import { initializeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'

declare global {
  interface Window {
    avatarFixture: {
      request(method: string, params: unknown): Promise<any>
    }
    showAvatarStress?(refs: string[]): void
  }
}

// The real browser upload adapter and editor talk to an isolated Core. Chromium
// supplies the deterministic file selection from the acceptance harness.
const memberAvatars = browserMemberAvatars({
  avatar: (operation: string, params: unknown) => window.avatarFixture.request(`memberAvatars.${operation}`, params)
} as Parameters<typeof browserMemberAvatars>[0])
const client = { memberAvatars } as ThreadClient

function Fixture(): React.JSX.Element {
  const [value, setValue] = useState<string | null>(() => localStorage.getItem('avatar'))
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(!value)
  const [stress, setStress] = useState<string[]>([])
  useEffect(() => { window.showAvatarStress = setStress; return () => { delete window.showAvatarStress } }, [])
  return <ThreadClientProvider client={client}>
    <main style={{ width: 'min(640px, 100%)', margin: '16px auto' }}>
      <button ref={trigger} data-reopen onClick={() => setOpen(true)}>更换头像</button>
      <output data-avatar-ref>{value}</output>
      <MemberAvatar agentId="fixture" avatarRef={value} displayName="Fixture" size="picker" />
      <div data-stress style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {stress.map((ref, index) => <MemberAvatar key={ref} agentId={`stress-${index}`} avatarRef={ref} displayName={`Stress ${index}`} size="profile" />)}
      </div>
      <MemberAvatarEditor returnFocusRef={trigger} value={value} open={open} disabled={false} onPendingChange={() => {}}
        onChange={next => { setValue(next); if (next) localStorage.setItem('avatar', next) }} onClose={() => setOpen(false)} />
    </main>
  </ThreadClientProvider>
}

initializeInterfaceLanguage({
  interfaceLanguage: 'zh-CN',
  interfaceLanguagePreference: 'zh-CN',
  systemLanguage: 'zh-CN',
  languageRevision: 0,
  readError: null
})
createRoot(document.getElementById('root')!).render(<Fixture />)
