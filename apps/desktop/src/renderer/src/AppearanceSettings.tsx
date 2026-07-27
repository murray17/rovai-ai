import type { AppearanceSnapshot, ThemePreference } from '@contracts'
import { THEME_OPTIONS } from './theme'

export function AppearanceSettings({
  appearance,
  disabled,
  onChange
}: {
  appearance: AppearanceSnapshot
  disabled: boolean
  onChange(preference: ThemePreference): void
}): React.JSX.Element {
  return (
    <section className="section-block appearance-settings">
      <div className="section-heading">
        <div>
          <h2>外观</h2>
        </div>
        <span className="status-badge status-neutral">
          当前 · {appearance.resolvedTheme === 'night' ? '夜航' : '晨线'}
        </span>
      </div>
      <fieldset className="appearance-options" disabled={disabled}>
        <legend>界面主题</legend>
        {THEME_OPTIONS.map((option) => (
          <label key={option.value} className="appearance-option">
            <input
              type="radio"
              name="theme-preference"
              value={option.value}
              checked={appearance.preference === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.englishLabel} · {option.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}

