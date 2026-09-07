// Permission keys, choice labels/order, recommended values and member defaults mirror
// crates/rovai-core/src/agent_runtime_adapter.rs. They are display fixtures, not a live probe.
// TRAE uses trae_static_permission_options; a real session may return an updated mode catalog.
const option = (
  key,
  choices,
  recommendedValue,
  scope = 'host',
  risk = 'elevated'
) => ({
  key,
  label: key,
  description: '',
  valueType: 'enum',
  choices: choices.map((choice) =>
    typeof choice === 'string'
      ? { value: choice, label: choice }
      : { value: choice[0], label: choice[1] }
  ),
  recommendedValue,
  scope,
  risk,
  supported: true,
  required: true,
  unsupportedReason: null
})
export const nativePermissions = {
  'codex-cli': [
    option(
      'sandbox_mode',
      [
        'read-only',
        'workspace-write',
        ['danger-full-access', 'danger-full-access (no sandbox)']
      ],
      'workspace-write',
      'session'
    ),
    option(
      'approval_policy',
      ['untrusted', 'on-request', ['never', 'never (no approval prompts)']],
      'on-request',
      'session'
    )
  ],
  'claude-code-cli': [
    option(
      'permission_mode',
      ['manual', 'acceptEdits', 'plan', 'dontAsk', 'auto', 'bypassPermissions'],
      'acceptEdits',
      'run'
    )
  ],
  'copilot-cli': [
    option('allow_all', ['off', ['on', 'on (no prompts)']], 'off')
  ],
  'opencode-cli': [
    option(
      'permission',
      [['allow', 'allow (no prompts)'], 'ask', 'deny'],
      'ask'
    )
  ],
  'kiro-cli': [
    option(
      'trust_all_tools',
      ['off', ['on', 'on (auto-approve all tools)']],
      'off',
      'host',
      'dangerous'
    )
  ],
  'qoder-cli': [
    option(
      'permission_mode',
      ['default', 'accept_edits', 'bypass_permissions', 'dont_ask', 'auto'],
      'default'
    )
  ],
  'codebuddy-cli': [
    option(
      'permission_mode',
      [
        'default',
        'acceptEdits',
        'bypassPermissions',
        'plan',
        'dontAsk',
        'auto'
      ],
      'default'
    )
  ],
  'qwen-code': [
    option('approval_mode', ['default', 'auto_edit', 'yolo', 'plan'], 'default')
  ],
  'trae-cn-cli': [
    option(
      'permission_mode',
      [
        'default',
        ['bypass_permissions', 'bypass_permissions (accept all tools)']
      ],
      'default'
    )
  ],
  'kimi-code-cli': [
    option(
      'permission_mode',
      ['default', 'plan', 'auto', 'yolo'],
      'default',
      'session',
      'dangerous'
    )
  ],
  'grok-build': [
    option(
      'permission_mode',
      [
        'default',
        'acceptEdits',
        'auto',
        'dontAsk',
        'bypassPermissions',
        'plan'
      ],
      'default',
      'host',
      'dangerous'
    )
  ],
  'antigravity-app': [
    option(
      'mode',
      ['accept-edits', ['plan', 'plan (read-only intent)']],
      'accept-edits',
      'run'
    ),
    option('sandbox', ['on', 'off'], 'on', 'run'),
    option(
      'dangerously_skip_permissions',
      ['off', ['on', 'on (auto-approve all tool requests)']],
      'off',
      'run',
      'dangerous'
    )
  ],
  pi: []
}
export const memberPermissionDefaults = {
  'codex-cli': { sandbox_mode: 'danger-full-access', approval_policy: 'never' },
  'claude-code-cli': { permission_mode: 'bypassPermissions' },
  'copilot-cli': { allow_all: 'on' },
  'opencode-cli': { permission: 'allow' },
  'kiro-cli': { trust_all_tools: 'on' },
  'qoder-cli': { permission_mode: 'bypass_permissions' },
  'codebuddy-cli': { permission_mode: 'bypassPermissions' },
  'qwen-code': { approval_mode: 'yolo' },
  'trae-cn-cli': { permission_mode: 'bypass_permissions' },
  'kimi-code-cli': { permission_mode: 'yolo' },
  'grok-build': { permission_mode: 'bypassPermissions' },
  'antigravity-app': {
    mode: 'accept-edits',
    sandbox: 'off',
    dangerously_skip_permissions: 'on'
  },
  pi: {}
}
