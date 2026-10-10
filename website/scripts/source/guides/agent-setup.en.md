# Agent setup and notes

Installation links and agent-specific account, model and tool settings. For Rovai’s interface and field descriptions, see [Agents and model configuration](https://rovai.dev/docs/agents.html).

This guide covers **Rovai v0.4.7**. Install and authenticate agents on the host running Rovai Desktop or Server.

After configuring the agent’s account and models, find it in Settings → Agents, then select it for a teammate. Existing native credentials and configuration are reused. Browser access uses the installation on the server host.

## Supported agents {#supported}

| Agent · official installation guide | Host entry point |
| --- | --- |
| [Codex CLI](https://github.com/openai/codex) | `codex` |
| [Claude Code](https://code.claude.com/docs/en/setup) | `claude` |
| [Pi Coding Agent](https://github.com/earendil-works/pi) | `pi` |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `dsh` |
| [OpenCode](https://opencode.ai/docs/) | `opencode` |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) | `copilot` |
| [Kiro CLI](https://kiro.dev/docs/cli/) | `kiro-cli` |
| [Qoder CLI](https://docs.qoder.com/cli/quick-start) | `qodercli` |
| [CodeBuddy CLI](https://www.codebuddy.ai/docs/cli/quickstart) | `codebuddy` |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | `qwen` |
| [TRAE CLI CN](https://www.trae.cn/) | `traecli` |
| [Kimi Code](https://github.com/MoonshotAI/kimi-cli) | `kimi` |
| [Grok Build](https://docs.x.ai/build/overview) | `grok` |
| [ZCode](https://zcode.z.ai/en/docs/install) | Native application |
| [Antigravity](https://antigravity.google/) | CLI bundled with the application |

The links lead to official installation guides. Pi requires a compatible version at or above 0.84.4, DSH at or above 0.1.5-rc.2, and Grok at or above 1.0.0. ZCode on Intel Macs remains a preview. See [Platforms and Agents](https://rovai.dev/docs/compatibility.html) for availability by operating system.

## DSH: custom models and reasoning effort {#dsh}

Run `dsh web` and add a provider in **Settings → Models**, including its API protocol, endpoint, credentials and models. Rovai can supplement its catalog with `llm-pi-ai` models configured in the standard Web Profile. Select the model in teammate settings. Both processes need the same `DSH_HOME`, which defaults to `~/.dsh`.

### Declare reasoning levels for a custom model

DSH shows effort options only when the model declares them. Its native DeepSeek models already offer off / low / high / max. Manually added models usually lack these declarations, so a model can work while showing no effort selector.

Use **Open configuration file** in DSH settings. With standard `dsh web`, the file is `~/.dsh/profiles/web/cordis.patch.yml`; a different `DSH_HOME` or profile changes that location.

Find `llm-pi-ai` → `config.providers.<your-provider>.models` and add `reasoningEfforts` to the **existing target model**. This is a model-entry example; retain its other fields, other models and provider configuration:

```yaml
- id: your-model-id
  reasoningEfforts:
    off:
    low: low
    medium: medium
    high: high
    xhigh: xhigh
```

- Keys are selectable levels; values are sent to the upstream API. Keep only supported levels. For example, `max: xhigh` maps the max level to the wire value xhigh.
- Empty `off:` omits the effort parameter. **It does not necessarily disable thinking.** Models that think by default may need compatibility settings such as DeepSeek’s `compat.thinkingFormat`.
- Save and reopen the model picker. Protocol-specific behavior and defaults are covered in the [official DSH provider guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md#reasoning-effort) and [llm-pi-ai reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md).

### Select the parameters in Rovai

Select a **specific model** in Rovai and open its parameters. The effort choices come from that Provider + Model’s native response and may change when switching models. Model default follows DSH’s native behavior.

DSH Web and the ACP entry point have separate default model selections. Explicitly choose and save a model in Rovai when a teammate should use it. After changing configuration, selecting the model or reopening its parameter page rechecks its capabilities. Failed reads expose diagnostics and a retry action.

### Web configuration scope

Rovai v0.4.7 supplements models from the **standard Web Profile**. Existing native provider configuration takes priority over a Web provider with the same name. [dsh-model-thinking](https://github.com/cyberlieflife/dsh-model-thinking) is a third-party Web plugin; a custom Web bundle created by adding it falls outside this supplementary path. This example uses native configuration files. See the [DSH integration notes](https://github.com/murray17/rovai-ai/blob/v0.4.7/docs/architecture/runtime-catalog-boundaries.md#deepseek-harness-acp) for the complete scope.

## Codex and Claude Code accounts and providers {#native-settings}

These agents use their native sign-in, provider and model configuration. Rovai’s startup settings cover executable paths and child-process environment. Accounts, keys and gateway endpoints are managed in the native agent.

With multiple installations or configuration directories, Rovai should launch the one you authenticated. If the terminal finds the program but Rovai does not, set its absolute executable path in startup settings.

## Pi models and tools {#pi}

Pi’s model catalog comes from its configured providers. Add providers or models in Pi, then select them in Rovai. The extension shipped with Rovai loads during execution; there are no extension files to copy manually.

The current Pi adapter does not provide external MCP assignment. Native Skills, extensions and Rovai collaboration tools retain their respective entry points. See [Skills](https://rovai.dev/docs/skills.html) and [MCP](https://rovai.dev/docs/mcp.html).

## Adding a new agent {#adding-agents}

Rovai connects coding agents through native structured protocols or ACP. A new adapter covers sessions, execution events, models, tools and permissions. [Agent integration](https://github.com/murray17/rovai-ai/blob/main/contributing/agent-integrations.md) collects existing implementations, source entry points and current gaps.

[Local development](https://github.com/murray17/rovai-ai/blob/main/docs/development/README.md) · [Integration checklist](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md)
