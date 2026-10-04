---
title: "可观测输出测速 v3 来源资格与核验"
status: "implementation-evidence"
reviewed_at: "2026-09-29"
target_version: "v1.72"
---

# 可观测输出测速 v3 来源资格与核验

本记录冻结 2026-09-29 的核验结果；接收身份准入、Codex／Pi／ZCode 修复以及长回合结论已由[2026-09-30 验收](observable-output-v3-verification-2026-09-30.md)更新。下文的 offset 限制和未验证状态不是当前支持矩阵。

本记录只讨论显示用 `tok/s`。Input、Output、Cache 与 Session Context 的原生用量结论仍见[第二轮字段级核验](execution-metrics-verification-2026-09-29.md)。v3 将正文和合格思考的临时字符计数放在 Core，Renderer 只读取累计数字；不能把既有 v2 正文实测直接写成 v3 思考支持。真实 Provider 是否发送思考流仍需按安装版本和有效配置观察。

## 资格判定

| 来源 | v3 准入 | 当前证据与限制 |
| --- | --- | --- |
| 根 Agent 公开正文 | 经 Execution Evidence 接纳的 `agent.text.delta`，Core 聚合后的 `blockId + textOffset`；同一 Run／代次 | 旧真实样本的流式次数见下表；v3 已在隔离 ACP App fixture 中走通原始帧、Core、读取及 Renderer。只有整段终稿的 Runtime 不具备当前速度。 |
| Claude Code 明文 `thinking_delta` | `message_start` 必须给出稳定原生 message ID；`thinking` block 的真实流式 delta 按 UTF-16 offset 计数；排除 `parent_tool_use_id` | 安装版 2.1.274、有效模型 gpt-6-sol 的独立 CLI 健康回合真实出现 1 个根明文 delta；parser 脱敏帧自动测试通过。此探针尚未经过 Core 数值读回，不能写成真实 Provider 端到端通过。完整 assistant thinking block 不计。 |
| ACP `agent_thought_chunk` | 当前 Run／prompt 栅栏、稳定 `messageId`、原生 UTF-16 `textOffset`、无显式子 Agent 身份同时成立 | Rovai 的 ACP 接收序号是本地分配，重放会得到新序号，不能据此去重。隔离打包 App 用合成 Qwen ACP 流验证；该 fixture 不是 Qwen 真实模型能力证明。缺 `messageId`、`textOffset` 或根归属不清的真实方言直接排除。 |
| Codex `item/reasoning/summaryTextDelta` | 当前只在有同一 item 的真实 UTF-16 `textOffset` 时准入 | 当前 0.157.1 样本只见 `summaryIndex`，它是条目序号而非文本 offset；因此当前实测摘要不计速。不能按到达顺序猜 offset 或把终态摘要补入。 |
| 完整块、隐藏推理、工具、子 Agent、回放 | 不准入 | 完整块没有实时生成时间；加密推理没有可见文本；工具与子 Agent 不属于根 Agent 当前输出。 |

**状态口径：**“旧正文流已观测”是 v2 的原始流证据；“合成链路通过”是受控 fixture 的 v3 端到端证据；“真实思考未验证”是当前安装版本与 Provider 尚无可复核原始帧。三者不能互换。即使表中有旧正文流证据，也不宣称 v3 的真实思考可用。

## 16 类 Runtime 思考来源表

| Runtime；上次验证版本／配置 | 旧真实正文形态 | v3 思考来源资格与当前状态 | 下一步证据 |
| --- | --- | --- | --- |
| Codex CLI 0.157.1；sub2api/gpt-6-sol，App Server | 多段增量 | 摘要通知已有 parser；`summaryIndex` 非 offset，当前摘要排除；真实 v3 思考未验证 | 捕获同 item 可去重 offset 或稳定原生序号的脱敏帧，并在真实 Run 核对数值读取。 |
| Claude Code 2.1.274；gpt-6-sol，Provider 未公开 | 旧回合 11 次增量；v3 原始探针 112 次 | 真实独立 CLI 健康回合出现 1 个明文 `thinking_delta`，根归属字段与 parser 条件吻合；Core 数值与 Renderer 的真实 Provider 端到端未验证 | [脱敏原始形态记录](fixtures/claude-2.1.274-observable-output-v3-probe.json)；隔离 Core 长流回合再核读取快照。 |
| GitHub Copilot CLI 1.0.83；claude-sonnet-5 | 用户本轮要求忽略 | 本轮忽略 | 用户恢复范围且有有效配额后再测。 |
| OpenCode 1.18.30；sub2api/gpt-6-sol，ACP | 9 次增量 | ACP 条件链路已实现；该版本真实 thought chunk 的稳定身份、offset 和根归属未验证 | 保留 `messageId`、`textOffset`、子 Agent 字段的脱敏真实帧。 |
| CodeBuddy 2.133.1；sub2api/custom-local:gpt-6-sol，ACP | 10 次增量 | 同上，真实思考未验证 | 当前 ACP 健康回合采样 thought 帧及 item 身份。 |
| Qwen Code 0.24.5；gpt-5.6-sol(openai)，ACP | 9 次增量 | 合成 Qwen ACP 帧已走通 Core→Renderer；真实思考未验证 | sub2api 健康回合的真实 `agent_thought_chunk` 与根身份。 |
| Pi 0.84.4；sub2api/gpt-5.6-sol，RPC | 8 次增量 | 未发现可准入的明文思考 offset／序号链路；未验证 | 检查当前 RPC 原始 thought 方言及重放语义。 |
| ZCode 0.16.9；runtime-default | 仅两次增量 | 私有思考流未验证 | 较长健康回合原始帧与根身份。 |
| DeepSeek Harness 0.1.5-rc.3；sub2api/gpt-6-sol，ACP | 仅一次可见增量 | ACP 条件链路；真实思考未验证 | 长回合抓取 thought chunk 的 item ID 和重复语义。 |
| Qoder 1.1.28；sub2api 目标 | 无健康 sub2api 样本 | 阻断未验证 | 完成官方账户／自定义模型交互配置后探针。 |
| Cursor Agent 2025.09.18-7ae6800 | 用户要求不支持 | 本轮排除 | 范围改变时重新立项。 |
| Kimi Code 2.1.1；sub2api/gpt-6-sol，ACP | 9 次增量 | ACP 条件链路；真实思考未验证 | 真实 thought chunk、item 身份、重复 step 区分。 |
| Grok Build 1.0.41；sub2api/gpt-6-sol，Responses ACP | 9 次增量 | ACP 条件链路；真实思考未验证 | 健康回合核对 thought 增量与终态补发。 |
| Antigravity 1.2.12；runtime-default | 只有整段终稿 | 无当前速度；思考流未验证 | 核对升级或结构化接入方式的兼容影响。 |
| Kiro 2.21.1；runtime-default | 仅两次增量 | 私有思考来源未验证 | 脱敏原始帧与较长持续输出。 |
| TRAE CLI CN 0.120.52；runtime-default | 只有整段正文 | 无当前速度；思考流未验证 | 原始流与终态字段。 |

