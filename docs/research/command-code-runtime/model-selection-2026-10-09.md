---
document_type: runtime-research
runtime: command-code
authority: research-evidence-only
status: verified-with-native-limitations
observed_version: 1.74.1, 1.79.1
observed_platform: macos-arm64
last_updated: 2026-10-09
---

# Command Code BYOK 模型选择：原生 CLI、ACP 与跨 Runtime 对照

Command Code **1.74.1 和 1.79.1 均复现上游 ACP 缺口**：原生 CLI 能列出和选择自定义 BYOK 模型，
ACP 的 `availableModels` 与 `configOptions` 没有它们，`session/set_model` 和
`session/set_config_option` 都返回 `-32602 Unknown model`。即使提交当前正在成功使用的 BYOK ID，也会拒绝。
默认 BYOK 可以运行，不代表显式选择可用。Rovai 保留原生默认哨兵，不伪造目录、不改写原生二进制。

## 安装和测试边界

| 安装 | 本轮用途 |
| --- | --- |
| `/opt/homebrew/bin/command-code`，npm 1.66.0 | 日常 PATH 检查；此版本没有本轮所需官方 ACP。未升级或更换日常安装。 |
| 此前验收保留的官方 npm `command-code@1.74.1` | 沿用已有验收安装；直接运行其 `dist/cli.mjs`。 |
| 官方 npm `command-code@1.79.1` | 独立自动验收目录安装的当前发布版；未写入 Rovai 日常程序设置。 |
| `/Users/murray.xue/.opencode/bin/opencode`，1.18.32 | 当前安装，官方 ACP。 |
| `/opt/homebrew/bin/pi`，0.84.4 | 当前安装，原生 JSONL RPC。 |

Command 1.74.1 `cli.mjs` SHA-256：`a0727482bfd108c6bae498bc7ce29938e9d975244ee7776e505a9e61a0fda082`。
1.79.1：`3193c12205bc9c03ae33b7676e7b840dd9d4ae1af955558470d147da50e7705a`。
1.79.1 官方 tarball SHA-256：`55ed3d986070d8b1b749dcb8b47e2daacc877616f284ae4dde47c0d9fa20490b`。

所有进程在新 Home、工作区和原生状态目录内运行。控制测试仅访问 loopback Provider，使用合成 Key；
Command 引用此前授权的原生 `auth.json` 满足其自身登录要求，文件内容未变。
真实 BYOK 使用此前授权的 `sub2api/gpt-6-sol` 来源，原生读取已有 Provider/Key 引用；源文件未变。
没有调用模型 SDK、第三方 ACP bridge 或替代任务后端；本轮是原生协议测试，**不算新的 Rovai App 全矩阵**。

## 本地 Provider 路由对照

[可重复夹具](fixtures/model_selection_probe.py)启动真实 CLI，只以 HTTP 服务替代收费模型。
两个 Provider 分别提供 `model-a` 与带斜杠的 `vendor/shared`，记录请求模型、端点路径和认证匹配布尔值。
不记录原始 Key、完整请求或 System 内容。

| 场景 | Command 1.74.1 | Command 1.79.1 | OpenCode 1.18.32 | Pi 0.84.4 |
| --- | --- | --- | --- | --- |
| 原生默认自定义模型发出请求 | 通过 | 通过 | 通过 | 通过 |
| 目录暴露自定义模型 | CLI 有，ACP 无 | CLI 有，ACP 无 | ACP configOptions 有 | RPC 有 |
| 显式选择当前自定义模型 | 两个 ACP 方法均拒绝 | 两个 ACP 方法均拒绝 | 两个方法均通过 | set_model 通过 |
| B/同名模型 → A/同名模型 | ACP 拒绝；CLI `--model` 路由正确 | 同左 | 端点、模型与认证均正确 | 端点、模型与认证均正确 |
| 带斜杠的原始模型 ID | CLI 正确保留；ACP 拒绝 | 同左 | 保留 `vendor/shared` | 保留 `vendor/shared` |
| 不存在的 Provider/模型 | 拒绝，后续仍用原模型 | 同左 | 拒绝，原选择不变 | 同左 |
| 第二 Session 与返回第一 Session | 默认请求正常 | 默认请求正常 | 选择保持独立 | 本轮未测第二进程并行 |
| cold 后请求 | 原默认模型正常 | 原默认模型正常 | 保留选中的模型 | 不带模型覆盖参数时保留选中模型 |

四组最终有效夹具分别记录 24、24、21、10 个步骤和 17、17、14、6 次 Provider 请求，
共 **54 次合成 Provider 请求**。步骤中包含预期失败，不能表述为 79 个成功 Run。
Command 两版本共 12 次已配置自定义 ID 选择被拒绝；另外各有两个不存在 ID 的负例。
原生 CLI 三个显式模型的进程均退出 0，请求实际分别到 A/model-a、B/vendor/shared、A/vendor/shared。

