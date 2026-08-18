import type {
  AdapterInstallation,
  AdapterKind,
  AppearanceSnapshot,
  HealthStatus,
  OnboardingRuntimeSelection,
  OnboardingSnapshot,
  ProductRuntimeAvailability,
  RuntimeModelCatalogView,
  ThemePreference
} from '@contracts'
import {
  MemberModelParameters,
  runtimeEditorInstallation,
  runtimeModelSelectionAvailable
} from './MemberRuntimeParameters'
import { MemberPortrait } from './MemberPortrait'
import { BUILTIN_MEMBER_PRESETS, type BuiltinMemberPreset } from './member-presets'
import { runtimeAvailabilityPresentation, type RuntimeStatusPresentation } from './runtime-status'
import antigravityLogo from './assets/runtime-logos/antigravity-color.svg'
import claudeCodeLogo from './assets/runtime-logos/claudecode-color.svg'
import codeBuddyLogo from './assets/runtime-logos/codebuddy-color.svg'
import codexLogo from './assets/runtime-logos/codex-color.svg'
import copilotLogo from './assets/runtime-logos/copilot-color.svg'
import kiroLogo from './assets/runtime-logos/kiro-color.svg'
import openCodeLogo from './assets/runtime-logos/opencode.svg'
import qoderLogo from './assets/runtime-logos/qoder-color.svg'
import qwenLogo from './assets/runtime-logos/qwen-color.svg'
import traeLogo from './assets/runtime-logos/trae-color.svg'

export type OnboardingRuntimePhase =
  | 'idle'
  | 'discovering'
  | 'checking'
  | 'models'
  | 'ready'
  | 'error'

export const ONBOARDING_PRODUCT_RUNTIMES: readonly AdapterKind[] = [
  'claude-code-cli',
  'codex-cli',
  'copilot-cli',
  'opencode-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'antigravity-app'
]

const RUNTIME_LOGOS: Record<AdapterKind, string> = {
  'claude-code-cli': claudeCodeLogo,
  'codex-cli': codexLogo,
  'copilot-cli': copilotLogo,
  'opencode-cli': openCodeLogo,
  'kiro-cli': kiroLogo,
  'qoder-cli': qoderLogo,
  'codebuddy-cli': codeBuddyLogo,
  'qwen-code': qwenLogo,
  'trae-cn-cli': traeLogo,
  'antigravity-app': antigravityLogo
}

const RUNTIME_LABELS: Record<AdapterKind, string> = {
  'claude-code-cli': 'Claude Code',
  'codex-cli': 'Codex CLI',
  'copilot-cli': 'GitHub Copilot',
  'opencode-cli': 'OpenCode',
  'kiro-cli': 'Kiro',
  'qoder-cli': 'Qoder',
  'codebuddy-cli': 'CodeBuddy',
  'qwen-code': 'Qwen Code',
  'trae-cn-cli': 'TRAE CLI（中国企业版）',
  'antigravity-app': 'Antigravity'
}

const SCAN_PHASES = [
  ['查找已安装的 Agent 运行时', '读取本机安装入口'],
  ['检查登录与版本', '确认当前是否可以使用'],
  ['读取模型目录', '准备可选模型和参数']
] as const

type InProgressOnboarding = Extract<OnboardingSnapshot, { status: 'in_progress' }>

