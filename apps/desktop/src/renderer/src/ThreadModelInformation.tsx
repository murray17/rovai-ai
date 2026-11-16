import * as Popover from '@radix-ui/react-popover'
import type { AdapterInstallation, AgentProfile, AgentRunView, ThreadMessageView } from '@contracts'
import { MemberAvatar, type MemberAvatarProps } from './MemberAvatar'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { UiText, uiAttribute } from './interface-language'
import {
  memberRuntimeConfigurationPresentation, messageRuntimeModelPresentation, modelSummary,
  runtimeAdapterLabel, type MemberRuntimeConfigurationPresentation
} from './runtime-model-presentation'
import './thread-model-information.css'

type Presentation = Pick<MemberRuntimeConfigurationPresentation, 'model' | 'effort'>
type Identity = Pick<MemberAvatarProps, 'agentId' | 'displayName' | 'avatarRef'>

export function ModelSummaryText({ presentation }: { presentation: Presentation }): React.JSX.Element {
  return <span className="thread-model-summary-copy">
    <span className="thread-model-name">{presentation.model}</span>
    {presentation.effort && <span className="thread-model-effort"> · {presentation.effort.value}</span>}
  </span>
}

function ModelFields({ presentation, adapterKind }: { presentation: Presentation; adapterKind?: string }): React.JSX.Element {
  return <dl className="thread-model-fields">
    {adapterKind && <div><dt><UiText zh="智能体" /></dt><dd>{runtimeAdapterLabel(adapterKind)}</dd></div>}
    <div><dt><UiText zh="模型" /></dt><dd>{presentation.model}</dd></div>
    {presentation.effort && <div><dt>{presentation.effort.label}</dt><dd>{presentation.effort.value}</dd></div>}
  </dl>
}

function ModelInformation({ identity, presentation, adapterKind, className = '' }: {
  identity: Identity
  presentation: Presentation | null
  adapterKind?: string
  className?: string
}): React.JSX.Element | null {
  if (!presentation) return null
  const summary = modelSummary(presentation)
  const label = uiAttribute('{0}的模型信息', identity.displayName)
  return <Popover.Root>
    <Popover.Trigger asChild>
      <button type="button" className={`thread-model-summary ${className}`} title={summary}
        aria-label={`${label} · ${summary}`}>
        <ModelSummaryText presentation={presentation} />
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4" /></svg>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="thread-model-popover" aria-label={label} align="start" sideOffset={6} collisionPadding={12}>
        <header>
          <MemberAvatar {...identity} size="mention" decorative />
          <strong>{identity.displayName}</strong>
          <Popover.Close className="thread-model-close" aria-label={uiAttribute('关闭模型信息')}>
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </Popover.Close>
        </header>
        <ModelFields presentation={presentation} adapterKind={adapterKind} />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

export function MessageModelSummary({ message, installations, displayName, avatarRef }: {
  message: ThreadMessageView
  installations: AdapterInstallation[]
  displayName: string
  avatarRef: string | null
}): React.JSX.Element {
  return <RuntimeModelSummary model={message.runtimeModel} installations={installations}
    identity={{ agentId: message.authorId, displayName, avatarRef }} />
}

export function RunModelSummary({ run, installations, displayName, avatarRef }: {
  run: AgentRunView
  installations: AdapterInstallation[]
  displayName: string
  avatarRef: string | null
}): React.JSX.Element {
  return <RuntimeModelSummary model={run.runtimeModel} installations={installations}
    identity={{ agentId: run.agentId, displayName, avatarRef }} />
}

function RuntimeModelSummary({ model, installations, identity }: {
  model: AgentRunView['runtimeModel'] | undefined
  installations: AdapterInstallation[]
  identity: Identity
}): React.JSX.Element {
  const installation = installations.find(candidate => candidate.adapterKind === model?.adapterKind
    && candidate.installationClass === 'managed_default' && candidate.authScope === 'default') ?? null
  // Old Hosts provide only the observed model ID. Preserve it without guessing
  // an adapter or effort from the member's mutable current configuration.
  const presentation = model?.adapterKind
    ? messageRuntimeModelPresentation({ ...model, adapterKind: model.adapterKind, reasoningEffort: model.reasoningEffort ?? null }, installation)
    : model ? { model: model.modelId ?? uiAttribute('智能体默认'), effort: null } : null
  return <ModelInformation identity={identity}
    presentation={presentation} adapterKind={model?.adapterKind}
    className="message-model-summary" />
}

export function ProfileModelFields({ profile, installations }: {
  profile: AgentProfile
  installations: AdapterInstallation[]
}): React.JSX.Element | null {
  if (!profile.runtimeConfiguration) return null
  const configuration = profile.runtimeConfiguration
  const presentation = memberRuntimeConfigurationPresentation(configuration,
    runtimeEditorInstallation(installations, configuration.adapterKind))
  return <div className="mention-profile-model"><ModelFields presentation={presentation} /></div>
}