另测 1.79.1 无 Command 登录、仅有有效 BYOK 配置：CLI 能列出自定义模型，但 ACP `session/new`
返回 `-32000` 要求 `cmd login`，本次非交互 CLI 请求也退出 3，Provider 零调用。它是当前原生要求，
不是 Rovai 新加的 Key/账号字段门禁；未伪造登录、触发浏览器或切换计费来源。

初始控制夹具曾把 Key 字面值放入 Command 的 `apiKey`，收到其要求 `$ENV_VAR`/`!command` 引用的明确错误。
按官方格式修正为专用子进程环境引用后重测；初始错误轮不计入上述路由结果。Pi cold 则明确去掉启动
`--provider/--model` 覆盖参数，验证保存的选择，而不是用启动参数覆盖后误判恢复失败。

复现（输出目录必须尚不存在，程序必须为所需官方安装的绝对路径）：

```sh
python3 docs/research/command-code-runtime/fixtures/model_selection_probe.py \
  --runtime command --program /absolute/command-code/dist/cli.mjs \
  --auth-file /authorized/native/.commandcode/auth.json --out /new/private/command-probe
python3 docs/research/command-code-runtime/fixtures/model_selection_probe.py \
  --runtime opencode --program /absolute/opencode --out /new/private/opencode-probe
python3 docs/research/command-code-runtime/fixtures/model_selection_probe.py \
  --runtime pi --program /absolute/pi --out /new/private/pi-probe
```

## 已有真实 BYOK：六轮生成与恢复

两个 Command 版本分别完成 first、warm、cold 三轮真实 `sub2api/gpt-6-sol` 请求，共六轮 `end_turn`。
first/warm 为同 PID，cold 为新 PID、同原生 Session；cold 正确回忆首次随机 marker。
期间向两种 ACP 方法提交这个正在工作的模型 ID，均收到 `-32602`；后续真实请求仍正常。
`providers.json` 与 `auth.json` 源文件前后相同，`CMD_LOCAL_ONLY=1` 保留原生 BYOK 路径。

这证明既有默认路径可用、错误选择没有破坏该会话；不证明 ACP 已支持自定义模型切换，也不证明其他模型、
原生账号余额、真实刷新、并发刷新或全平台可用。OpenCode/Pi 本轮为合成 Provider 对照，未算真实模型验收。
脱敏逐步结果见 [JSON 证据](model-selection-2026-10-09.evidence.json)。

## 原因、联网核对与处理

官方发布包中 `availableModels()` 来自 `catalogModels()` 的内置目录，未合并有效 BYOK Provider。
两个 ACP 方法都进入 `switchModel()`，它先按该目录校验，随后才可能调用原生会话的模型切换。
因此更换 ACP 方法、手填完整 ID 或只扩充 Rovai 下拉菜单，都无法修复原生拒绝。

- [上游 #993](https://github.com/CommandCodeAI/command-code/issues/993)：2026-10-06 报告 macOS / 1.75.1 / T3 Code 的同类问题；本次查询仍开放，无修复评论。它是外部复现，与本轮独立验证相互印证。
- [官方 ACP 文档](https://commandcode.ai/docs/acp)：描述模型选择来自 Command Code catalog，选择属于 Session；不能据此推断包含所有用户 BYOK。
- [官方 BYOK 文档](https://commandcode.ai/docs/byok)：自定义模型使用完整 Provider 前缀，保留模型内的斜杠；文档的普通 CLI 能力不等于 ACP 能力。
- [官方 changelog](https://commandcode.ai/changelog)：1.74.0 引入官方 ACP；本次查看的后续公开条目没有给出该 BYOK 问题已修复的证据。发布版实测优先于推断。
- [ACP config options](https://agentclientprotocol.com/protocol/session-config-options)：按 Agent 声明的配置与可选值交付，不能自行声明原生支持的模型。
- [OpenCode Provider 文档](https://opencode.ai/docs/providers)与 [1.18.32 ACP 源码](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/opencode/src/acp/agent.ts)：作为共享 ACP 正向对照。
- [Pi 原生 RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)：模型选择与 Provider 分开；本轮命令格式另外按实际安装 0.84.4 的文档核对。

当前处理保持原生配置中的默认 BYOK，通过 Rovai 的“运行时默认”使用；显式选择仅展示 ACP 真正广告的模型。
不把 CLI 目录硬塞入 ACP，不以重启加 `--model` 冒充会话切换，不修改用户默认模型或日常安装来掩盖错误。
本轮未向上游提交 Issue/评论，也未更改 Command 的生产认证、MCP、Bootstrap 或 Host 生命周期。
此前 BYOK deferred MCP tools 未调用的问题仍独立保留，不能用本轮普通文本请求成功宣称修复。