export function OnboardingFlow({
  snapshot,
  appearance,
  health,
  installations,
  runtimePhase,
  busy,
  error,
  onThemeChange,
  onShowWelcome,
  onCompleteWelcome,
  onSelectMember,
  onShowMemberSelection,
  onCompleteMemberSelection,
  onRefreshRuntime,
  onOpenModelCatalog,
  onRuntimeSelectionChange,
  onComplete
}: {
  snapshot: InProgressOnboarding
  appearance: AppearanceSnapshot
  health: HealthStatus | null
  installations: AdapterInstallation[]
  runtimePhase: OnboardingRuntimePhase
  busy: boolean
  error: string | null
  onThemeChange(preference: ThemePreference): void
  onShowWelcome(): void
  onCompleteWelcome(): void
  onSelectMember(role: BuiltinMemberPreset['role']): void
  onShowMemberSelection(): void
  onCompleteMemberSelection(): void
  onRefreshRuntime(): void
  onOpenModelCatalog(runtimeKind: AdapterKind): Promise<RuntimeModelCatalogView>
  onRuntimeSelectionChange(selection: OnboardingRuntimeSelection | null): void
  onComplete(): void
}): React.JSX.Element {
  const selectedMember = BUILTIN_MEMBER_PRESETS.find(
    (preset) => preset.role === snapshot.selectedMemberRole
  ) ?? BUILTIN_MEMBER_PRESETS[0]
  const backAction = snapshot.step === 'member'
    ? onShowWelcome
    : snapshot.step === 'runtime' && !snapshot.provisioning
      ? onShowMemberSelection
      : null

  return (
    <div className="onboarding-shell">
      <header className="onboarding-header">
        <div className="onboarding-lockup" aria-label="Rovai AI">
          <OnboardingBrandMark compact />
          <span><strong>Rovai</strong><small>AI</small></span>
        </div>
        <div className="onboarding-header-actions">
          {backAction && (
            <button className="onboarding-back" type="button" disabled={busy} onClick={backAction}>
              <BackIcon />
              返回
            </button>
          )}
          <button
            className="onboarding-theme-toggle"
            type="button"
            disabled={busy}
            aria-label={appearance.resolvedTheme === 'night' ? '切换到日间主题' : '切换到夜间主题'}
            title={appearance.resolvedTheme === 'night' ? '切换到日间主题' : '切换到夜间主题'}
            onClick={() => onThemeChange(appearance.resolvedTheme === 'night' ? 'day' : 'night')}
          >
            <ThemeIcon mode={appearance.resolvedTheme} />
          </button>
        </div>
      </header>
      <main className="onboarding-main">
        {snapshot.step === 'welcome' && (
          <WelcomeStep busy={busy} onContinue={onCompleteWelcome} />
        )}
        {snapshot.step === 'member' && (
          <MemberStep
            selected={selectedMember}
            busy={busy}
            onSelect={onSelectMember}
            onContinue={onCompleteMemberSelection}
          />
        )}
        {snapshot.step === 'runtime' && (
          <RuntimeStep
            member={selectedMember}
            selection={snapshot.runtimeSelection}
            availability={health?.runtimeAvailability ?? []}
            installations={installations}
            phase={runtimePhase}
            provisioning={snapshot.provisioning !== null}
            busy={busy}
            error={error}
            onRefresh={onRefreshRuntime}
            onOpenModelCatalog={onOpenModelCatalog}
            onSelectionChange={onRuntimeSelectionChange}
            onComplete={onComplete}
          />
        )}
      </main>
    </div>
  )
}

function WelcomeStep({
  busy,
  onContinue
}: {
  busy: boolean
  onContinue(): void
}): React.JSX.Element {
  return (
    <section className="onboarding-welcome" aria-labelledby="onboarding-welcome-title">
      <div className="onboarding-welcome-mark"><OnboardingBrandMark /></div>
      <h1 id="onboarding-welcome-title">欢迎来到 Rovai</h1>
      <p>先选一位队员，准备好运行环境，然后从快速对话开始。</p>
      <button className="primary-button onboarding-primary" type="button" disabled={busy} onClick={onContinue}>
        开始旅程
        <ForwardIcon />
      </button>
      <span className="onboarding-note"><i aria-hidden="true" />这些设置之后都可以修改。</span>
    </section>
  )
}