版本、Provider、模型与旧真实用量来源的逐字段证据位置见[第二轮记录](execution-metrics-verification-2026-09-29.md)及其中的[脱敏 fixture](fixtures/round2-sub2api-field-evidence.json)。本表没有把 blocked、parser 命中或旧样本的终态读回写成 v3 Renderer 可用。

## 合成 fixture、自动化与动态证据

[v3 脱敏原始帧与期望读回](fixtures/observable-output-v3-synthetic.json)保存 Claude `thinking_delta` 与 ACP 有身份、重复、无身份、显式子 Agent 帧；字段明确标注为合成。Core 的 `observable_output::tests` 检查 Unicode 脚本分类、同一码点序列的分片一致、重复／重叠 offset、UTF-16 代理对、来源互斥、序号重放和计数代次重建。Claude parser 测试检查流式 offset、终态完整块与子 Agent 排除。Web 测试检查数值白名单；Renderer 固定回放检查 30 秒最多 30 次发布、正文＋思考合并、停顿、恢复、重连、切代次与单段终稿隐藏。

隔离打包 App 的[受控 ACP 夹具](../../../scripts/fixtures/streaming-acp-runtime.mjs)加入带专用标记的合格思考增量和一段缺原生 offset 的 1000 字符不合格思考。[打包 App 验收记录](fixtures/round3-observable-output-renderer-acceptance.json)保存 Core 数值读回（正文 13300、思考 3780 个 0.01 token 单位；不合格大块未计入）、持续输出、工具停顿、恢复、重进、切 Run、终态和迟到 Usage 的 Renderer 状态；Evidence、Renderer 和隔离 userData 全文件扫描均未找到私有标记。数值变化间隔满足 1 Hz 上限，截图路径见该记录。合成 fixture 不证明 Qwen 真实 Provider 会发送思考。

`pnpm smoke:claude-runtime` 在隔离 Core／Skill Library 上通过真实 Claude 2.1.274、gpt-6-sol 的同原生 Session 两 Run 续接、正文投影、Bash 输出、精确编辑与取消；该 smoke 不在运行中读取 v3 数值，不能替代真实 Provider 的思考速度读回。脚本原先依赖已移除的 Composer Draft 请求并假设发送命令立即返回 Run ID，本轮按当前消息内容和消息关联 Run 的合同修复了验收入口。

## 未决事项

1. Claude Code 2.1.274/gpt-6-sol 的独立 CLI 已观测明文 `thinking_delta`，真实 Core smoke 已确认常规执行链路，但尚未在同一次真实回合读取 v3 累计数字及 Renderer。Codex 0.157.1 的 summary delta 缺可靠增量游标，当前摘要排除。
2. ACP 各 Runtime 的 `agent_thought_chunk` 是否带稳定 `messageId`、原生 `textOffset` 及真正根 Agent 归属；没有这些证据不计入。真实 Run 的有流／仅终稿／无思考通知仍需逐 Runtime 更新。
3. 打包 App 合成流只能证明本地传输和 UI 边界。真实 Runtime 的长流、工具停顿与重连样本还需匹配当前安装版本、模型和配置重复验收。
4. v3 字符权重是版本化显示粗估。可以用同一份可见正文与本地匹配 tokenizer 比较，但不能拿含隐藏推理、工具或结构信息的原生 Output 总量直接校准。

权威语义见 [Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md)。
