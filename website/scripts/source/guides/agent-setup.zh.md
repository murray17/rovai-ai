# 智能体接入与注意事项

各智能体的安装入口，以及账号、模型与工具配置的差异。Rovai 界面中的操作和字段说明见[智能体与模型配置](https://rovai.dev/zh/docs/agents.html)。

本文以 **Rovai v0.4.7** 为基础；在 Rovai 中选择 Pi 思考强度需要 **v0.4.8 或更新版本**。MiniMax Code 的适用版本见[对应章节](#minimax-code)。安装和登录在运行 Rovai Desktop 或 Server 的主机上完成。

在原生智能体中完成账号与模型配置后，到「设置 → 智能体」确认 Rovai 能找到它，再为队员选择智能体与模型。已有的登录和配置继续使用；通过浏览器访问时，使用的是服务主机上的安装。

## 支持的智能体 {#supported}

| 智能体 · 官方安装说明 | 本机入口 |
| --- | --- |
| [Codex CLI](https://github.com/openai/codex) | `codex` |
| [Claude Code](https://code.claude.com/docs/en/setup) | `claude` |
| [Pi Coding Agent](https://github.com/earendil-works/pi) | `pi` |
| [MiniMax Code](https://agent.minimax.io/docs/cli/quick-start)（[v0.4.13 起](#minimax-code)） | `mcode` |
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
| [ZCode](https://zcode.z.ai/en/docs/install) | 原生应用 |
| [Antigravity](https://antigravity.google/) | 应用附带的 CLI |

表中链接指向各产品的官方安装说明。Pi 需要 0.84.4 或更高的兼容版本，DSH 需要 0.1.5-rc.2 或更高的兼容版本，Grok 需要 1.0.0 或更高的兼容版本。Intel Mac 上的 ZCode 仍为预览；各系统的可用范围见[支持平台与智能体](https://rovai.dev/zh/docs/compatibility.html)。

## DSH：自定义模型与思考强度 {#dsh}

运行 `dsh web`，在 **Settings → Models** 中添加 Provider，填写 API 协议、地址、凭据和模型。使用标准 Web Profile 时，Rovai 可以补充读取这里配置的 `llm-pi-ai` 模型；回到队员配置中选择即可。两边需要使用同一个 `DSH_HOME`，未设置时为 `~/.dsh`。

### 为自定义模型声明思考档位

DSH 的模型选择器只展示模型已声明的档位。自带的 DeepSeek 模型已有 off / low / high / max；手动添加的模型通常没有这些声明，因此模型已经能用，却没有思考强度选项。

在 DSH 设置页使用 **Open configuration file** 打开当前配置。标准 `dsh web` 对应 `~/.dsh/profiles/web/cordis.patch.yml`；设置了 `DSH_HOME` 或使用自定义 Profile 时，路径随之变化。

找到 `llm-pi-ai` 的 `config.providers.<你的 Provider>.models`，在**已有的目标模型**下补充 `reasoningEfforts`。下面展示模型项的写法，保留该模型其他字段、其他模型与 Provider 配置：

```yaml
- id: your-model-id
  reasoningEfforts:
    off:
    low: low
    medium: medium
    high: high
    xhigh: xhigh
```

- 左侧是可选档位，右侧是传给上游的值。只保留该模型和 API 支持的档位；例如 `max: xhigh` 可把名为 max 的档位映射为 xhigh。
- `off:` 留空表示不发送强度参数，**不保证上游停止思考**。默认会思考的模型可能需要对应的兼容字段，例如 DeepSeek 的 `compat.thinkingFormat`。
- 保存后重新打开模型选择器。具体协议、档位与默认值的含义见 [DSH 官方模型配置说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md#reasoning-effort)和 [llm-pi-ai 配置参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)。

### 回到 Rovai 选择参数

在 Rovai 中选中**具体模型**，再查看它的模型参数。思考档位来自这一个 Provider + Model 的原生返回；切换模型后，选项也可能不同。“跟随模型默认值”沿用 DSH 的原生默认行为。

DSH Web 的默认模型与 ACP 入口的默认模型分别处理。想固定队员使用某个自定义模型时，在 Rovai 中显式选择并保存。修改配置后，重新选择模型或重开参数页会重新核对能力；如果读取失败，界面中的诊断与重试入口可用于定位问题。

### Web 配置的适用范围

Rovai v0.4.7 补充读取的是**标准 Web Profile** 的模型配置；同名 Provider 已有原生配置时优先使用原生配置。[dsh-model-thinking](https://github.com/cyberlieflife/dsh-model-thinking) 是第三方 Web 插件，添加后形成的自定义 Web bundle 不在这条补充路径的支持范围内。这份示例使用原生配置文件方式，完整边界见 [DSH 接入说明](https://github.com/murray17/rovai-ai/blob/v0.4.7/docs/architecture/runtime-catalog-boundaries.md#deepseek-harness-acp)。

## Codex 与 Claude Code 的账号、模型服务 {#native-settings}

这两种智能体默认沿用自己的登录、Provider 和模型配置。Rovai 中的「启动设置」用于选择程序路径；需要让不同队员连接不同服务时，可以在队员的「运行配置 → 环境变量」中分别填写连接参数，见[一个 CLI，多个 Provider](https://rovai.dev/zh/docs/multiple-providers.html)。

同时保留多个安装版本或配置目录时，Rovai 的程序路径和环境需要对应你已经登录的那一份。终端里能够运行、Rovai 却找不到程序时，可以在启动设置中填写可执行文件的绝对路径。

## Pi：模型与思考强度配置 {#pi}

### 配置模型

使用 Pi 内置 Provider 时，在 Pi 终端界面运行 `/login` 登录，再用 `/model` 选择模型。自定义服务（如 sub2api）在运行 Rovai 的主机上配置 `~/.pi/agent/models.json`。

下面以 GPT-6.1 Sol 为例。替换网关地址和 API Key；已有配置时，合并对应的 Provider、模型字段，保留其他内容。

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

### 配置思考强度

`reasoning: true` 声明模型支持思考；`thinkingLevelMap` 的左侧是 Pi 档位，右侧是传给上游的值，`null` 表示不提供该档位。上例提供 **low / medium / high / xhigh / max** 五档，其他模型按其实际支持情况填写。

保存后在 Pi 中重新打开 `/model` 加载配置，也可用 `/thinking` 选择强度。回到 Rovai 的**队员 → 运行配置**，打开模型选择器完成刷新，选择具体模型和思考强度，再保存。选择“跟随模型默认值”时，Rovai 不额外指定强度。

Pi 命令以 1.1.0 为例。[Pi 模型配置说明](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/models.md) · [GPT-6.1 Sol 档位说明](https://developers.openai.com/api/docs/models/gpt-6.1-sol)

## MiniMax Code：配置文件与思考强度 {#minimax-code}

本节针对独立的 **MiniMax Code（`@minimax-ai/code` / `mcode`）**，以 **0.6.12** 为例。官网下载的 **v0.4.13 已包含 MiniMax Code 接入**。原生配置文件的写法也可独立使用。

### 为已有自定义模型补充档位

先在 mcode 中完成 Provider 和模型配置。CLI 默认读取 `~/.minimax/config.yaml`；设置了 `MINIMAX_DATA_DIR` 时，使用该目录下的 `config.yaml`。配置应位于运行 Rovai Desktop 或 Server 的主机上，并与 Rovai 启动的 mcode 使用同一数据目录。[MiniMax CLI 配置说明](https://agent.minimax.io/docs/cli/configuration)

对已经接通的 Sub2API 等自定义服务，找到 `custom_provider.<Provider 键>.models.<模型 ID>`，合并以下字段。将 `sub2api` 和 `your-model-id` 换成已有的键；这是**局部片段，不是完整配置文件**，保留原有地址、密钥和其他模型字段：

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

- `reasoning: true` 声明支持思考；它本身不会提供强度选项。
- `thinking.effortOptions`：填写模型支持的思考强度，本例为 `low / medium / high / xhigh`。
- `thinking.defaultEffort` 是原生配置支持的可选默认字段，示例设为 `medium`。它不是当前会话选项；不要写成 `thinking.effort`。需要固定队员强度时，在 Rovai 中显式选择并保存。

官方 BYOK 指南说明了 `effortOptions`；`defaultEffort` 另见[官方配置类型](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/config.ts)。此处两个字段已在 mcode 0.6.12 核对。使用 `openai-responses` 的 Sub2API 时，普通强度值由 mcode 传入请求的 `reasoning.effort`；配置列表不会替上游实现新档位，仍应验证实际请求。[MiniMax 自定义模型配置指南](https://agent.minimax.io/docs/code/account/byok-agent-setup)

### 在 Rovai 中刷新并选择

保存文件后，打开 **队员 → 运行配置**，选择 **MiniMax Code**，打开模型选择器刷新目录，再选中对应 Provider 下的**具体模型**。该模型返回强度选项后，选择需要的档位并保存运行配置。

模型选“默认”时跟随 mcode 自身选择，不单独展示该模型的强度配置。选中具体模型后，思考强度选“跟随模型默认值”表示 Rovai 不额外指定档位。若自定义模型仍没有选项，先核对数据目录、Provider 与模型键，以及 `effortOptions` 是否写在目标模型下。

### MiniMax 官方模型有哪些区别？

官方模型使用原生提供的能力，不需要在 `custom_provider` 中复制一份。以本次核对的 mcode 0.6.12 目录为例：

| 模型选择器中的条目 | 思考配置 |
| --- | --- |
| `M3` / `M3 · thinking` | 分别为不思考和思考版本，没有分级强度 |
| `M2.7 · thinking` / `M2.7-highspeed · thinking` | 固定思考，没有分级强度 |
| `M3.1-Flash-Preview · thinking` | 提供 `default / low / medium / high / xhigh / max` |

“支持思考”不等于“支持强度选择”。官方模型目录会更新，以当前具体条目返回的选项为准；不要为没有分级能力的模型手工补出档位。[官方模型目录定义](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/config/src/minimax-model-catalog.ts)

## Kilo：模型与思考强度配置 {#kilo}

以下以 Kilo CLI **7.8.27** 为例；在 Rovai 中使用时，需安装能够选择 Kilo 的版本。
先在 Kilo 中接通 Provider 和模型。运行 `kilo debug paths` 查看配置目录，编辑其中的 `kilo.jsonc`
（通常为 `~/.config/kilo/kilo.jsonc`）。

对 Sub2API 等自定义服务，在已有的 `provider.<Provider 键>.models.<模型 ID>` 下合并以下字段，保留原有连接信息和其他模型字段：

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

`options.reasoningEffort` 是模型默认值；`variants` 的键是可选档位，内部字段是对应的原生参数。
只填写该模型和 API 实际支持的档位；原生已提供档位的模型不需要复制配置。
保存后，在 Rovai 打开模型列表刷新，选择具体模型、思考强度并保存。“跟随模型默认值”不增加强度覆盖。

权限在同一文件的 `permission` 中配置，例如 `"permission": "ask"`。
`allow` 自动允许、`ask` 询问、`deny` 拒绝，也可按工具和 Agent 分别设置。
Rovai 的“原生规则”是只读展示，审批仍由 Kilo 发起；修改配置后重新启动 Kilo 会话。
[Kilo 自定义模型说明](https://kilo.ai/docs/code-with-ai/agents/custom-models) · [Kilo 权限说明](https://kilo.ai/docs/getting-started/settings/auto-approving-actions)

## 接入新智能体 {#adding-agents}

Rovai 通过原生结构化协议或 ACP 对接编程智能体。新增适配涉及会话、执行事件、模型、工具与权限等能力；现有实现、代码入口和当前缺口汇总在[智能体接入](https://github.com/murray17/rovai-ai/blob/main/contributing/agent-integrations.zh-CN.md)。

[本地开发](https://github.com/murray17/rovai-ai/blob/main/docs/development/README.md) · [接入 Checklist](https://github.com/murray17/rovai-ai/blob/main/docs/development/runtime-integration-checklist.md)
