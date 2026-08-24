import type {
  AdapterInstallation,
  AdapterKind,
  AppearanceSnapshot,
  HealthStatus,
  OnboardingRuntimeSelection,
  OnboardingSnapshot,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission,
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
import {
  runtimeAvailabilityPresentation,
  runtimePlatformAdmissionFor,
  runtimeProductPresentation,
  type RuntimeStatusPresentation
} from './runtime-status'
import antigravityLogo from './assets/runtime-logos/antigravity-color.svg'
import claudeCodeLogo from './assets/runtime-logos/claudecode-color.svg'
import codeBuddyLogo from './assets/runtime-logos/codebuddy-color.svg'
import codexLogo from './assets/runtime-logos/codex-color.svg'
import copilotLogo from './assets/runtime-logos/copilot-color.svg'
import cursorLogo from './assets/runtime-logos/cursor.svg'
import grokLogo from './assets/runtime-logos/grok.svg'
import kiroLogo from './assets/runtime-logos/kiro-color.svg'
import kimiLogo from './assets/runtime-logos/kimi.svg'
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
  'kimi-code-cli',
  'grok-build',
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
  'cursor-agent': cursorLogo,
  'kimi-code-cli': kimiLogo,
  'grok-build': grokLogo,
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
  'trae-cn-cli': 'TRAE CLI',
  'cursor-agent': 'Cursor Agent',
  'kimi-code-cli': 'Kimi Code',
  'grok-build': 'Grok Build',
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
  onDeferRuntime,
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
  onDeferRuntime(): void
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
            health={health}
            installations={installations}
            phase={runtimePhase}
            provisioning={snapshot.provisioning !== null}
            busy={busy}
            error={error}
            onRefresh={onRefreshRuntime}
            onOpenModelCatalog={onOpenModelCatalog}
            onSelectionChange={onRuntimeSelectionChange}
            onDefer={onDeferRuntime}
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
  health,
  installations,
  phase,
  provisioning,
  busy,
  error,
  onRefresh,
  onOpenModelCatalog,
  onSelectionChange,
  onDefer,
  onComplete
}: {
  member: BuiltinMemberPreset
  selection: OnboardingRuntimeSelection | null
  health: HealthStatus | null
  installations: AdapterInstallation[]
  phase: OnboardingRuntimePhase
  provisioning: boolean
  busy: boolean
  error: string | null
  onRefresh(): void
  onOpenModelCatalog(runtimeKind: AdapterKind): Promise<RuntimeModelCatalogView>
  onSelectionChange(selection: OnboardingRuntimeSelection | null): void
  onDefer(): void
  onComplete(): void
}): React.JSX.Element {
  const availability = health?.runtimeAvailability ?? []
  const selectedAvailability = availability.find(
    (candidate) => candidate.runtimeKind === selection?.adapterKind
  ) ?? null
  const selectedAdmission = selection
    ? runtimePlatformAdmissionFor(
        health?.hostPlatform ?? null,
        health?.runtimePlatformAdmission ?? [],
        selection.adapterKind
      )
    : null
  const selectedInstallation = selection
    ? runtimeEditorInstallation(installations, selection.adapterKind)
    : null
  const selectedStatus = runtimeProductPresentation(
    selectedAdmission,
    selectedAvailability,
    phase !== 'ready' && phase !== 'error'
  )
  const canContinue = onboardingRuntimeCanContinue(
    phase,
    selection,
    selectedAvailability,
    selectedInstallation,
    selectedAdmission
  )
  const scanning = phase !== 'ready' && phase !== 'error'
  const hasUsableRuntime = onboardingHasUsableRuntime(phase, health, installations)
  const showingEmpty = !provisioning && !scanning && !hasUsableRuntime
  const hasQualifiedRuntime = health?.runtimePlatformAdmission.some((row) => (
    row.platform === health.hostPlatform && row.status === 'qualified'
  )) ?? false

  return (
    <section className="onboarding-track onboarding-runtime-track" aria-labelledby="onboarding-runtime-title">
      <header className="onboarding-page-heading onboarding-runtime-heading">
        <div>
          <h1 id="onboarding-runtime-title">为{member.displayName}准备运行环境</h1>
          <p>{showingEmpty
            ? 'Rovai 会检查这台电脑上已经安装的 Agent 运行时。找到可用入口后，你可以选择模型；也可以先进入 Rovai，稍后再配置。'
            : 'Rovai 会检查本机。找到可用的 Agent 运行时后，再选择模型。'}</p>
        </div>
        {!scanning && !showingEmpty && hasQualifiedRuntime && (
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
              <div><dt>运行配置</dt><dd>{showingEmpty ? '未配置' : canContinue || provisioning ? '已准备' : '未完成'}</dd></div>
            </dl>
          </div>
        </aside>
        <div className="onboarding-runtime-workspace">
          {showingEmpty
            ? (
                <RuntimeEmptyState
                  busy={busy}
                  onRefresh={onRefresh}
                  onDefer={onDefer}
                />
              )
            : (
                <>
          <section className="onboarding-runtime-panel">
            <header>
              <span><strong>本机 Agent 运行时</strong><small>{scanning ? '正在读取本机环境' : hasQualifiedRuntime ? '选择一个可用的运行入口' : '当前平台的 Runtime 资格状态'}</small></span>
              {scanning && <span className="onboarding-scan-status"><i />正在检查</span>}
            </header>
            {scanning
              ? <RuntimeScanProgress phase={phase} />
              : (
                  <div className="onboarding-runtime-list" role="radiogroup" aria-label="选择 Agent 运行时">
                    {ONBOARDING_PRODUCT_RUNTIMES.map((kind) => {
                      const item = availability.find((candidate) => candidate.runtimeKind === kind) ?? null
                      const admission = runtimePlatformAdmissionFor(
                        health?.hostPlatform ?? null,
                        health?.runtimePlatformAdmission ?? [],
                        kind
                      )
                      const presentation = runtimeProductPresentation(admission, item)
                      return (
                        <RuntimeRow
                          key={kind}
                          kind={kind}
                          presentation={presentation}
                          checked={selection?.adapterKind === kind}
                          disabled={busy || provisioning || admission?.status !== 'qualified'}
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
                </>
              )}
        </div>
      </div>
    </section>
  )
}

function RuntimeEmptyState({
  busy,
  onRefresh,
  onDefer
}: {
  busy: boolean
  onRefresh(): void
  onDefer(): void
}): React.JSX.Element {
  return (
    <>
      <section
        className="onboarding-runtime-panel onboarding-runtime-empty-panel"
        aria-labelledby="onboarding-runtime-empty-title"
      >
        <header>
          <span><strong>本机 Agent 运行时</strong><small>当前没有可以直接使用的入口</small></span>
          <span className="onboarding-runtime-state status-unavailable"><i aria-hidden="true" />无可用入口</span>
        </header>
        <div className="onboarding-runtime-empty">
          <div className="onboarding-runtime-empty-visual" aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <rect x="17" y="18" width="66" height="46" rx="5" />
              <path d="M33 79h34M40 64v15M60 64v15" />
              <circle cx="35" cy="40" r="4" />
              <circle cx="50" cy="40" r="4" />
              <circle cx="65" cy="40" r="4" />
              <path d="M31 53h38" />
            </svg>
          </div>
          <div className="onboarding-runtime-empty-copy">
            <h2 id="onboarding-runtime-empty-title">当前没有可用的 Agent 运行时</h2>
            <p>可能尚未安装、未完成登录、版本不满足要求，或本次检查没有得到可用结果。你仍然可以进入 Rovai；训练营会在这里正式结束。</p>
            <div className="onboarding-runtime-evidence-list" aria-label="当前结果边界">
              <div>
                <strong><EvidenceInstallIcon />安装入口</strong>
                <small>未形成可用入口</small>
              </div>
              <div>
                <strong><EvidenceClockIcon />登录与版本</strong>
                <small>可能需要处理或重试</small>
              </div>
              <div>
                <strong><EvidenceModelIcon />模型目录</strong>
                <small>尚未选择，因此未读取</small>
              </div>
            </div>
            <details className="onboarding-runtime-install-guide">
              <summary>查看安装说明</summary>
              <div>
                <p>安装或登录任一支持的 Runtime 后，可以在设置页重新扫描。以下仅是入口示例：</p>
                <div className="onboarding-runtime-install-options">
                  <span><strong>Codex CLI</strong><code>设置 → Agent 运行时</code></span>
                  <span><strong>Claude Code</strong><code>设置 → Agent 运行时</code></span>
                  <span><strong>Antigravity</strong><code>设置 → Agent 运行时</code></span>
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>
      <footer className="onboarding-runtime-footer onboarding-runtime-empty-footer">
        <span>
          <strong>结束训练营并进入 Rovai</strong>
          <small>以后不会再次自动进入训练营；需要执行 Agent 工作时，从设置页配置 Runtime。</small>
        </span>
        <span className="onboarding-runtime-empty-actions">
          <button
            className="quiet-button onboarding-runtime-empty-secondary"
            type="button"
            disabled={busy}
            onClick={onRefresh}
          >
            重新扫描
          </button>
          <button className="primary-button onboarding-primary" type="button" disabled={busy} onClick={onDefer}>
            {busy ? '正在进入 Rovai…' : '进入 Rovai'}
            {!busy && <ForwardIcon />}
          </button>
        </span>
      </footer>
    </>
  )
}

function EvidenceInstallIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.75v10.5M2.75 8h10.5" /></svg>
}

function EvidenceClockIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" /><path d="M8 5.2v3.2l2 1.3" /></svg>
}

function EvidenceModelIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4.5h8v7H4z" /></svg>
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
  installation: AdapterInstallation | null,
  admission: RuntimePlatformAdmission | null = null
): boolean {
  if (phase !== 'ready' || !selection?.model || !installation?.memberRuntimeDefaults) return false
  if (admission && admission.status !== 'qualified') return false
  const status = admission
    ? runtimeProductPresentation(admission, availability).status
    : runtimeAvailabilityPresentation(availability).status
  if (status !== 'available') return false
  return selection.adapterKind === installation.adapterKind
    && installation.installationClass === 'managed_default'
    && installation.authScope === 'default'
    && installation.memberRuntimeDefaults.adapterKind === selection.adapterKind
    && installation.memberRuntimeDefaults.permissions.adapterKind === selection.adapterKind
    && runtimeModelSelectionAvailable(installation, selection.model)
}

export function onboardingHasUsableRuntime(
  phase: OnboardingRuntimePhase,
  health: HealthStatus | null,
  installations: AdapterInstallation[]
): boolean {
  if (phase !== 'ready' || !health) return false
  return ONBOARDING_PRODUCT_RUNTIMES.some((kind) => {
    const admission = runtimePlatformAdmissionFor(
      health.hostPlatform,
      health.runtimePlatformAdmission,
      kind
    )
    const availability = health.runtimeAvailability.find(
      (candidate) => candidate.runtimeKind === kind
    ) ?? null
    const installation = runtimeEditorInstallation(installations, kind)
    return onboardingRuntimeCanContinue(
      phase,
      onboardingRuntimeSelectionFor(kind, installations),
      availability,
      installation,
      admission
    )
  })
}

function runtimeRowDetail(presentation: RuntimeStatusPresentation): string {
  return presentation.detail ?? ({
    checking: '正在读取当前状态',
    available: '能力与模型目录可读取',
    authentication_required: '完成登录后重新扫描',
    not_installed: '本机未找到安装入口',
    version_unsupported: '更新后重新扫描',
    unavailable: '当前安装不可使用',
    not_qualified: 'Windows 资格验证尚未完成',
    unsupported: '当前平台不支持',
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