function MemberStep({
  selected,
  busy,
  onSelect,
  onContinue
}: {
  selected: BuiltinMemberPreset
  busy: boolean
  onSelect(role: BuiltinMemberPreset['role']): void
  onContinue(): void
}): React.JSX.Element {
  return (
    <section className="onboarding-track" aria-labelledby="onboarding-member-title">
      <header className="onboarding-page-heading">
        <h1 id="onboarding-member-title">先认识一位队员</h1>
        <p>选好后，它会留在队员名册里。之后也可以随时邀请其他队员。</p>
      </header>
      <div className="onboarding-member-layout">
        <aside className="onboarding-selected-member" data-member-role={selected.role}>
          <MemberPortrait
            agentId={`onboarding-${selected.role}`}
            avatarRef={selected.avatarRef}
            displayName={selected.displayName}
            decorative
            className="onboarding-selected-portrait"
          />
          <div className="onboarding-selected-copy">
            <span>当前选择</span>
            <h2>{selected.displayName}</h2>
            <strong>{selected.teamRole}</strong>
            <div className="onboarding-member-traits">
              {selected.personalityTraits.map((trait) => <span key={trait}>{trait}</span>)}
            </div>
            <p>{selected.professionalResponsibilities}</p>
          </div>
        </aside>
        <div className="onboarding-member-chooser">
          <div className="onboarding-member-list" role="radiogroup" aria-label="选择第一位队员">
            {BUILTIN_MEMBER_PRESETS.map((preset, index) => {
              const checked = selected.role === preset.role
              return (
                <button
                  className="onboarding-member-row"
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  data-member-role={preset.role}
                  disabled={busy}
                  key={preset.role}
                  onClick={() => onSelect(preset.role)}
                >
                  <span className="onboarding-member-row-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="onboarding-member-row-name">
                    <strong>{preset.displayName}</strong>
                    <small>{preset.teamRole}</small>
                  </span>
                  <span className="onboarding-member-row-copy">
                    <strong>{preset.personalityTraits.join(' · ')}</strong>
                    <small>{preset.professionalResponsibilities}</small>
                  </span>
                  <span className="onboarding-radio-check" aria-hidden="true"><CheckIcon /></span>
                </button>
              )
            })}
          </div>
          <footer className="onboarding-member-footer">
            <span>
              <strong>{selected.displayName}会成为你的第一位队员</strong>
              <small>下一步为它准备 Agent 运行时和模型。</small>
            </span>
            <button className="primary-button onboarding-primary" type="button" disabled={busy} onClick={onContinue}>
              和{selected.displayName}一起开始
              <ForwardIcon />
            </button>
          </footer>
        </div>
      </div>
    </section>
  )
}

