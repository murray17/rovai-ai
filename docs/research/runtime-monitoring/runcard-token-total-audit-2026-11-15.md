---
document_type: research-note
authority: non-normative
last_updated: 2026-11-16
---

# RunCard Token 总量核查

核查基线 `70aab893810b03e8f45b7281efa7bceb3452ef5c`。范围来自
[`AdapterKind::ALL`](../../../crates/rovai-core/src/agent_profile.rs)：21 种 Adapter；模式差异另列。
此次先读源码、协议和已入库脱敏数值，比较后才选择产品规则；没有先改 Renderer 门槛。
不修改监控页面、模型输入或原生 Runtime；不扫描历史 Run 补账。

## 证据等级与方法

- **S（源码）**：本次逐项追踪生产 parser、native reader、调用路由、buffer、checkpoint、Run summary、`monitoring.execution` 和 RunCard。
- **P（协议）**：字段语义以对应方言为准。ACP 的 [Session Context Size and Cost](https://agentclientprotocol.com/rfds/session-usage) 只报告窗口占用与 Session 费用；不能当消费。通用 [End-Turn Usage 草案](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/end-turn-token-usage.mdx) 不能替代某 Runtime 实现。
- **R（真实观测）**：复用仓库已保存的脱敏原生数值，保留原测量日期/版本；不是本轮重新运行所有 Runtime。旧 UI 的通过不证明新 UI 或所有字段完整。
- **T（受控验证）**：本轮运行生产 parser、归一化、SQLite 事务和 Renderer 测试；合成边界不冒充真实模型行为。

同样本明细为 [数值 fixture](fixtures/runcard-token-comparison-2026-11-15.json)，由
[`audit-runcard-token-samples.py`](../../../scripts/audit-runcard-token-samples.py) 从明确列出的既有数值白名单提取。
Cline 按原生 Run 身份分组、message 身份去重，不能将 live/terminal 重述重复累加。
只复制消费数字、别名和证据路径；没有提示词、回复、工具参数、凭据或完整原生日志。

## Runtime 核查矩阵

I=含缓存输入，U=普通输入，R/W=互斥缓存读/写，O=含 reasoning 的输出；“未知”指未验证或未报告，不表示上游永久不支持。
字段总量与分项重叠时只取总量；Context 永远不进入消费。

| Runtime / 模式 | 原生消费来源、范围和计数 | 输入 / 输出包含关系 | 缺失、零与时序 | 当前处理、身份与证据 |
| --- | --- | --- | --- | --- |
| Codex app-server | `thread/tokenUsage/updated.last` 单调用；Delta；`total` 是去重用累计见证 | I 含缓存；O 含 reasoning；`last.totalTokens` 另用于 Context，未作独立完整消费来源 | 原生 Option 保留缺失；每调用通知；终态不再次相加 | thread/turn 路由及累计见证 digest；同 Session 多 Run/恢复见 [边界 R](native-boundaries-verification-2026-10-01.md)。占用变化不重复计费；没有把整 Session total 计入 Run。S/R/T |
| Pi managed RPC | assistant `message_end.usage` 单调用；Delta；忽略 `message_update` 与 Session stats | U+R+W；O 包含 reasoning；`totalTokens` 为原生完整计数 | 桶为 native normalized 数值，部分 Provider 已合成 0；全零失败占位不能证明真实零；message_end 才进入计账 | Session+Prompt+timestamp+Provider/model；[原生 Usage 类型 P](https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/ai/src/types.ts)、[连续 Run R](native-usage-context-verification-2026-09-30.md)。修复丢失 total；后到同调用字段不再形成新调用。S/P/R/T |
| Claude stream-json | 根 message 的 `message_delta` 累计快照；每 message 从 0 起 | U+R+W；O 已含思考；无独立 total | 合并同 message 的已报告字段；message_start 的全零暂定值不当真实消费；缺桶仍未知 | 当前 Session/根 message，排除 parent_tool_use_id；result 出现 `model_calls_observed` 后只保留费用，避免覆盖已观测调用；没有 stream 调用时 result 是当前 Run 数值后备。S/R/T |
| Claude result 后备 | `result.usage` 当前 Run Delta | U+R+W+O | 失败/取消只有已到达的数值可保留；不以 succeeded 为准入 | 只能与 stream 二选一，不能以 result 补齐不确定的子调用；子代理总覆盖未证明。S/R/T |
| OpenCode V1 | 根 Session SQLite 已完成 assistant 元数据；逐调用 Delta | U+R+W；原生 output 与 reasoning 互斥，先合成 O | 缺 reasoning 仍保留普通 output；已完成失败调用的正数不因 error 标记丢弃；占位零排除；异步可漏头尾 | 物理 rowid baseline +精确 Session/cwd +message ID；不读取 part；子 Session 排除；V1 terminal 最后调用不另计。[增量 reader](../../versions/v1.72/native-sqlite-usage-incremental.md)。S/R/T |
| OpenCode V2 | prompt response 当前根 Prompt 的聚合 Delta | 原生 full total；U/R/W，普通 output 与 thought 互斥 | 修复仅有 total 时被丢弃；有 I/O 可推导时保留；缺终态可能无数字 | V2 禁用 V1 reader；Prompt ID 去重；不包含原生委派 Session；原有 partial quality 不应阻挡已知数值。[源码](../../../crates/rovai-core/src/monitoring.rs)。S/T；本轮无新真实逐调用样本 |
| Kilo ACP | 共用 V1 SQLite 根调用 reader | U+R+W；普通 output + reasoning=O | reader 同上，稀疏字段、异步漏报边界同上；失败调用有可信正计数仍接纳，占位零不计 | 使用 Kilo 有效 DB 路径，禁止 ACP Token 双来源；[既有实施 R/T](../../versions/v1.72/kilo-acp-implementation.md)。真实完整逐调用数值样本本轮未新增 |
| Copilot ACP | 订阅根 `assistant.usage` 逐调用 Delta | I 含 R/W；O 含 reasoning | timestamp 调用身份；忽略 dataOmitted、子 Agent；终态 Session 累计不计 | [真实六调用 R](all-runtime-app-verification-2026-10-03.md)，[parser](../../../crates/rovai-core/src/monitoring.rs)。原 transport 数值见证保留，parser 6 使用稳定调用 checkpoint；同 timestamp 补齐只修正既有贡献。S/R/T |
| Cline ACP Plugin | `afterModel` 私有数字文件，根 native Run/message，逐调用 Delta | I 已含 R/W；reasoning 属 O | 未报告继续 null；live 与 terminal 读同有界序号文件 | 精确 Prompt lease、Run、Session、sequence；恢复不导入历史；[真实/受控 R/T](command-cline-verification-2026-10-04.md)、[故障 R/T](command-cline-fault-recovery-2026-10-05.md)。S/R/T |
| Command Code 当前 ACP Mod | prompt result `_meta.usage` 当前 Prompt Delta | I 含缓存，O；无 reasoning 不猜 | 终态才有消费；失败响应无 Usage 时保留缺失 | 同 result `usage` 是 Session 累计，禁止混入；[当前原生简化 R/T](../../versions/v1.72/command-code-native-simplification.md)。S/R/T；逐调用对照来自旧版记录，不当作 1.88 新实测 |
| Command Code 历史 headless | 原生逐调用数字帧，已退出产品主路径 | I+O | 只作为旧数值样本，不恢复该 transport | [脱敏历史 R](command-cline-numeric-evidence-2026-10-04.json)。S/R |
| Kiro ACP | metadata 百分比、已绑定 Session 的窗口；没有已准入消费来源 | meteringUsage/额度不是 Token；Context 不计 | 原生统计候选存在，范围/公开准入未证明；不能记成不支持 | [字段复核 R](kiro-and-field-audit-2026-10-03.md)。保持消费未知，两方案均无数字。S/R/T |
| Qoder custom Provider | 当前根 journal assistant `message.usage` 单调用 Delta | custom input 是 OpenAI 含缓存 I；O 已含思考 | 原生 normalize 会合成 cache=0，仅正缓存确证，缺分类保持未知 | Session/cwd/entrypoint=acp/isSidechain=false/message ID；[字段 R](kiro-and-field-audit-2026-10-03.md)。S/R/T |
| Qoder 其他 Provider | 同 journal 可能脱敏归零 | 原生隐藏消费，不能将 0 当真实零 | 无 presence，消费未知；比例仍独立可用 | 不借 custom 模式结果替代。S/R/T |
| CodeBuddy journal（产品主路径） | root `providerData.rawUsage` 单调用 Delta | prompt_tokens 为 I；completion_tokens 为 O；native total 为 I+O | 缓存可能缺失；修复 raw total 丢失；只提取原生数值 Option | agent=cli、Session/cwd/message ID；function_call/message 重述同身份；ACP Token 禁用。[字段 R](kiro-and-field-audit-2026-10-03.md)。S/R/T |
| CodeBuddy ACP 私有兼容 parser | `_meta.usage` 单调用，requestId 去重 | I+O | 缺 requestId 保守 numeric identity，不能证明所有相同数值的调用独立 | 当前产品已选 journal，不将两条来源相加。S/T |
| Qwen Code ACP | `agent_message_chunk._meta.usage` 原生单调用 Delta | I 含缓存；当前方言 output 已含 thought；不可再加 thought | 缺 W 不影响 I；native normalized 层已可能填零 | 原生没有独立 call ID 时用 usage fingerprint 保守去重；相同数值的独立调用可能少计，尚无可靠身份修复依据，不能改用到达序号冒险重复。[字段 R](kiro-and-field-audit-2026-10-03.md)。S/R/T |
| TRAE CLI CN journal | 当前 Session `events.jsonl` 根 assistant response_meta，Delta | prompt_tokens 为 I，completion_tokens 为 O，total 为 I+O | 修复原生 total 丢失；W 缺失保持 null；ACP 本身仅 Context | 根 agent、无 parent_tool_call_id、record ID，baseline 排除恢复历史；[字段 R](kiro-and-field-audit-2026-10-03.md)。S/R/T |
| Cursor Agent | 已登记 Adapter，当前产品未开放，无已准入消费 parser | 未验证 | 不以文字/费用反推；不能写成上游不支持 | [产品边界](../../architecture/runtime-catalog-boundaries.md)。S；无当前 R |
| Kimi Code | `agents/main/wire.jsonl` 根 `step.end.usage`，Delta | inputOther + inputCacheRead + inputCacheCreation；O | 缺桶未知；无 usage 不清其他调用；迟到写入可漏 | agent=main、uuid、turn，当前 Prompt cursor，子 Agent 排除；[连续 Run R](native-usage-context-verification-2026-09-30.md)。S/R/T |
| MiniMax Code | 根 Session DB 定位 journal，已完成 assistant 调用 Delta | U+R+W+O；可缺 W；不使用 catalog cost 推算 | 普通 reader 异步；error/aborted 有正计数仍保留，全零占位排除；终态尾读冻结本轮身份；短 Run 可缺失 | 消息/turn 明确映射，compaction snapshot 有界且去重；[真实/受控边界](../../research/minimax-code-runtime/full-parity-2026-10-16.md)。S/R/T；现有只有汇总的旧 Run 不重建调用关系 |
| Hermes 官方 ACP Gateway | 原生 terminal usage 可能是保留 Agent 的累计，也可能重置 | 已知计数本身有效，但缺同代 baseline 无法归当前 Run | 失败前已知调用可不穿过原生错误响应；used/size 仅占用 | [原生 A6/A7/A8/B4/B5 R/T](../hermes-runtime/README.md#0224-原生-acp-steer-实测2026-10-28)。不直接计 Session，也不盲差分；两方案均未知。S/P/R/T |
| Grok Build ACP | `_x.ai/session_notification.turn_completed.usage` 当前 prompt 聚合 Delta | I 含缓存，O 含 reasoning；full total 可验证 | 终态到达消费，运行中 Context 单独上报；无尾部则可能缺消费 | prompt_id+Session；忽略重叠 response 与累计 result；[冷恢复 R](native-boundaries-verification-2026-10-01.md)。S/R/T |
| DeepSeek Harness | 私有 committed assistant/message 或 compaction/summary，逐记录 Delta | U/R/W 互斥；total 是含缓存全调用总量，O 含 reasoning | total-output 可推导 I，缓存仍 null；修复 total-only 丢失；不计 data.stream 重述 | Session+seq+turn，发送前 seq baseline；[遗漏修复 R](missing-fields-verification-2026-10-03.md)、[TokenUsage P](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/llm/llm/src/types.ts)。S/P/R/T |
| ZCode native turn | 当前 Session nativeTurnId/nativeEventId 的 provider usage，Delta | I 含缓存，O；上游合成 W/reasoning 零不作 presence | 只接 source=provider；Context snapshot revision 另路 | transport 根 Session/input 栅栏；[原生对账 R](missing-fields-verification-2026-10-03.md)。S/R/T |
| Antigravity stream-only | 当前 input step 后的根 DONE agent_response/checkpoint，逐 step Delta | Input 分类不完整，stream total 不含 R，不能当 full total；O 与 R 是可信且互斥的消费 | 只计 O/R，thinking 是 O 子集；不能用 known total 补猜其余输入 | 当前 conversation/input step、排除 subagent/result Session 累计；[真实数值 R](fixtures/round8-native-format-compatibility.json)。S/R/T |
| Antigravity native DB 补充 | 同根 DONE step 的 protobuf SQLite 数值，核对后替换 stream 来源 | U/R/W 互斥，O 含 thinking；typed proto3 桶省略零语义有证明 | missing parent/all-default placeholder 不准入；读取失败回到已验证 O/R，不清已有量 | trajectory/execution/generator/step 与 stream 相等才替换，二选一；[真实补齐 R](native-source-completion-2026-10-03.md)。S/R/T |

## 调用链与归属保护

`application.rs` 先按 Host、Prompt、Run/epoch 和 Session 路由，再把私有数值交给 `monitoring.rs`。
历史恢复 replay 在 ACP/Codex 原有路径隔离；插话的同一原生 Prompt 只归原 Run，不把接受回执生成第二笔消费。
native reader 启动 cursor 后只读本轮新记录；轮询跨完成边界的结果丢弃，MiniMax 单独复用已有本轮身份尾读。
重试为新的实际模型调用且有新身份时才累计；同一身份的 stream/terminal/journal 只拥有一份贡献。

buffer 以 Run/epoch 和来源组织有序帧；4 秒后台 flush 在一个短事务提交 checkpoint、Run summary 和 hourly。
原生 total 不是第二个相加来源；同调用后到字段必须修正贡献，不能再收费。
临时失败保留旧快照/待重试 batch，终态不清 checkpoint。读侧只查询轻量投影，不访问正文/Evidence/原生日志。
`execution-metrics-reader.ts` 继续限制可见 Run、单请求与隐藏暂停；RunCard 只消费 Core 的显示总量。

## 同样本比较

下表只统计 fixture 中有完整单位关系的原生数值样本。普通完成、工具后继续、同 Session 后继与冷恢复来自原证据；
Cline 按 native Run 分组。不同版本/模式不混作同一总体；没有原始调用关系时不从 Run 汇总推断方案 2。

| Runtime / 样本模式 | 可比较 Run 数 | 方案 1 有数值 | 方案 2 有数值 | 方案 2 舍弃的已知 Token |
| --- | ---: | ---: | ---: | ---: |
| antigravity-app / stream_only_unknown_input | 2 | 2 | 0 | 45,956 |
| antigravity-app / validated_native_sqlite | 1 | 1 | 1 | 0 |
| claude-code-cli / native_root_calls | 2 | 2 | 2 | 0 |
| cline-cli / plugin | 6 | 6 | 6 | 0 |
| codebuddy-cli / native | 1 | 1 | 1 | 0 |
| codebuddy-cli / native_root_calls | 2 | 2 | 2 | 0 |
| codex-cli / validated_run_counter_reference | 2 | 2 | 2 | 0 |
| command-code-cli / historical_headless | 2 | 2 | 2 | 0 |
| copilot-cli / subscribed_native_calls | 2 | 2 | 2 | 0 |
| deepseek-harness / native | 1 | 1 | 1 | 0 |
| grok-build / turn_completed | 2 | 2 | 2 | 0 |
| kimi-code-cli / native_root_calls | 2 | 2 | 2 | 0 |
| opencode-cli / native_root_calls | 2 | 2 | 2 | 0 |
| pi / native_root_calls | 2 | 2 | 2 | 0 |
| qoder-cli / custom | 5 | 5 | 5 | 0 |
| qwen-code / native | 1 | 1 | 1 | 0 |
| trae-cn-cli / native | 1 | 1 | 1 | 0 |
| zcode-app / native | 1 | 1 | 1 | 0 |

Copilot 使用两轮的逐调用原生数值，时间戳来自原证据的别名，不能当作本轮真实时间。
Codex 使用原探针已核验边界的两轮累计差作为独立同 Run 参考，并核对各 Run 落盘值；不是生产计量第二来源，
不与实际 `last` 逐调用重复累计。首次新 Session 的零基线与冷恢复后边界由原证据拥有，不以任意 Session 终值代替 Run。OpenCode V2、Kilo、MiniMax 有各自当前源码和受控/真实功能证据，
尚缺本轮可以公布的逐调用真实数值序列，不能拿 OpenCode V1 的统计数替代。Hermes、Kiro、Cursor 当前没有
符合范围的消费单位，两方案均无可展示数值；这些不纳入上表的可用性分母。
Qoder 非 custom 也不纳入 custom 的分母。

合成验收的 11 组单位中，方案 1 有数值 10 组，方案 2 有数值 6 组；方案 2 舍弃 170,000 个已知 Token，
对应缺互斥桶 55,000、只有 Output 5,000、只有 total 55,000、两个独立单边调用 55,000。
这不是线上丢失率。明确零两方案均为 0；完全未知均 null；失败/取消的合格 I/O 均 55,000。
不把不同调用分别上报的 Input/Output 拼接成方案 2 的有效单位。

可独立核对的 DSH full total 与两方案均相同；Pi 与 CodeBuddy/TRAE 的原生 full total 在已报告的完整调用中也一致。
Antigravity stream total 排除了缓存，不是同范围权威全量，不能计算“准确率”。
没有完整上游对照的其余样本只比较可核对的值。未声称覆盖率或账单完整性。

运行中：Claude 在第一条真实 message_delta 后可显示，后到桶/输出只修正该 message；原生逐调用来源在调用完成并经 flush 后更新。
方案 1 可以在首个可信单边数值出现时显示，方案 2 要等待同单位 I/O 有效；terminal-only 来源两方案都等原生响应。
恢复基线、reset、迟到补齐、重复与子代理隔离由确定性状态/事务测试验证；不冒充本轮 21 种 Runtime 的真实竞态验收。

## 采集修正与选型

确认并修复可证明的原生 full total 丢失、同调用字段补齐被去重拒绝，以及
OpenCode/Kilo 缺 reasoning 时已报告的普通 output 被清空。复核另补上 OpenCode/Kilo 和 MiniMax 已完成失败/取消调用
的正计数准入；其初始化全零失败占位仍不构成真实零。修正不能改变 Session 范围或扩大未知字段的含义。
Pi 的全零 native 占位无法辨别 provider presence 时不认作可信显式零；其他已验证方言的显式零独立保留。

采集修正的 `cargo test -p rovai-core --lib monitoring::tests::` 已先通过 12/12，再选择 **方案 1**。
完整 I/O 真实样本两方案相同，Antigravity 两个 stream-only 样本能保留 45,956 个已知 O/R；
没有证据证明所有 Runtime 都会稳定补齐同单位 I/O，因此不为“双项有效”舍弃这些可信消费。
不能由有限样本推断单边计数在线上普遍出现；选择依据是已证明的保留收益和统一产品目标，不是虚构的缺报率。
接受异步 reader、上游无 Usage、子 Session 未覆盖及保守去重引起的少计；不接受跨 Run、重复或把占用当消耗。
Hermes 的累计代次、Qwen 无调用 ID 的同值碰撞、各 Provider 的原始 presence、21 种 Runtime 的全部真实故障/子代理组合仍不能确认。

方案 1 可在既有逐来源 checkpoint 上计算已知贡献；方案 2 同样需要逐单位状态，不能直接使用 Run 的 Input/Output 汇总。
实现成本相近：一个 nullable Run 显示投影和一个 native full-total checkpoint 列；没有第二套采集器或前端聚合。
旧 Run 仅从现有 summary 的可证明不重叠数值给出保守投影，丢失的调用关系/total 不回填；
不读取已过期 checkpoint 或重新扫描原生历史。parser 6 之前已登记的旧 Run（包括恢复同 logical Run）显示固定为迁移时数值，避免把新身份算法套在已丢失关系的旧 checkpoint 上。


## 实施与验证记录

核查于 2026-11-15 开始，实施与最终验证于 2026-11-16 收口。

Core 在既有 buffer/checkpoint 上投影已知贡献，新增两个 nullable 数值列，不新增采集服务、正文记录或页面分支。
Native total、含缓存 Input、缓存桶与 Output/reasoning 各自遵守覆盖关系；同调用补齐、空帧、重放和复位分别处理。
Pi/Copilot 使用原生调用时刻（Pi 另含 Provider/模型）作为窄身份；缺少独立 ID 时，若上游复用同一时刻，
仍可能保守合并，不能凭 usage 数值变化制造一个新调用。此边界未取得全部上游模式的真实碰撞样本。
Kimi 恢复 baseline 也冻结没有 usage 的旧根 step；本轮空数值帧不阻挡后续同调用数字。
统计表保持可选，Migration 225 不因缺少可选用量投影阻塞 Core，也不重建原生历史。

复用现有 Rust owners，新增/删除/永久禁用 `#[test]` 均为 0。
Migration、原子回滚、可选统计、历史回执准入由既有数据库 owner 承接；schema 当前值使用仓库常量，
旧夹具沿正式迁移入口继续升级，保留原有事实不变断言。

| 验证 | 实际结果 |
| --- | --- |
| `python3 scripts/audit-runcard-token-samples.py` | 重建 48 组白名单比较单位：37 组既有真实数值，11 组合成边界；可重复生成相同 fixture |
| `cargo test --workspace` | 484 passed、0 failed，1 个既有 ignored；Core 438、CLI 31、Host 4、Web 11 |
| `cargo test -p rovai-core --features extended-tests --lib monitoring::tests::` | 13 passed；包括分区/事务失败恢复、total 覆盖子集、同调用补齐和两方案外部数值对照 |
| `cargo test -p rovai-core --features extended-tests --lib native_usage::tests::` | 3 passed；真实旧数值、根/子会话、历史、空帧迟到、SQLite 增量与失败正消费 |
| `cargo test -p rovai-core --features extended-tests --lib async_usage_migration_preserves_checkpoints_and_rolls_back_with_receipt` | 1 passed；225/旧 194 回滚、旧值/null/zero、缺可选统计的升级 |
| `cargo test -p rovai-core --features extended-tests --lib database_contract_preflight_admits_current_and_rejects_future_store` | 1 passed；历史回执与可选统计不导致旧迁移重跑，当前收据缺失仍拒绝 |
| `cargo test -p rovai-core --features extended-tests --lib current_migration_state_admission_matrix` | 1 passed；包括 schema 174 与当前通用指针 |
| `pnpm exec vitest run apps/desktop/src/renderer/src/execution-metrics-reader.test.ts` | 9 passed；直接消费投影、所有状态、零/未知、旧 epoch、可见性和读取失败保留 |
| `pnpm typecheck`、`cargo fmt --all -- --check`、`git diff --check` | passed |
| `pnpm test:execution-metrics-ui` | 隔离生产 Renderer passed；有值仅 `55K`、显式 `0K`、未知不回退分项、运行/等待/失败/取消、迟到更新、耗时气泡、500 Run 有界读取与五主题 |
| `pnpm docs:test`、`pnpm docs:check`、带 `DOCS_BASE_REF` 的 `pnpm docs:check:ci` | 源码隔离副本通过；10 个治理测试。工作区直接检查受到 Git 忽略的既有 `docs/prototypes` 断链干扰，未改写、移动或删除这些原型，也未添加 checker 例外 |

UI 自动验收使用新建临时 `userData` 与其下的 Skill 目录，不启动 Core 或真实 Runtime；截图和白名单断言来自同次生产组件。
本轮未重新实跑所有 Runtime 的真实模型/Provider/操作系统组合；历史真实数值、协议判断与受控测试不能彼此替代。
本次不改变原生 Runtime 资格、Activity、监控页、定价、模型输入或版本生命周期。当前规范是
[Usage v12](../../contracts/runtime-usage-monitoring-v12.md) 与 [Execution Metrics v8](../../contracts/runtime-execution-metrics-v8.md)。
