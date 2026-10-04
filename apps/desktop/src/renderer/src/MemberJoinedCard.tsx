import type { MemberCreationView } from '@contracts'
import { MemberPortrait } from './MemberPortrait'
import { UiText, uiAttribute } from './interface-language'

/** Uses only the receipt: opening a link delegates current state to the member page. */
export function MemberJoinedCard({ receipt, onConfigure }: {
  receipt: MemberCreationView
  onConfigure?(agentId: string): void
}): React.JSX.Element {
  return <article className="timeline-node member-joined-card" aria-label={uiAttribute('{0}已加入队伍', receipt.displayName)}>
    <div className="member-joined-body">
      <div className="member-joined-identity">
        <div className="member-joined-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg><UiText zh="新队员已入队" /></div>
        <h3>{receipt.displayName}</h3>
        {receipt.teamRole && <p className="member-joined-role">{receipt.teamRole}</p>}
        {receipt.professionalResponsibilities && <p className="member-joined-description">{receipt.professionalResponsibilities}</p>}
        {receipt.personalityTraits.length > 0 && <ul className="member-joined-traits" aria-label={uiAttribute('性格底色')}>
          {receipt.personalityTraits.map((trait, index) => <li key={index}>{trait}</li>)}
        </ul>}
      </div>
      <MemberPortrait agentId={receipt.agentId} avatarRef={receipt.avatarRef} displayName={receipt.displayName} decorative />
    </div>
    <footer>
      <span>{uiAttribute('由 {0} 创建', receipt.creatorDisplayName)} · <time dateTime={receipt.createdAt} title={new Date(receipt.createdAt).toLocaleString()}>{new Date(receipt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
      <button type="button" className="member-joined-configure" onClick={() => onConfigure?.(receipt.agentId)}>
        <UiText zh="配置智能体" /><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </footer>
  </article>
}