function RuntimeStep({
  member,
  selection,
  availability,
  installations,
  phase,
  provisioning,
  busy,
  error,
  onRefresh,
  onOpenModelCatalog,
  onSelectionChange,
  onComplete
}: {
  member: BuiltinMemberPreset
  selection: OnboardingRuntimeSelection | null
  availability: ProductRuntimeAvailability[]
  installations: AdapterInstallation[]
  phase: OnboardingRuntimePhase
  provisioning: boolean
  busy: boolean
  error: string | null
  onRefresh(): void
  onOpenModelCatalog(runtimeKind: AdapterKind): Promise<RuntimeModelCatalogView>
  onSelectionChange(selection: OnboardingRuntimeSelection | null): void
  onComplete(): void
}): React.JSX.Element {
  const selectedAvailability = availability.find(
    (candidate) => candidate.runtimeKind === selection?.adapterKind
  ) ?? null
  const selectedInstallation = selection
    ? runtimeEditorInstallation(installations, selection.adapterKind)
    : null
  const selectedStatus = runtimeAvailabilityPresentation(
    selectedAvailability,
    phase !== 'ready' && phase !== 'error'
  )
  const canContinue = onboardingRuntimeCanContinue(
    phase,
    selection,
    selectedAvailability,
    selectedInstallation
  )
  const scanning = phase !== 'ready' && phase !== 'error'

  return (
    <section className="onboarding-track onboarding-runtime-track" aria-labelledby="onboarding-runtime-title">
      <header className="onboarding-page-heading onboarding-runtime-heading">
        <div>
          <h1 id="onboarding-runtime-title">为{member.displayName}准备运行环境</h1>
          <p>Rovai 会检查本机。找到可用的 Agent 运行时后，再选择模型。</p>
        </div>
        {!scanning && (
          <button className="quiet-button" type="button" disabled={busy} onClick={onRefresh}>重新扫描</button>
        )}
      </header>
      <div className="onboarding-runtime-layout">
        <aside className="onboarding-runtime-member" data-member-role={member.role}>
          <MemberPortrait
            agentId={`onboarding-runtime-${member.role}`}
            avatarRef={member.avatarRef}
            displayName={member.displayName}
            decorative
            className="onboarding-runtime-member-portrait"
          />
          <div>
            <h2>{member.displayName}</h2>
            <strong>{member.teamRole}</strong>
            <p>{member.professionalResponsibilities}</p>
            <dl>
              <div><dt>名册状态</dt><dd>已选定</dd></div>
              <div><dt>运行配置</dt><dd>{canContinue || provisioning ? '已准备' : '未完成'}</dd></div>
            </dl>
          </div>
        </aside>
        <div className="onboarding-runtime-workspace">
          <section className="onboarding-runtime-panel">
            <header>
              <span><strong>本机 Agent 运行时</strong><small>{scanning ? '正在读取本机环境' : '选择一个可用的运行入口'}</small></span>
              {scanning && <span className="onboarding-scan-status"><i />正在检查</span>}
            </header>
            {scanning
              ? <RuntimeScanProgress phase={phase} />
              : (
                  <div className="onboarding-runtime-list" role="radiogroup" aria-label="选择 Agent 运行时">
                    {ONBOARDING_PRODUCT_RUNTIMES.map((kind) => {
                      const item = availability.find((candidate) => candidate.runtimeKind === kind) ?? null
                      const presentation = runtimeAvailabilityPresentation(item)
                      return (
                        <RuntimeRow
                          key={kind}
                          kind={kind}
                          presentation={presentation}
                          checked={selection?.adapterKind === kind}
                          disabled={busy || provisioning}
                          onSelect={() => onSelectionChange(
                            onboardingRuntimeSelectionFor(kind, installations)
                          )}
                        />
                      )
                    })}
                  </div>
                )}
          </section>

          {!scanning && (
            <section className="onboarding-model-panel" aria-labelledby="onboarding-model-title">
              <header>
                <span>
                  <strong id="onboarding-model-title">
                    {selection ? `${RUNTIME_LABELS[selection.adapterKind]} · 模型配置` : '模型配置'}
                  </strong>
                  <small>{selection ? selectedStatus.detail ?? '模型来自本机 Agent 运行时能力快照' : '选择 Agent 运行时后继续'}</small>
                </span>
                {selection && <RuntimeState presentation={selectedStatus} />}
              </header>
              <div className="onboarding-model-body">
                {selection
                  ? (
                      <MemberModelParameters
                        adapterKind={selection.adapterKind}
                        installation={selectedInstallation}
                        model={selection.model}
                        disabled={busy || provisioning || selectedStatus.status !== 'available'}
                        onOpenModelCatalog={() => onOpenModelCatalog(selection.adapterKind)}
                        onChange={(model) => onSelectionChange({ ...selection, model })}
                      />
                    )
                  : <p className="onboarding-model-empty">从上方选择一个可用的 Agent 运行时。</p>}
              </div>
            </section>
          )}

          {error && (
            <div className="onboarding-runtime-error" role="alert">
              <strong>还没能完成首次配置</strong>
              <span>{error}</span>
            </div>
          )}

          <footer className="onboarding-runtime-footer">
            <span>
              <strong>{busy ? '正在准备“初次集结”' : provisioning ? '可以从已保存的进度继续' : canContinue ? '配置已准备好' : '完成 Runtime 与模型选择后继续'}</strong>
              <small>{provisioning ? '队员、运行配置和快速对话会安全地逐项保存，重试不会重复创建。' : canContinue ? '保存后直接进入真实快速对话。' : '当前选择会保留；不可用状态不会被伪装成可用。'}</small>
            </span>
            <button
              className="primary-button onboarding-primary"
              type="button"
              disabled={!canContinue || busy}
              onClick={onComplete}
            >
              {busy ? '正在准备快速对话…' : provisioning ? '继续准备快速对话' : '保存并进入快速对话'}
              {!busy && <ForwardIcon />}
            </button>
          </footer>
        </div>
      </div>
    </section>
  )
}

function RuntimeScanProgress({ phase }: { phase: OnboardingRuntimePhase }): React.JSX.Element {
  const current = ({ idle: 0, discovering: 0, checking: 1, models: 2, ready: 3, error: 0 })[phase]
  return (
    <div className="onboarding-scan-progress" role="status" aria-live="polite">
      {SCAN_PHASES.map(([title, detail], index) => {
        const done = index < current
        const active = index === current
        return (
          <div key={title}>
            <span><strong>{title}</strong><small>{detail}</small></span>
            <em className={done ? 'done' : active ? 'active' : ''}>
              {done ? <><CheckIcon />已完成</> : active ? <><i />正在检查…</> : '等待'}
            </em>
          </div>
        )
      })}
    </div>
  )
}

