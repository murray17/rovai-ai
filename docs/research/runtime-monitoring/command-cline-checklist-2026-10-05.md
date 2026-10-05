---
document_type: runtime-research
authority: research-evidence-only
status: partial-verification
last_updated: 2026-10-05
---

# Command Code / Cline：14 轴差异与本轮修复

User 在消息 `677d610d-e4cf-4ffb-aba2-d4ebb021cbcd` 要求修复 Bootstrap、Command Code warm 和此前遗漏，
并按 [Runtime 接入 Checklist](../../development/runtime-integration-checklist.md) 完整对照。
本轮修复了 Cline compaction 策略遗漏及本地展示通路；**两者的 System Bootstrap 切换和 Command Code
官方 ACP 产品接入尚未完成**。原因和实际失败证据在下文，不把调查、官方能力或普通回复记作产品通过。

基线 `51357adb`；平台 macOS arm64；Cline 固定 3.0.65、真实 sub2api/gpt-6-sol；新调查的
Command Code 固定 1.74.1。旧 1.65.2/1.66.0 headless 成功证据只适用于该路径。
[脱敏证据](command-cline-checklist-2026-10-05.evidence.json)不包含凭据、配置正文、模型输入或工具结果。

## 已改的遗漏

1. `release_default_policy(ClineCli)` 虽声明 BestEffort，`POLICY_ADAPTERS` 却漏了 Cline。
   Core 启动不生成该策略，创建 Host 时最终回退 Disabled，observer lease 也不建立。
   现已把 Cline 纳入启动策略和 reconciliation；既有 accepted Binding 的 baseline 补发仍走共享规则。
2. Plugin 为同一次压缩的 started/completed 生成稳定 ID；跨 Run 重置、子 Agent 与迟到事件隔离。
   原生 `tokensBefore/tokensAfter/messagesBefore/messagesAfter` 仅投影明确数字，skipped/failed 不伪装完成。
3. Host 在现有数值轮询中投影压缩展示，终态兜底捕获；展示与 Bootstrap requirement 分离。
   关闭 detector 不隐藏已观察的压缩展示，只有完成信号推进补发。
   消费端验证 Host、Run、epoch、Session 和 Prompt，保留共享持久化的幂等及取消边界。

这些修复证明的是接线、归属和策略可用。真实模型预算探针仍未捕获 auto compaction 事件；
不能把正常回复或 token 变化算作完成压缩，manual/auto/overflow 后的连续性仍不通过。

## Bootstrap：有 System 接缝，尚缺可靠加载门禁

`first_payload` 当前把冻结 Bootstrap 放进首轮普通 user prompt，后续正常 warm/cold 仅发动态输入；
这与 OpenCode、Copilot 等现有 first-payload Adapter 的层级相同。Codex/Claude/Grok 使用 native append，
Pi/DeepSeek Harness 使用 managed system prompt。因此“与其他 Runtime 一致”不能简化成所有 Runtime 都有
同一种 System 字段。

Cline 真实探针将唯一 Rule 通过官方 `registerRule` 注册：

| 场景 | 模型调用前证据 | 原生结果 |
| --- | --- | --- |
| 正常 Rule | 独立 witness 在 `request.systemPrompt` 观察到测试 Bootstrap 恰好一次 | 真实模型返回指定 marker |
| Rule 文件不存在 | 同一 witness 观察到 Bootstrap 为零，模型仍被调用 | `end_turn`，回答 `ABSENT48` |
| Rule 函数抛错 | 未观察到 beforeModel witness | 原生错误退出该 Prompt；错误还包含 shutdown/run-in-progress 冲突 |

