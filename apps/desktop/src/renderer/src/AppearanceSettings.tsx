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
    <>
      <section className="section-block appearance-settings" aria-labelledby="appearance-theme-heading">
        <div className="section-heading">
          <div>
            <h2 id="appearance-theme-heading">界面主题</h2>
          </div>
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
                <small>{option.englishLabel}{option.description ? ` · ${option.description}` : ''}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
    </>
  )
}
