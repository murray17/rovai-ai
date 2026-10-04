import type { CSSProperties } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { AdapterKind } from '@contracts'
import {
  PRODUCT_RUNTIME_LOGOS,
  VISIBLE_PRODUCT_RUNTIMES,
  adapterLabel
} from './runtime-products'
import { UiText , uiAttribute } from './interface-language'

export function RuntimeGlyph({
  kind
}: {
  kind: AdapterKind | '' | null
}): React.JSX.Element {
  const monochrome =
    kind && ['opencode-cli', 'cursor-agent', 'grok-build', 'pi'].includes(kind)
  const surface =
    kind && ['qwen-code', 'qoder-cli', 'kimi-code-cli'].includes(kind)
  return (
    <span
      className={`member-runtime-glyph ${surface ? 'needs-surface' : ''}`}
      aria-hidden="true"
    >
      {kind ? (
        monochrome ? (
          <span
            className="member-runtime-logo-mask"
            style={
              {
                '--runtime-logo': `url("${PRODUCT_RUNTIME_LOGOS[kind]}")`
              } as CSSProperties
            }
          />
        ) : (
          <img src={PRODUCT_RUNTIME_LOGOS[kind]} alt="" draggable={false} />
        )
      ) : (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <rect x="3" y="3" width="14" height="14" rx="4" />
          <path d="M6 10h8" />
        </svg>
      )}
    </span>
  )
}

export function MemberRuntimePicker({
  id,
  value,
  disabled,
  isDisabled,
  onChange
}: {
  id: string
  value: AdapterKind | ''
  disabled: boolean
  isDisabled(kind: AdapterKind): boolean
  onChange(kind: AdapterKind | ''): void
}): React.JSX.Element {
  const label = value ? adapterLabel(value) : uiAttribute('暂不配置')
  return (
    <div className="member-editor-field member-runtime-picker-field">
      <label className="member-editor-field-label" htmlFor={id}><UiText zh={"智能体类型"} /></label>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            id={id}
            data-member-runtime-select
            type="button"
            className="member-runtime-picker"
            disabled={disabled}
            aria-label={uiAttribute("智能体类型，{0}", String(label))}
          >
            <RuntimeGlyph kind={value} />
            <span>{label}</span>
            <svg
              className="member-runtime-chevron"
              aria-hidden="true"
              viewBox="0 0 16 16"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            className="runtime-model-picker-menu runtime-parameter-picker-menu member-runtime-menu"
            align="start"
            sideOffset={5}
            collisionPadding={10}
            loop
          >
            <Menu.RadioGroup className="runtime-picker-options"
              value={value || '__none__'}
              onValueChange={(next) =>
                onChange(next === '__none__' ? '' : (next as AdapterKind))
              }
            >
              <div className="runtime-picker-scroll">{(['', ...VISIBLE_PRODUCT_RUNTIMES] as const).map((kind) => (
                <Menu.RadioItem
                  key={kind}
                  textValue={kind ? adapterLabel(kind) : uiAttribute("暂不配置")}
                  disabled={Boolean(kind && isDisabled(kind))}
                  value={kind || '__none__'}
                  className="runtime-model-picker-item member-runtime-menu-item"
                >
                  <RuntimeGlyph kind={kind} />
                  <span className="runtime-model-picker-copy"><strong>{kind ? adapterLabel(kind) : uiAttribute("暂不配置")}</strong></span>
                  <Menu.ItemIndicator className="runtime-model-picker-check">
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
                    </svg>
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}</div>
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
