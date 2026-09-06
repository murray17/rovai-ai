import type { JSX, MouseEventHandler } from 'react'

type ComposerPrimaryActionProps = {
  action: 'send' | 'stop'
  busy: boolean
  disabled: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  type: 'button' | 'submit'
}

export function ComposerPrimaryAction({
  action,
  busy,
  disabled,
  onClick,
  type
}: ComposerPrimaryActionProps): JSX.Element {
  const label = action === 'stop'
    ? busy ? '正在提交停止请求' : '停止当前执行'
    : busy ? '正在发送消息' : '发送消息'

  return (
    <button
      className={`composer-primary-action is-${action}`}
      type={type}
      aria-label={label}
      title={label}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="composer-primary-action-icon" aria-hidden="true">
        {busy && <span className="composer-primary-action-spinner" />}
        {action === 'stop'
          ? (
              <svg className="composer-primary-action-glyph" viewBox="0 0 20 20">
                <rect className="composer-primary-action-stop-square" x="5.5" y="5.5" width="9" height="9" rx="1.4" />
              </svg>
            )
          : (
              <svg className="composer-primary-action-glyph" viewBox="0 0 20 20">
                <path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
              </svg>
            )}
      </span>
    </button>
  )
}
