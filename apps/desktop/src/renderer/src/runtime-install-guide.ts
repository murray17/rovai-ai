import type { AdapterKind, HostPlatformKey } from '@contracts'

interface InstallMethod {
  name: string
  command: string
  prerequisite: string
  prerequisiteUrl: string
}

interface RuntimeInstallGuide {
  docs: string
  desktop?: boolean
  command?: string
  launch?: string
  connectModel?: boolean
  alternatives?: InstallMethod[]
}

const brew = (command: string): InstallMethod => ({
  name: 'Homebrew', command, prerequisite: '需先安装 Homebrew', prerequisiteUrl: 'https://brew.sh/zh-cn/'
})
const npm = (command: string): InstallMethod => ({
  name: 'npm', command, prerequisite: '需先安装 Node.js 和 npm', prerequisiteUrl: 'https://nodejs.org/zh-cn/download'
})

// Official installation instructions. Guidance never grants platform admission or executes commands.
const GUIDES: Partial<Record<AdapterKind, RuntimeInstallGuide>> = {
  'claude-code-cli': {
    docs: 'https://code.claude.com/docs/en/setup',
    command: 'curl -fsSL https://claude.ai/install.sh | bash', launch: 'claude',
    alternatives: [brew('brew install --cask claude-code')]
  },
  'codex-cli': {
    docs: 'https://github.com/openai/codex',
    command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', launch: 'codex',
    alternatives: [brew('brew install --cask codex'), npm('npm install -g @openai/codex')]
  },
  'opencode-cli': {
    docs: 'https://opencode.ai/docs/',
    command: 'curl -fsSL https://opencode.ai/install | bash', launch: 'opencode', connectModel: true,
    alternatives: [brew('brew install anomalyco/tap/opencode'), npm('npm install -g opencode-ai')]
  },
  'copilot-cli': { docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli' },
  'kiro-cli': { docs: 'https://kiro.dev/docs/cli/' },
  'qoder-cli': { docs: 'https://docs.qoder.com/cli/quick-start' },
  'codebuddy-cli': { docs: 'https://www.codebuddy.ai/docs/cli/quickstart' },
  'qwen-code': { docs: 'https://github.com/QwenLM/qwen-code' },
  'trae-cn-cli': { docs: 'https://www.trae.cn/' },
  'kimi-code-cli': { docs: 'https://github.com/MoonshotAI/kimi-cli' },
  'grok-build': { docs: 'https://docs.x.ai/build/overview' },
  'zcode-app': { docs: 'https://zcode.z.ai/en/docs/install' },
  'antigravity-app': { docs: 'https://antigravity.google/', desktop: true },
  pi: { docs: 'https://github.com/earendil-works/pi' }
}

export function runtimeInstallGuide(kind: AdapterKind, platform: HostPlatformKey | null): RuntimeInstallGuide | null {
  const guide = GUIDES[kind]
  if (!guide) return null
  if (platform === 'macos-arm64' || platform === 'macos-x64') return guide
  // Other admitted platforms use official instructions, never a macOS shell command.
  return { docs: guide.docs, desktop: guide.desktop }
}
