# Agent setup and notes

Installation links and agent-specific account, model and tool settings. For Rovai’s interface and field descriptions, see [Agents and model configuration](https://rovai.dev/docs/agents.html).

This guide uses **Rovai v0.4.7** as its baseline; selecting Pi thinking levels in Rovai requires **v0.4.8 or later**. See the [MiniMax Code section](#minimax-code) for its version scope. Install and authenticate agents on the host running Rovai Desktop or Server.

After configuring the agent’s account and models, find it in Settings → Agents, then select it for a teammate. Existing native credentials and configuration are reused. Browser access uses the installation on the server host.

## Supported agents {#supported}

| Agent · official installation guide | Host entry point |
| --- | --- |
| [Codex CLI](https://github.com/openai/codex) | `codex` |
| [Claude Code](https://code.claude.com/docs/en/setup) | `claude` |
| [Pi Coding Agent](https://github.com/earendil-works/pi) | `pi` |
| [MiniMax Code](https://agent.minimax.io/docs/cli/quick-start) ([v0.4.13+](#minimax-code)) | `mcode` |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `dsh` |
| [OpenCode](https://opencode.ai/docs/) | `opencode` |
| [Kilo CLI](https://kilo.ai/docs/code-with-ai/platforms/cli) | `kilo` |
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

These agents use their native sign-in, provider and model configuration by default. Rovai’s startup settings select the executable path. To connect teammates to different services, set each teammate's connection details under **Run configuration → Environment variables**. See [One CLI, multiple providers](https://rovai.dev/docs/multiple-providers.html).

With multiple installations or configuration directories, Rovai should launch the one you authenticated. If the terminal finds the program but Rovai does not, set its absolute executable path in startup settings.

## Pi: model and thinking-level configuration {#pi}

### Configure models

For Pi’s built-in providers, run `/login` in Pi’s terminal interface to sign in, then use `/model` to select a model. Configure custom services such as sub2api in `~/.pi/agent/models.json` on the host running Rovai.

This example uses GPT-6.1 Sol. Replace the gateway URL and API key. If the file already exists, merge the relevant provider and model fields while retaining the rest of your configuration.

```json
{
  "providers": {
    "sub2api": {
      "api": "openai-responses",
      "baseUrl": "https://gateway.example/v1",
      "apiKey": "YOUR_API_KEY",
      "models": [{
        "id": "gpt-6.1-sol",
        "reasoning": true,
        "thinkingLevelMap": {
          "off": null, "minimal": null,
          "low": "low", "medium": "medium",
          "high": "high", "xhigh": "xhigh",
          "max": "max"
        }
      }]
    }
  }
}
```

### Configure thinking levels

`reasoning: true` declares that the model supports thinking. In `thinkingLevelMap`, keys are Pi levels, values are sent to the upstream API, and `null` disables a level. This example offers **low / medium / high / xhigh / max**. For other models, use the levels they actually support.

After saving, reopen `/model` in Pi to load the configuration; use `/thinking` to choose a level. In Rovai, open **Teammates → Agent configuration**, open the model picker to refresh the catalog, select a specific model and thinking level, then save. With **Model default**, Rovai does not explicitly set a thinking level.

The Pi commands refer to version 1.1.0. [Pi model configuration](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/models.md) · [GPT-6.1 Sol reasoning levels](https://developers.openai.com/api/docs/models/gpt-6.1-sol)

## MiniMax Code: configuration files and thinking levels {#minimax-code}

This section covers the standalone **MiniMax Code (`@minimax-ai/code` / `mcode`)**, using **0.6.12**. The **v0.4.13 download includes MiniMax Code integration**. The native configuration instructions can also be used independently.

### Add levels to an existing custom model

Configure the provider and model in mcode first. The CLI normally reads `~/.minimax/config.yaml`. If `MINIMAX_DATA_DIR` is set, use `config.yaml` inside that directory. Edit the file on the host running Rovai Desktop or Server, using the same data directory as the mcode instance launched by Rovai. [MiniMax CLI configuration](https://agent.minimax.io/docs/cli/configuration)

For a working custom service such as Sub2API, find `custom_provider.<provider-key>.models.<model-id>` and merge these fields. Replace `sub2api` and `your-model-id` with the existing keys. This is a **partial fragment, not a complete configuration file**; retain the endpoint, credentials and other model fields:

```yaml
custom_provider:
  sub2api:
    models:
      your-model-id:
        reasoning: true
        thinking:
          effortOptions: [low, medium, high, xhigh]
          defaultEffort: medium
```

- `reasoning: true` declares thinking support; it does not supply a list of levels.
- `thinking.effortOptions`: the model's supported thinking levels; this example lists `low / medium / high / xhigh`.
- `thinking.defaultEffort` is an optional native default, set to `medium` here. It is separate from a conversation selection; do not use `thinking.effort`. To pin a teammate's level, explicitly select and save it in Rovai.

The official BYOK guide documents `effortOptions`; see the [official configuration types](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/config.ts) for `defaultEffort`. Both fields were checked with mcode 0.6.12. For Sub2API using `openai-responses`, mcode sends ordinary levels in `reasoning.effort`. Declaring a level does not implement it upstream, so verify an actual request. [MiniMax custom model setup guide](https://agent.minimax.io/docs/code/account/byok-agent-setup)

### Refresh and select in Rovai

Save the file, open **Teammates → Run configuration**, choose **MiniMax Code**, and open the model picker to refresh the catalog. Select the **specific model** under the intended provider. When it reports effort options, choose a level and save the run configuration.

Selecting the default model follows mcode's model choice without a separate effort setting. After selecting a specific model, **Model default** for thinking effort means Rovai sends no explicit level. If a custom model still has no options, check the data directory, provider and model keys, and that `effortOptions` is nested under the intended model.

### How do MiniMax's official models differ?

Official models use their native capabilities; they do not need a copy under `custom_provider`. The catalog checked with mcode 0.6.12 exposed:

| Model picker entry | Thinking control |
| --- | --- |
| `M3` / `M3 · thinking` | Thinking off / on variants, without graded effort |
| `M2.7 · thinking` / `M2.7-highspeed · thinking` | Fixed thinking, without graded effort |
| `M3.1-Flash-Preview · thinking` | `default / low / medium / high / xhigh / max` |

Thinking support does not necessarily include effort selection. The official catalog can change; use the options reported by the selected entry, and do not invent levels for models without that capability. [Official model catalog definitions](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/minimax-model-catalog.ts)

## Kilo: models and reasoning effort {#kilo}

This example uses Kilo CLI **7.8.27**. In Rovai, use a version that offers Kilo in the Agent picker.
Configure the provider and model in Kilo first. Run `kilo debug paths` to find its config directory,
then edit `kilo.jsonc` there (usually `~/.config/kilo/kilo.jsonc`).

For a custom service such as Sub2API, merge these fields into the existing `provider.<provider-key>.models.<model-id>` entry. Keep the connection settings and other model fields:

```json
{
  "options": { "reasoningEffort": "high" },
  "variants": {
    "low": { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high": { "reasoningEffort": "high" },
    "xhigh": { "reasoningEffort": "xhigh" }
  }
}
```

`options.reasoningEffort` sets the model default. The `variants` keys are selectable levels; their contents supply the native parameters.
Declare only levels supported by the model and API. Models that already advertise variants need no duplicate configuration.
Save the file, refresh Rovai's model list, select the specific model and reasoning level, then save. Following the model default adds no effort override.

Configure permissions in the same file under `permission`, for example `"permission": "ask"`.
`allow` runs automatically, `ask` requests approval, and `deny` blocks execution. Rules can differ by tool and Agent.
Rovai shows a read-only **Native rules** field and forwards Kilo's approval requests. Restart the Kilo session after editing.
[Kilo custom models](https://kilo.ai/docs/code-with-ai/agents/custom-models) · [Kilo permissions](https://kilo.ai/docs/getting-started/settings/auto-approving-actions)

## Adding a new agent {#adding-agents}

Rovai connects coding agents through native structured protocols or ACP. A new adapter covers sessions, execution events, models, tools and permissions. [Agent integration](https://github.com/murray17/rovai-ai/blob/main/contributing/agent-integrations.md) collects existing implementations, source entry points and current gaps.

[Local development](https://github.com/murray17/rovai-ai/blob/main/docs/development/README.md) · [Integration checklist](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md)
