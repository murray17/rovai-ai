---
title: "可观测输出 v3 思考流接通与长回合验收"
status: "implementation-evidence"
reviewed_at: "2026-09-30"
target_version: "v1.72"
---

# 可观测输出 v3 思考流接通与长回合验收

本次更新 PR #568 的思考来源资格，不改变速度位置、Run Card、上下文圆环、用量气泡或字符权重。实现提交为 `8b270ce4`；最终候选 `d2193d5d` 合入当时最新主线 `df7f7abd1a43b9e1002d6974e693f79e2f0b0f0c`，包含 #595 的审批选项文案修复。之前的主线基线 `51113b74` 与合并头 `78d0e809` 保留在首次安装记录中。本轮覆盖临时测速，不重写[四项 Usage 与 Context 的字段级结论](execution-metrics-verification-2026-09-29.md)。[首轮 v3 记录](observable-output-v3-verification-2026-09-29.md)中的 offset 必须存在限制已被本次已栅栏的接收身份替代。

## 修改与资格

- Codex 的 `summaryIndex` 不是 offset。当前 Host/thread/turn 已接纳的 summary delta 在分发前获得接收身份，Core 重试沿用它；同 item 不再计 raw reasoning 或终态完整摘要。
- Pi RPC 的 `thinking_delta` 用当前根 assistant message 区间、contentIndex 和接收序号计数。完整 `partial` 不进入新状态，start/end、子 Agent 和重放不产生增量。
- 标准 ACP 的 live thought chunk 可以没有 messageId/offset。只有当前 Host/Session/prompt 的实时通知进入计数；加载回放、闲置 owner、显式子 Agent、完整 snapshot 与终态迟到不进入。已有 offset/原生序号继续优先用于去重。
- ZCode 将原生 `model.streaming.reasoning_delta` 映射到私有计数入口；input、turn、seq 先于翻译栅栏，完整 reasoning_end 不计，父会话标记不计。
- DSH 0.1.5-rc.3 的官方 `dsh-acp/lib/index.js` 中 `assistantUpdates` 在提交的 `assistant/message` 上逐块投影。真实长回合也是 4 段完整正文、3 段完整思考，不能因为名字叫 chunk 就认作实时流。Core 已排除当前 DSH ACP 的正文和思考估速；Usage 与 Gauge 继续采集。

接收身份只去重同一 Core 投递的副本，不能识别上游以新 wire 通知重发的相同文本；不保存全文、内容哈希或无限历史来补这个缺口。无原生游标的支持依赖已核验的流通道语义。ACP/Pi 的 `stream_text` 指传输已交付的思考文字，不承诺它是完整内部推理；原生方言未区分摘要时不能反推出原文。Codex 已明确使用 `stream_summary`。

## 16 类 Runtime 来源表

原始字段形态、期望解析与实际数值读回见[脱敏真实证据](fixtures/round4-observable-output-runtime-evidence.json)。完整数值轨迹只放入本地验收产物，未把思考正文或 Native 历史复制进仓库。下面的“Core 可用”不等于该 Runtime 已逐项通过 Renderer；实际 App 验收另列。