缺失插件的反例说明：普通文件存在检查和回复后校验不足以替代“原生必需插件已加载”的前置证明。
固定版本 [Plugin loader](https://github.com/cline/cline/blob/cli-v3.0.65/sdk/packages/core/src/extensions/plugin/plugin-loader.ts)
会收集加载错误后继续；[官方 Plugin 说明](https://github.com/cline/cline/blob/cli-v3.0.65/.agents/skills/cline-sdk/references/plugins/REFERENCE.md)
也明确这种继续行为。当前 ACP 没有已验证的 required-plugin readiness 接口。直接删掉 user 层 Bootstrap
会产生无 Charter/Identity 的真实调用，故本轮没有开启该切换。User 已授权推进修复，剩余阻碍是加载门禁，
不是等待重复确认。另查当日 npm 最新 3.0.68：其 ACP Agent 与 Plugin loader 源文件和 3.0.65 字节一致；没有通过升级版本绕过此反例的依据。

Command Code 的 `appendSystemPrompt` 也属于可选 Mod。1.74.1 发布包的 `runAppendSystemPrompt`
仍捕获回调错误后继续；旧版本的真实/fixture 负向证据见
[原生研究](../command-code-runtime/README.md)。只有把 Mod 写出来不构成 System Bootstrap 修复。
未修改共享 AGENTS.md、未静默替换原生 system prompt，也未改用另一套 Cline SDK Host。

## Command Code：官方 ACP 已存在，但迁移有真实阻碍

[官方 ACP](https://commandcode.ai/docs/acp) 现在提供 `command-code acp`。
1.74.1 的真实 initialize 宣告 load/resume/list/close，且同一 PID 下成功执行了 A→B→A 的原生 `/acp` 命令，
A 切回时原生 UUID 不变。这是常驻、多 Session 控制面的实测，纠正“Command Code 原生只能 one-shot”的旧判断；
它没有调用模型，不证明模型历史连续性或 Rovai Fleet 已接入。

真实生成尝试发现：

- `session/new` 的目录没有已配置的 `sub2api/gpt-6-sol`；`session/set_model` 返回 `-32602 / Unknown model`。
  CLI 的 `--model sub2api/gpt-6-sol` 也没有选择该模型。不能静默回退另一模型后报成功。
- 明确改用原生账号的默认模型 `deepseek/deepseek-v4-flash`，Provider 返回 HTTP 400、余额不足；
  再试目录中的 `poolside/laguna-s-2.1-free` 仍相同。原生账号额度是实际生成、warm 和 compact 验收的当前外部阻碍。
- `/acp` 后确实返回标准 `usage_update {used:0,size:1000000}`，所以**新 ACP 路径能报告 context 上限**。
  这是该原生默认模型、未生成状态的观测；不能拿来替代旧 headless BYOK 的 272k 配置窗口，也不是新的真实 Run 用量。
- 原生 ACP MCP 同名时 native 配置优先；Rovai 要求整份 Assignment 优先。正式迁移前必须解决此冲突，
  不能认为标准 ACP 的 `mcpServers` 字段已经保证投影语义相同。

## 按 Checklist 完整对照

“已有路径”描述当前 Core 的标准/代表实现，不声称其他每个 Runtime、每个平台均完成所有验收。
`部分` 表示具体子项已有证据，整轴仍不能通过 First-Class；未知不等同上游 Unsupported。

| Checklist 能力轴 | 已有 Runtime 的标准或代表实现 | Cline 当前事实 | Command Code 当前事实 |
| --- | --- | --- | --- |
| Auth / Provider / Model | 自身原生配置；默认/显式模型核对；变化后失效旧 Host/Binding | **部分**：原生 BYOK、真实默认模型、配置摘要已实现；显式切换/凭据轮换矩阵待验 | **部分/阻断**：headless BYOK 真实可用；新 ACP 拒绝自定义模型，原生账号余额不足；产品配置接线未实现 |
| Host / Fleet / LRU | ACP、Codex、Pi 等复用受管 Host；Claude 等允许 one-shot resumable | **部分**：共享 Fleet、真实 warm、A→B→A 已过；LRU 压力/运行中 shutdown 待验 | **未实现**：旧 transport one-shot；新官方 ACP 已实测常驻控制面，尚未接入 Fleet，不能报产品 warm |
| Native Session / Continuation | 完整 ID；warm、cold、Core 重启；错误恢复与 replay 隔离 | **部分**：原生 exact load 和 App/Core cold ID/Binding/generation 保留已过；失败矩阵待补 | **部分**：旧 headless UUID 恢复真实通过；新 ACP 模型 warm/cold、Core Binding 尚未通过 |
| Bootstrap / Context | native append、managed system、first payload 三类并存；共享冻结输入 | **未完成目标**：仍 first_payload；System Rule 正向通过、插件缺失反例阻断切换 | **未完成目标**：staged first_payload；可选 Mod 失败后继续；无 Product Binding/System 门禁 |
| Compaction continuity | protected system 或合格信号后的下一输入补发；需分别验证 manual/threshold/overflow/retry | **本轮修接线，整轴未过**：策略/lease 和数值展示已补；ACP `/compact` 被当普通文本，自动/溢出未观测 | **部分**：旧 headless manual compact 后恢复真实过；新 ACP 公布 `/compact`，但真实生成额度阻断，Core detector 未接 |
| Skills | 当前平台/工具箱索引、原生文件发现；更新、撤销、同名与相邻成员隔离 | **部分**：现行索引/原生发现接线，真实读取通过；完整更新撤销/并发矩阵待补 | **未实现产品投递**：官方有原生 Skill，不能借用通用基础设施宣称通过 |
| External MCP | Session/Run 投影；整份同名覆盖；追加/更新/撤销/隔离 | **部分**：ACP 忽略 session MCP，现用 Host 私有官方 config；App 分配、调用、更新、撤销、隔离通过；并发/HTTP 待验 | **阻断产品迁移**：旧私有 Home fixture 隔离；新 ACP 有 stdio/http，但 native 同名优先与 Rovai 合同冲突 |
| Tool / Action / Command Output | 原生 call ID、准确路径、生命周期、stdout/stderr/退出码、Diff 证据分级 | **部分**：App read/edit 路径、可点击增删、失败、非零、空输出过；编辑片段为 reported mutation；超大输出和部分 editor 路径待验 | **仅内部接线**：headless read/edit/command 真实过，路径和 reported mutation 已归约；无 Command Code App 行/点击验收；ACP 工具未实测 |
| Narration / Final / Missing-Send | 思考私有；显式 send；唯一 final；zero-send 才按合格终态恢复 | **部分**：App 显式发送及 zero-send 恢复真实通过，无重复公开消息 | **产品未实现**：headless result/assistant 已解析；尚无 AgentRun terminal/Missing-Send 产品闭环 |
| Permission / Approval / Workspace | 单一原生审批权威；allow/deny/cancel；目录授权边界 | **部分**：原生拒绝无副作用、Core cancel 通过；产品 allow/deny 交互完整矩阵待验 | **部分**：headless dont-ask 与 yolo 真实过；ACP 公布 permission 往返，但尚无 Core/App 审批资格；不能把 Mod 当唯一 gate |
| Built-in rovai CLI | 受管进程配置、当前 Run lease、结束解除、公开发送去重 | **已有主路径证据**：App first/warm/第二队员/cold 真实显式回帖通过；本轮新包再验 | **产品未实现**：没有 Command Code AgentRun lease/真实 App 发送证据，两个保留测试队员均为 Cline |
| Usage / Cache / Cost | 逐调用消费与最新 Session Context 分离；原生字段；未知保留 NULL | **部分**：四桶、可选 reasoning、live used、配置窗口 272k/比例/重开已过；费用未知 | **部分**：headless 四桶和最新 used 对账过；窗口只有 native 配置/TUI 估计；新 ACP control 返回 size，真实生成 usage/cost 未验 |
| Retry / Queue / Cancel / Cleanup | accepted input 不盲投；迟到隔离；取消/网络恢复/整树清理 | **部分**：真实工具取消无延迟副作用，App 空闲退出整树清理过；网络/队列/crash/运行中退出待验 | **部分/未实现**：内部 ManagedProcess 有边界测试；尚无 ACP/Core accepted input、队列、取消、清理产品闭环 |
| Ready / Version / Platform | 安装与认证 Ready 不等于行为资格；逐版本/平台绑定证据 | **Preview**：macOS arm64 可选、App 使用已验；其余平台 NotQualified，非 First-Class | **Research**：没有闭合 Product identity/发现/Migration/Settings/平台准入；ACP 握手不提升资格 |

既有证据分别见[Cline 矩阵](../cline-runtime/README.md)、[Command Code 矩阵](../command-code-runtime/parity-matrix.md)、
[文件/Diff 对照](command-cline-parity-2026-10-05.md)及[Context 窗口](command-cline-context-window-2026-10-05.md)。
本清单沿用当前 Skills v2；旧 checklist 的 Library/group 术语不重新引入产品。

## 验证与后续边界

扩展现有测试 owner：Cline Plugin 的生命周期/隐私、Rust observer 的数值白名单与跳过态、compaction policy
的真实注册表。没有为了一个 mapping 新增平行 Rust 测试。默认 Rust workspace 455 passed / 2 ignored；
定向 Cline 2 项、compaction 3 项、Node observer 1 项通过。`pnpm typecheck`、文档三项门禁和 `pnpm test` 通过；后者含 2588 项 Vitest、335 项 Node 测试（2 项平台跳过）。回归发现并修正既有 schema 133 和旧 Camp API 测试夹具，分别对齐已经存在的 schema 134 与 Thread API，没有改产品行为。真实模型与打包 App 证据独立于这些 fixture。

开发包只安装到既有 `RovaiRuntimeAcceptance/mission-052-cline-…` 的隔离 Application，继续使用独立
userData 和 Skill Library；没有升级全局 CLI 或重启日常 App。新包的 Cline policy 已持久化为 best_effort，
真实 AgentRun 创建 active observer lease 并通过 bundled CLI 发送公开回复。具体 Run 与数字记在配套 evidence。

后续必须完成的内容：Cline/Command 必需扩展在原生模型调用前的加载证明；Command 官方 ACP 的可用认证/模型
与 MCP 覆盖方案，以及完整 Adapter 产品接线；两者的压缩连续性和表中失败/恢复矩阵。当前没有新增
Unsupported 产品例外，也没有把 Mission 或 First-Class 标成完成。
