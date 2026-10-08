import type { AdapterKind } from '@contracts'
import antigravityLogo from './assets/runtime-logos/antigravity-color.svg'
import claudeCodeLogo from './assets/runtime-logos/claudecode-color.svg'
import codeBuddyLogo from './assets/runtime-logos/codebuddy-color.svg'
import codexLogo from './assets/runtime-logos/codex-color.svg'
import copilotLogo from './assets/runtime-logos/copilot-color.svg'
import cursorLogo from './assets/runtime-logos/cursor.svg'
import grokLogo from './assets/runtime-logos/grok.svg'
import deepseekLogo from './assets/runtime-logos/deepseek-color.svg'
import clineLogo from './assets/runtime-logos/cline.svg'
import zcodeLogo from './assets/runtime-logos/zcode.png'
import kiroLogo from './assets/runtime-logos/kiro-color.svg'
import kimiLogo from './assets/runtime-logos/kimi.svg'
import openCodeLogo from './assets/runtime-logos/opencode.svg'
import piLogo from './assets/runtime-logos/pi.svg'
import qoderLogo from './assets/runtime-logos/qoder-color.svg'
import qwenLogo from './assets/runtime-logos/qwen-color.svg'
import traeLogo from './assets/runtime-logos/trae-color.svg'

const PRODUCT_RUNTIMES: AdapterKind[] = [
  'claude-code-cli',
  'codex-cli',
  'copilot-cli',
  'opencode-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'cursor-agent',
  'kimi-code-cli',
  'grok-build',
  'deepseek-harness',
  'cline-cli',
  'command-code-cli',
  'zcode-app',
  'antigravity-app',
  'pi'
]

export const VISIBLE_PRODUCT_RUNTIMES: AdapterKind[] = PRODUCT_RUNTIMES.filter(
  (runtimeKind) => runtimeKind !== 'cursor-agent' && runtimeKind !== 'cline-cli'
)

export const PRODUCT_RUNTIME_LOGOS: Record<AdapterKind, string> = {
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
  'deepseek-harness': deepseekLogo,
  'cline-cli': clineLogo,
  'command-code-cli': new URL('./assets/runtime-logos/command-code.ico', import.meta.url).href,
  'zcode-app': zcodeLogo,
  'antigravity-app': antigravityLogo
}

export function adapterLabel(kind: AdapterKind): string {
  return {
    'codex-cli': 'Codex CLI',
    pi: 'PI',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi Code',
    'grok-build': 'Grok Build',
    'deepseek-harness': 'DeepSeek Harness',
    'cline-cli': 'Cline',
    'command-code-cli': 'Command Code',
    'zcode-app': 'ZCode',
    'antigravity-app': 'Antigravity'
  }[kind]
}
