---
document_type: research
status: verified-with-limitations
last_updated: 2026-10-04
---

# Command Code 与 Cline：真实模型 Usage / Context 核验

任务分支 `rovai/mission/052` 已合入 `origin/main` 的 `b2c9c976`，合并提交为 `95f7da48`。
适配主干的 [Usage v8](../../contracts/runtime-usage-monitoring-v8.md) 与
[Execution Metrics v7](../../contracts/runtime-execution-metrics-v7.md)：逐调用消费、独立 Session Gauge、
原有低频 Flush、稀疏字段及实际模型归属。没有改变模型输入或恢复已退役的输出测速。

本次真实生成使用 macOS arm64、Command Code **1.66.0**、官方 Cline CLI **3.0.65** 与
用户授权的 sub2api BYOK / **gpt-6-sol**。Runtime、Home、workspace 与原生配置均隔离；
未启动日常 App、未连接日常 Core 数据库。Cline 使用官方 `cline --acp`，没有切换 SDK Host。

## 实际拿到的字段

| 字段 | Command Code | Cline | Rovai 处理 |
| --- | --- | --- | --- |
| Input | `model_request_end.usage.inputTokens` | Plugin `afterModel` 的 `assistantMessage.metrics.inputTokens` | 含缓存的本次模型输入，逐调用归一化 |
| Output | `outputTokens` | `outputTokens` | 包括原生报告的 reasoning，不重复相加 |
| Cache read | `cacheReadTokens` | `cacheReadTokens` | 两条真实链路都取得正值 |
| Cache write | `cacheWriteTokens` | `cacheWriteTokens` | 本次均为原生显式 0；没有验证正写入 |
| Reasoning output | 未返回 | `reasoningTokenCount`，部分调用返回 | Cline 工具轮已知部分为 20，省略仍为未知，不能称完整 reasoning 总量 |
| Uncached input | 非独立原生字段 | 非独立原生字段 | 三个输入桶齐全时按 Input − read − write 归一化 |
| 总 toks | 从 Input + Output 得到 | 从 Input + Output 得到 | 保留每调用完整性；缓存桶不能再加一次 |
| Context used | 最新完成根调用的 inputTokens | 最新完成根调用的 inputTokens | 单独 Session Gauge，不累加历次输入或输出 |
| Context window / ratio | 本次未取得 | 本次未取得 | 保持 NULL；不猜模型容量、不从名称推断比例 |
| Cost / currency | 本次未取得 | 本次未取得 | 保持 NULL；不把原生配置缺省价格零当账单 |

因此本次证明 Command Code 的 **4 个原生 token 桶**，Cline 的 **4 个原生 token 桶及可选 reasoning**。
Context used 是已验证输入语义的投影，不是上游另外返回的第 5 个 token 桶。
Cline SDK 会为部分缺省桶产生零，本报告只证明 Runtime 原生观测；没有独立核对 Provider 账单。

## 同一轮的数字与实时性

完整的数值专用观测见 [JSON 证据](command-cline-numeric-evidence-2026-10-04.json)。只保存模型、时间、
字段及匿名归属；不保存 Prompt、响应正文、思考、工具内容或凭据。`observedAt` 是 Core 解析或 Plugin
发出观测的时间，不是网络包时间。身份别名保留相等关系；Command 的 identity suffix 仅在单次传输内唯一，
未来 AgentRun 消费者必须按 Run / execution epoch 加前缀，不能跨 Run 按 suffix 去重。

| 真实 Core 样本 | 根模型调用数 | Input | Output | Cache read | Cache write | 推导 toks | 最后 Context used |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Command 首次生成 | 1 | 13,319 | 9 | 0 | 0 | 13,328 | 13,319 |
| Command 同 UUID 恢复后的 read / shell 轮 | 5 | 69,309 | 399 | 39,680 | 0 | 69,708 | 14,721 |
| Cline 同 Session 的 read / edit / shell 轮 | 5 | 14,020 | 398 | 4,480 | 0 | 14,418 | 3,137 |

Command 每个模型调用的四桶和均与原生最终 `result.usage` **逐字段相等**；`turn_end`、`result` 的
重述不再次入账。Context 依次为 `13,355 → 13,483 → 13,589 → 14,161 → 14,721`，传输完成前已可收到。

Cline 的前 4 次调用在 prompt 未结束时经私有读取进入 Core，Context 为
`2,444 → 2,637 → 2,824 → 2,978`，终态再收到最后调用 `3,137`。
前 4 次输入和为 10,883，终态输入为 3,137；Output 为 360 + 38。连续 poll 不重复返回，
终态不再返回已采身份。原生 ACP 不直接发这些字段，来自官方 Plugin 的逐模型消息；
没有另一个 ACP Run total 可供独立账单式对账。

Cline 的首次、warm、A→B→A、停止 Host 后 exact `session/load`、重放隔离和冷恢复新 prompt 也通过。
JSON 中 `CLINE_METRICS` 对应这 5 个不同 prompt，不能把它们加在一起冒充一个 Run。
工具轮还验证了 read/edit 结果、stdout/stderr、非零命令失败与取消后无延迟文件副作用。