| Runtime / 本次版本 | Provider / 模型证据 | 本次正文与思考形态 | 资格与验证范围 |
| --- | --- | --- | --- |
| Codex CLI 0.159.2 | sub2api；冻结显式 gpt-6.1-sol / high，实际 wire 模型未独立留证 | 独立 Core 约 178s 成功，378 summary delta；实际 App 约 194s 成功，82 summary delta | summary→Core→实际 App 数值与思考范围提示通过；见下节 |
| Claude Code 2.1.280 | 当前已授权配置；模型/Provider 原始字段未独立留证 | 约 367s 成功；4847 text delta，没有 thinking_delta；签名不计 | 本次思考 raw_absent；已有 parser 准入，不能将 2.1.274 的正样本冒充本次 Core 思考通过 |
| GitHub Copilot CLI | 用户要求忽略 | 本轮未运行 | 排除本轮范围 |
| OpenCode 1.18.32 | 当前已配置模型；冻结默认选择，原始模型未独立留证 | 长回合成功；2902 正文 chunk，没有 thought chunk | 本次思考 raw_absent；ACP 准入可用但未得到思考样本 |
| CodeBuddy 2.133.1 | 原生观测 gpt-6.1-sol；本机已配置 sub2api | 约 234s 成功；3091 正文 chunk，没有 thought chunk | 本次思考 raw_absent；显式启动模型修正后为健康回合 |
| Qwen Code 0.24.6 | 当前配置 gpt-5.6-sol(openai)；不是 wire 观测模型 | 长回合成功；3636 正文 chunk，没有 thought chunk | 本次思考 raw_absent；不能填成模型没有思考 |
| Pi 0.84.4 | 隔离副本 sub2api / gpt-6.1-sol / medium；Core 的 runtime-default 标签不证明实际模型 | 约 179s 成功；2897 正文 delta、84 thinking_delta；Core 思考 9125 单位 | thinking_delta→Core 数值通过；另外 high 回合只有 start/end，思考 delta 缺失 |
| ZCode 0.16.9 | Core 观测 new-provider/gpt-6-sol；Provider 端点未独立留证 | 长回合成功；Core 思考 4275 单位 | 私有 reasoning_delta→Core 数值通过；字段来源由安装包审计与 owner 测试证明，未独立截取完整原始通知 |
| DeepSeek Harness 0.1.5-rc.3 | 隔离 sub2api / gpt-6.1-sol / high；显式 route，模型 wire 未独立留证 | 约 419s 成功；4 段完整正文、3 段完整思考 | 已验证为终稿块，排除当前速度；正值旧探针作为错误准入 regression 留证，修复后约 145s 成功复测，2 段正文与 2 段思考，全程数值读回 null |
| Qoder 1.1.64 | Core 观测自定义 Provider / gpt-6.1-sol | 8 分钟截止前 2000 正文、274 思考 chunk；思考 32250 单位 | 部分原始流→Core 数值已见；完整成功回合 blocked_unverified，不能写成全面支持 |
| Cursor Agent | 用户要求不支持 | 本轮未运行 | 排除产品支持范围 |
| Kimi Code 2.1.1 | 隔离 ROVAI_KIMI_CONFIG 使用 Claude 同一 sub2api / gpt-6.1-sol；Native 只回 env-model 标签 | 约 217s 成功；3098 正文 chunk，没有 thought chunk | 本次思考 raw_absent；先前环境变量被日常 MiniMax provider file 覆盖的失败不作为兼容结论 |
| Grok Build 1.0.44 | 隔离原生配置 sub2api；Core 观测 gpt-6.1-sol | 约 236s 成功；2977 正文、37 思考 chunk；Core 思考 7775 单位 | ACP 已交付思考文字→Core 数值通过；未声称还原 Provider 的完整内部推理 |
| Antigravity 1.2.12 | Runtime 默认模型，Provider 未独立观测 | 长任务成功；当前接入只投影终稿，没有数值快照 | 当前接入无实时速度；未独立截取 Native 原始流，思考上报能力仍未验证 |
| Kiro 2.21.1 | Core 观测 auto；Provider 未独立观测 | 约 112s 成功；1901 正文 chunk，没有 thought chunk | 本次思考 raw_absent；较长正文速度通过 Core 读回 |
| TRAE CLI CN 0.120.52 | Core 观测 GLM-5.3 | 8 分钟截止前只有思考；1235 thought chunk、93804 标量；Core 思考 1978380 单位 | 仅思考的持续计数及显示状态机已见；未获得成功终态，完整回合 blocked_unverified |

每单位为 0.01 个本地显示估算 token，上表不是原生 Output Token。数值取运行中实际读到的累计快照，不能解释为结束统计。用户本轮授权尝试现有 sub2api 配置；只修改隔离夹具，不改日常 Runtime 配置、权限或平台资格。

## 自动化 owner 与内容边界

本轮扩展既有 owner，没有新增 Rust 测试函数：

- Codex ingress owner：当前 turn 的接收身份、旧 turn 排除、stdout flood 与终态路由；normalize owner：raw reasoning 仍是私有事件。
- Pi text identity owner：message/contentIndex、partial 不扩散、子 Agent/replay/snapshot、message_end 后迟到。
- ZCode native input owner：原生 seq 重复、旧 turn、reasoning_end、父 Session 排除。
- ACP identity owner：更新、content 与 _meta 的根身份/回放/snapshot 检查。
- observable_output owner：Unicode 分类、重复/重叠、流分片、计数换代、summary 与原文互斥；Renderer 固定回放的 5 项测试继续证明 500ms、1Hz、预热、静默、断线及终态。

[合成帧](fixtures/observable-output-v3-synthetic.json)更新了标准 ACP 无 messageId/offset 的合格 live receipt 与显式 snapshot/replay 的不合格来源；[可执行 ACP 夹具](../../../scripts/fixtures/streaming-acp-runtime.mjs)保留私有标记，并混合有 offset 与无 offset 片段。Core 临时状态只保存分类整数、身份和游标；新数字接口、Web 字段白名单、数据库、Blob、Renderer 不新增思考内容路径。实际 App 的标记扫描与动态状态证据见下一节。

