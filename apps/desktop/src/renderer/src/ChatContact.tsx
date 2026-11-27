import { createContext, useContext } from 'react'
import { NavigationIcon } from './NavigationIcon'
import { uiAttribute } from './interface-language'

type SourceThread = { threadId: string; title: string }
export const ChatContact = createContext<((agentId: string, source?: SourceThread) => Promise<void>) | null>(null)

export function ChatContactButton({agentId, source, className, onOpened}: {
  agentId: string; source?: SourceThread; className: string; onOpened?(): void
}) {
  const open = useContext(ChatContact)
  return open && <button type="button" className={className} title={uiAttribute('发消息')} aria-label={uiAttribute('发消息')}
    onClick={() => { void open(agentId,source).then(onOpened).catch(() => undefined) }}><NavigationIcon name="chats"/></button>
}