function RuntimeRow({
  kind,
  presentation,
  checked,
  disabled,
  onSelect
}: {
  kind: AdapterKind
  presentation: RuntimeStatusPresentation
  checked: boolean
  disabled: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <button
      className="onboarding-runtime-row"
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="onboarding-runtime-logo"><img src={RUNTIME_LOGOS[kind]} alt="" /></span>
      <span><strong>{RUNTIME_LABELS[kind]}</strong><small>{runtimeRowDetail(presentation)}</small></span>
      <RuntimeState presentation={presentation} />
    </button>
  )
}

function RuntimeState({ presentation }: { presentation: RuntimeStatusPresentation }): React.JSX.Element {
  return (
    <span className={`onboarding-runtime-state status-${presentation.status}`}>
      <i aria-hidden="true" />
      {presentation.label}
    </span>
  )
}

export function onboardingRuntimeSelectionFor(
  adapterKind: AdapterKind,
  installations: AdapterInstallation[]
): OnboardingRuntimeSelection {
  const installation = runtimeEditorInstallation(installations, adapterKind)
  const model = installation?.memberRuntimeDefaults?.model ?? null
  return {
    adapterKind,
    model: model?.mode === 'explicit'
      ? { mode: 'explicit', modelId: model.modelId, options: { ...model.options } }
      : model ? { mode: 'runtime_default' } : null
  }
}

export function onboardingRuntimeCanContinue(
  phase: OnboardingRuntimePhase,
  selection: OnboardingRuntimeSelection | null,
  availability: ProductRuntimeAvailability | null,
  installation: AdapterInstallation | null
): boolean {
  if (phase !== 'ready' || !selection?.model || !installation?.memberRuntimeDefaults) return false
  const status = runtimeAvailabilityPresentation(availability).status
  if (status !== 'available') return false
  return selection.adapterKind === installation.adapterKind
    && installation.installationClass === 'managed_default'
    && installation.authScope === 'default'
    && installation.memberRuntimeDefaults.adapterKind === selection.adapterKind
    && installation.memberRuntimeDefaults.permissions.adapterKind === selection.adapterKind
    && runtimeModelSelectionAvailable(installation, selection.model)
}

function runtimeRowDetail(presentation: RuntimeStatusPresentation): string {
  return presentation.detail ?? ({
    checking: '正在读取当前状态',
    available: '能力与模型目录可读取',
    authentication_required: '完成登录后重新扫描',
    not_installed: '本机未找到安装入口',
    version_unsupported: '更新后重新扫描',
    unavailable: '当前安装不可使用',
    unknown: '尚无可靠检查结果',
    unconfigured: '尚未配置'
  })[presentation.status]
}

function OnboardingBrandMark({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <svg
      className={compact ? 'onboarding-brand-mark compact' : 'onboarding-brand-mark'}
      data-brand-mark="horizon"
      data-brand-layout="separated"
      viewBox="0 0 72 56"
      aria-hidden="true"
    >
      <path d="M36 4l2.7 12.3L51 19l-12.3 2.7L36 34l-2.7-12.3L21 19l12.3-2.7L36 4Z" />
      <path d="M12 43.5c7.8-7.6 15.8-11.4 24-11.4s16.2 3.8 24 11.4" fill="none" />
      <circle className="brand-rendezvous-point" cx="36" cy="43.5" r="2.4" />
    </svg>
  )
}

function BackIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.75 3.25-4.5 4.75 4.5 4.75M5.5 8h6" /></svg>
}

function ForwardIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.25 3.25 4.5 4.75-4.5 4.75M10.5 8h-6" /></svg>
}

function CheckIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.25 3 3 6.5-6.5" /></svg>
}

function ThemeIcon({ mode }: { mode: AppearanceSnapshot['resolvedTheme'] }): React.JSX.Element {
  return mode === 'night'
    ? <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.25" /><path d="M10 1.75v2M10 16.25v2M1.75 10h2M16.25 10h2M4.15 4.15l1.4 1.4M14.45 14.45l1.4 1.4M15.85 4.15l-1.4 1.4M5.55 14.45l-1.4 1.4" /></svg>
    : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.8 12.7A6.8 6.8 0 0 1 7.3 4.2 6.25 6.25 0 1 0 15.8 12.7Z" /></svg>
}