## 打包 App 动态验收

最终候选 `d2193d5d` 使用 `pnpm package:mac:daily` 构建，arm64 App/Core/Host/CLI、Bundle ID 与 ad-hoc 签名门通过。已签名 Core SHA-256 为 `73c21d50a85158f16459815a849fd868e9b6b254b51e113ef3b1fdd4dbc46bd2`。各次 App 使用独立临时 userData、Skill Library 和 MCP，日常宿主持续运行。字段级结果见[实际 Renderer 证据](fixtures/round4-observable-output-renderer-acceptance.json)，完整数字轨迹、脱敏 Native 形态和截图在本地附件 `observable-output-20260930/`；可重复入口见[测试与 Smoke](https://github.com/murray17/rovai-ai/blob/ee444ab103d248c7573143992eb0c1141d0df1b1/docs/development/testing.md#可观测输出真实-runtime-验收)。

- 固定 ACP 流混合 3 个原生 offset 帧和 4 个无 messageId/offset 的实时帧，并发送不合格完整 snapshot。观测快照为正文 15200、思考 3780 单位；这是运行中的部分累计，不是终态总量。途中打开先建立基线，切历史 Run 不改变当前队员顶部速度，工具停顿后隐藏、恢复重新预热，运行耗时保持。私有标记在 Evidence 为 0 行，Renderer 未出现，隔离 userData 常规文件扫描为空。
- Run 先结束后，用独立 fixture 数据库投递晚到 Usage，完成卡片刷新为 `2k`；气泡为四项 Usage 加执行耗时，卡片上没有独立耗时文字。合成数据不作为真实 Runtime Usage 支持证明。
- 真实 Codex 0.159.2 的图依赖推理长任务约 194s 成功：原始 2057 个正文增量、82 个 summary delta（458 个摘要标量）；Core 运行中最高读到正文 294710、思考 9700 单位。原始 summary 帧有 itemId/turnId/summaryIndex，没有文本 offset。App 实际产生 46 次数字变化，任意 30s 窗口最多 20 次，最短观测间隔约 994ms；源码节拍仍是 1Hz。17 个 DOM 采样带思考摘要提示，既见仅摘要范围，也见正文与摘要范围。当前队员选择保持、单行布局和运行耗时通过；终态立即无速度。
- 另一次约 171s 成功回合原始没有 summary delta，App 正文速度正常（63 次变化）。严格思考正样本断言没有通过，按 `raw_absent` 留证，不解释为模型没有思考。还有一次已收到摘要的尝试因验收脚本初始选择竞态停在总览而无速度，未计作 Renderer 通过；脚本已改为幂等打开、选择可见队员、等待非总览头，并逐帧记录与验证选中对象。

本轮自动化包括 workspace 默认 Rust 447 项通过、1 项忽略；最终改动相关的 Core Unicode/归属/去重/隐私既有 owner 定向通过；Renderer 5 项固定回放、TypeScript、文档 10 项测试与通用文档门通过。实际 Renderer 正样本仅扩展 Codex 结论，其余 Runtime 的独立 Core 探针仍不冒充逐 Runtime App 验收。没有新增数据库表或思考文本保存路径。

## 未决事项

1. 独立 wire 重发没有 offset/sequence 时无法内容去重；若当前已核验通道改变重发语义，需要重新审计资格。
2. Claude/OpenCode/CodeBuddy/Qwen/Kimi/Kiro 本次健康回合未上报思考；需要同版本下实际上报 thought 的配置样本，不能用 start/end、签名或终稿代替。
3. Qoder 与 TRAE 长回合只达到部分流观察；成功终态、恢复和真实 Renderer 尚未证明。未取消/绕过外部认证、配额或平台限制来制造成功。
4. DSH 当前 ACP 只有提交后的整块输出；需要上游真正实时事件或经审计的新接入方式。当前计数排除是语义正确的结果，不是字段没接。
5. ZCode 的独立原始帧见证尚缺，Antigravity 当前没有原始结构化流见证；Core 读回与 Native raw 证据分别记录。
6. 所有 Native 正样本只证明所列版本、配置和场景。没有逐 Runtime 覆盖全部失败、取消、恢复、子 Agent 与重连的真实调用；这些边界首先由确定性 owner 和合成 App seam 验证。

权威字段、模式、归属和节拍见 [Runtime Execution Metrics v1](../../contracts/runtime-execution-metrics-v1.md)。