## 实现与验收边界

- Command 的内部 headless transport 新增数值专用通道，以原生 start/end 配对根调用，输出稀疏
  `model_call / delta` 和 `session / gauge`。公共 Activity 不包含数值私有帧或 `run_end.nextState`。
  **它仍没有 Product Adapter / AgentRun dispatch；本次不是 Command App 指标验收。**
- Cline 的官方只读 Plugin 只输出白名单数值与归属。根调用、原生 Run、精确 Session/Prompt lease、
  单调序号共同隔离子代理、历史回放和迟到记录。私有文件有数量/大小上限；在既有 4 秒 Flush 入口读取，
  live 与 terminal 共用锁和序号，不增加指标定时器，不扫描原生聊天记录。
- Cline parser 已接共享 Usage 归一化和 Session Context；平台仍为 `NotQualified`。
  本次真实证据到 **Core ACP Host / parser** 为止，未证明完整 AgentRun 落库、Renderer 展示或平台准入。
  数据库与主干共享监控路径另由确定性测试证明，不能冒充同次真实 App 读回。
- Schema 134 / Migration 184 仅扩展 Cline Runtime/Skill closed sets，继承主干 schema 133；
  回滚同时保留表、触发器、收据和旧数据。没有为指标新建表。
- [Command 矩阵](../command-code-runtime/parity-matrix.md)和 [Cline 矩阵](../cline-runtime/README.md)
  的其余产品接入、压缩连续性、Skills/MCP/Built-in 与平台 Golden Flows 继续逐轴验收，不能由本报告升级资格。

## 可重复验证

2026-10-09 User 105 已退役 Command headless 代码。下面 Command 专属命令仅适用于
[退役前固定提交](https://github.com/murray17/rovai-ai/blob/2b9a2dbaf8d4312c2f539c91a1aa500c1e5c279e/crates/rovai-core/src/command_code.rs)，
不再是当前树的测试入口；保留的 ACP owner 见[测试路由](../../development/testing.md)。

真实模型 Smoke 为显式 ignored owner，需要准备独立 Home 和该 Runtime 自己的有效原生配置，
按[本地隔离流程](../../development/local-workflow.md)运行。Cline 需官方 wrapper、
`openai-compatible` provider 和包含 `gpt-6-sol` 的原生 models catalog；本次没有配置猜测窗口或价格。
测试通过 `ROVAI_CLINE_SMOKE_ROOT` / `ROVAI_CLINE_SMOKE_EXECUTABLE`，以及
`ROVAI_COMMAND_CODE_SMOKE_ROOT` / `ROVAI_COMMAND_CODE_SMOKE_EXECUTABLE` 选择隔离目录与程序。
密钥不进入 argv 或测试输出。

```sh
cargo test -p rovai-core --features extended-tests --lib isolated_command_code_reports_live_calls_and_exact_resume_usage -- --ignored --nocapture
cargo test -p rovai-core --features extended-tests --lib isolated_cline_acp_host_observes_warm_and_exact_cold_prompts -- --ignored --nocapture
cargo test -p rovai-core --features extended-tests --lib command_code::tests::
cargo test -p rovai-core --features extended-tests --lib cline::tests::
cargo test -p rovai-core --features extended-tests --lib monitoring::tests::
cargo test -p rovai-core --features extended-tests --lib cline_catalog_migration_preserves_rows_and_rolls_back_with_its_receipt
node --test scripts/lib/cline-observer.test.mjs
```

上述真实 Smoke 分别通过（28.37 秒、62.72 秒）。定向 parser、逐调用/Context 去重、私有 observer、
监控 13 项、Migration 184 回滚/重开、当前来源矩阵、数据库 preflight 和主干草稿迁移回归通过。
最终 `cargo test --workspace` 为 455 passed / 2 ignored；共享 ACP 回归 66 passed / 1 ignored，
应用层 ACP 私有字段排除 owner 通过。`pnpm typecheck`、`pnpm docs:test`、`pnpm docs:check`、
`DOCS_BASE_REF=b2c9c976 pnpm docs:check:ci` 与格式检查通过。完整真实模型 Smoke 已显式执行，
不以普通测试中的 ignored 状态作为通过证据。
测试 owner 的准入说明见[开发测试说明](../../development/testing.md#command-code--cline-数值通道2026-10-04)。

## 官方来源

- [Cline 3.0.65 ACP 事件转换](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/apps/cli/src/acp/session-updates.ts)：本版本标准 ACP 更新未提供这些 token 桶。
- [Cline agent-runtime](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/agents/src/agent-runtime.ts)：`usageDelta` 为每调用差值，`afterModel` 接收 assistant metrics；reasoning 为可选字段。
- [Cline AI SDK Provider](https://github.com/cline/cline/blob/9131e36429314ea614491bf749678adbacb3d3cb/sdk/packages/llms/src/providers/ai-sdk.ts)：输入总量含缓存，费用计算另减缓存桶。
- [Command Code headless 文档](https://commandcode.ai/docs)：本次字段名和调用/终态对账以本机官方 npm 1.66.0 真实 NDJSON 为证，不把文档声明替代原生观测。
