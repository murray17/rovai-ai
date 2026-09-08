import { useState, type KeyboardEvent } from 'react'
import { runtimeInstallGuide } from './runtime-install-guide'
import type {
  AdapterInstallation,
  AdapterKind,
  AppearanceSnapshot,
  HealthStatus,
  HostPlatformKey,
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
  runtimePlatformAdmissionAllowsUse,
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
import piLogo from './assets/runtime-logos/pi.svg'
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
  'pi',
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
  pi: piLogo,
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
  pi: 'Pi Coding Agent',
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

const MEMBER_SUMMARIES: Record<BuiltinMemberPreset['role'], string> = {
  luoke: '需求理解、项目调查与代码实现。',
  muwa: '方案与代码评审，核查风险和边界。',
  mianzhi: '测试与问题复现，验证功能可靠性。',
  qilu: '交互、视觉设计与前端实现。'
}

function moveRadioSelection(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]:not(:disabled):not([aria-disabled="true"])'))
  const current = rows.indexOf(event.target as HTMLButtonElement)
  if (current < 0 || rows.length === 0) return
  event.preventDefault()
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
    : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + rows.length) % rows.length
  rows[index].focus()
  rows[index].click()
}

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
      <p>选一位队员，开始你的第一次协作。</p>
      <button className="primary-button conversation-primary-button onboarding-primary" type="button" disabled={busy} onClick={onContinue}>
        选择队员
        <ForwardIcon />
      </button>
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
        <h1 id="onboarding-member-title">选择第一位队员</h1>
        <p>之后可以继续邀请其他队员。</p>
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
            <h2>{selected.displayName}</h2>
            <strong>{selected.teamRole}</strong>
            <div className="onboarding-member-traits">
              {selected.personalityTraits.map((trait) => <span key={trait}>{trait}</span>)}
            </div>
            <details key={selected.role} className="onboarding-member-details">
              <summary>了解工作方式</summary>
              <p>{selected.professionalResponsibilities}</p>
            </details>
          </div>
        </aside>
        <div className="onboarding-member-chooser">
          <div className="onboarding-member-list" role="radiogroup" aria-label="选择第一位队员" onKeyDown={moveRadioSelection}>
            {BUILTIN_MEMBER_PRESETS.map((preset) => {
              const checked = selected.role === preset.role
              return (
                <button
                  className="onboarding-member-row"
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  data-member-role={preset.role}
                  aria-disabled={busy}
                  key={preset.role}
                  onClick={() => { if (!busy) onSelect(preset.role) }}
                >
                  <span className="onboarding-member-row-name">
                    <strong>{preset.displayName}</strong>
                    <small>{preset.teamRole}</small>
                  </span>
                  <span className="onboarding-member-row-copy">
                    <small>{MEMBER_SUMMARIES[preset.role]}</small>
                  </span>
                  <span className="onboarding-radio-check" aria-hidden="true" />
                </button>
              )
            })}
          </div>
          <footer className="onboarding-member-footer">
            <span>接下来：选择运行时</span>
            <button className="primary-button conversation-primary-button onboarding-primary" type="button" disabled={busy} onClick={onContinue}>
              下一步
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
  const hasEnabledRuntime = health?.runtimePlatformAdmission.some((row) => (
    row.platform === health.hostPlatform && runtimePlatformAdmissionAllowsUse(row)
  )) ?? false
  const runtimeChoices = ONBOARDING_PRODUCT_RUNTIMES.map((kind) => {
    const item = availability.find((candidate) => candidate.runtimeKind === kind) ?? null
    const admission = runtimePlatformAdmissionFor(health?.hostPlatform ?? null, health?.runtimePlatformAdmission ?? [], kind)
    const presentation = runtimeProductPresentation(admission, item)
    return { kind, presentation, selectable: presentation.status === 'available' && runtimePlatformAdmissionAllowsUse(admission) }
  })
  const focusRuntime = runtimeChoices.find((row) => row.selectable && row.kind === selection?.adapterKind)?.kind
    ?? runtimeChoices.find((row) => row.selectable)?.kind

  return (
    <section className="onboarding-track onboarding-runtime-track" aria-labelledby="onboarding-runtime-title">
      <header className="onboarding-page-heading onboarding-runtime-heading">
        <div>
          <h1 id="onboarding-runtime-title">选择运行时</h1>
          <p>使用这台电脑上已安装的运行时，为{member.displayName}提供模型与工具。</p>
        </div>
        {!scanning && !showingEmpty && hasEnabledRuntime && (
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
            <p>即将加入你的第一段协作。</p>
          </div>
        </aside>
        <div className="onboarding-runtime-workspace">
          {showingEmpty
            ? (
                <RuntimeEmptyState
                  busy={busy}
                  scanFailed={phase === 'error'}
                  error={error}
                  platform={health?.hostPlatform ?? null}
                  onRefresh={onRefresh}
                  onDefer={onDefer}
                />
              )
            : (
                <>
          <section className="onboarding-runtime-panel">
            <header>
              <span><strong>本机运行时</strong><small>{scanning ? '正在读取本机环境' : hasEnabledRuntime ? '选择一个可用的运行时' : '当前平台的 Runtime 资格状态'}</small></span>
              {scanning && <span className="onboarding-scan-status"><i />正在检查</span>}
            </header>
            {scanning
              ? <RuntimeScanProgress phase={phase} />
              : (
                  <div className="onboarding-runtime-list" role="radiogroup" aria-label="选择运行时" onKeyDown={moveRadioSelection}>
                    {runtimeChoices.map(({ kind, presentation, selectable }) => {
                      return (
                        <RuntimeRow
                          key={kind}
                          kind={kind}
                          presentation={presentation}
                          checked={selection?.adapterKind === kind}
                          tabIndex={focusRuntime === kind ? 0 : -1}
                          disabled={provisioning || !selectable}
                          busy={busy}
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
                    模型
                  </strong>
                </span>
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
                  : <p className="onboarding-model-empty">从上方选择一个可用的运行时。</p>}
              </div>
            </section>
          )}

          {error && (
            <div className="onboarding-runtime-error" role="alert">
              <strong>还没能完成首次配置</strong>
              <span>{error}</span>
            </div>
          )}

          <p className="onboarding-runtime-footnote">登录与模型能力将在首次执行时确认。</p>
          <footer className="onboarding-runtime-footer">
            <span>
              {busy ? '正在准备“初次集结”…' : provisioning ? '可以从已保存的进度继续。' : '准备好后，进入「初次集结」。'}
            </span>
            <button
              className="primary-button conversation-primary-button onboarding-primary"
              type="button"
              disabled={!canContinue || busy}
              onClick={onComplete}
            >
              {busy ? '正在准备…' : provisioning ? '继续准备' : '开始对话'}
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
  scanFailed,
  error,
  platform,
  onRefresh,
  onDefer
}: {
  busy: boolean
  scanFailed: boolean
  error: string | null
  platform: HostPlatformKey | null
  onRefresh(): void
  onDefer(): void
}): React.JSX.Element {
  const [guideOpen, setGuideOpen] = useState(false)
  return (
    <>
      <section
        className="onboarding-runtime-panel onboarding-runtime-empty-panel"
        aria-labelledby="onboarding-runtime-empty-title"
      >
        <header>
          <strong>本机运行时</strong>
          <span className="onboarding-runtime-state">{scanFailed ? '扫描未完成' : '无可用入口'}</span>
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
            <h2 id="onboarding-runtime-empty-title">{scanFailed ? '这次扫描未完成' : '暂未找到可用的运行时'}</h2>
            <p>{scanFailed ? '请重新扫描，确认这台电脑上的可用运行时。' : '安装或完成运行配置后，回到这里重新扫描。'}</p>
            <div className="onboarding-runtime-empty-actions">
              <button className={scanFailed ? 'quiet-button' : 'primary-button conversation-primary-button'} type="button"
                disabled={busy} aria-expanded={guideOpen} aria-controls="onboarding-install-links" onClick={() => setGuideOpen(!guideOpen)}>
                查看安装引导
              </button>
              <button className={scanFailed ? 'primary-button conversation-primary-button' : 'quiet-button'} type="button" disabled={busy} onClick={onRefresh}>
                重新扫描
              </button>
            </div>
            <div id="onboarding-install-links" className="onboarding-install-links" hidden={!guideOpen}>
              {ONBOARDING_PRODUCT_RUNTIMES.map((kind) => {
                const guide = runtimeInstallGuide(kind, platform)
                return guide && <a key={kind} href={guide.docs} target="_blank" rel="noopener noreferrer">{RUNTIME_LABELS[kind]} <span aria-hidden="true">↗</span></a>
              })}
            </div>
            {error && <details className="onboarding-member-details"><summary>查看详情</summary><p>{error}</p></details>}
          </div>
        </div>
      </section>
      <footer className="onboarding-runtime-footer onboarding-runtime-empty-footer">
        <span>稍后可在设置中继续配置。</span>
        <button className="quiet-button onboarding-defer" type="button" disabled={busy} onClick={onDefer}>
          {busy ? '正在进入…' : '稍后配置'}
        </button>
      </footer>
    </>
  )
}

function RuntimeScanProgress({ phase }: { phase: OnboardingRuntimePhase }): React.JSX.Element {
  const current = ({ idle: 0, discovering: 0, checking: 1, models: 2, ready: 3, error: 0 })[phase]
  return (
    <div className="onboarding-scan-progress" role="status" aria-live="polite">
      {[
        ['查找安装入口', '查找这台电脑上已安装的运行时'],
        ['确认运行时身份', '读取本机运行时的轻度检查结果'],
        ['读取运行配置', '准备当前安装的默认配置']
      ].map(([title, detail], index) => {
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
  tabIndex,
  disabled,
  busy,
  onSelect
}: {
  kind: AdapterKind
  presentation: RuntimeStatusPresentation
  checked: boolean
  tabIndex: number
  disabled: boolean
  busy: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <button
      className="onboarding-runtime-row"
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      title={runtimeRowDetail(presentation)}
      disabled={disabled}
      aria-disabled={disabled || busy}
      onClick={() => { if (!busy) onSelect() }}
    >
      <span className="onboarding-radio-check" aria-hidden="true" />
      <span className="onboarding-runtime-logo"><img src={RUNTIME_LOGOS[kind]} alt="" /></span>
      <span className="onboarding-runtime-copy"><strong>{RUNTIME_LABELS[kind]}</strong>
        {presentation.status !== 'available' && presentation.status !== 'not_installed' && <small>{runtimeRowDetail(presentation)}</small>}
      </span>
      <RuntimeState presentation={presentation} />
    </button>
  )
}

function RuntimeState({ presentation }: { presentation: RuntimeStatusPresentation }): React.JSX.Element {
  return (
    <span className={`onboarding-runtime-state status-${presentation.status}`}>
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
  if (admission && !runtimePlatformAdmissionAllowsUse(admission)) return false
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
    available: '登录与模型能力将在首次执行时确认',
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
