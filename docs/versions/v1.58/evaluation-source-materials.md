---
document_type: implementation-plan
authority: evaluation-source-materials-change
status: implemented
last_updated: 2026-09-11
---

# 结果 Judge 的来源材料闭合

## 问题与范围

真实混合队伍回归 DEMO-110 的产物正确，但最终回复引用了输入长消息的长度和末段原文。原始 observations 已保留全文及摘要；旧 Outcome 只接收产物、完成回复和验证回执，不能核对这类来源事实。本项只修评测器，保留 DEMO-106 的真实任务失败，不修改 Case 题目、产品上下文、Skill、普通用户数据库或权限。

## 实施前方案 revision 1

此前：`generic-task-v9` / `bounded-evaluation-context-v4` 不投影用户提供的 Camp 来源正文。

此后：新增 `generic-task-v10` / `bounded-evaluation-context-v5`，通过专用 `task_source` 段传递已持久化、同一隔离 Camp、派发前的用户消息与本次根请求。段内容为 `{sourceKind, text, characterCount, utf16CodeUnits, byteLength, textState, limitation}`；真实 ID、原始正文摘要及引用保留在私有 Evidence Index，不放入 Outcome。

原始正文必须与 Core body digest、字节长度相符；根请求同时匹配派发摘要。冻结 Fixture 中每条用户来源须在实际 snapshot 中存在，不使用 Fixture 字符串补造运行证据。按消息 sequence 固定排序，去重 ID；每条最多 32,000 Unicode 字符、JSON 段最多 50,000 UTF-16 单元、总段预算 160,000 单元、最多 64 条。预算不足、缺失、摘要不符或重复 ID 在 Judge 调用前明确失败并保留原因，不静默截断。

原文沿用评测脱敏边界；脱敏后标注 `redacted`，原始长度与可见正文长度不能混淆。来源内容是未可信任务数据，只可支持来源事实，不能证明 Agent 执行过检索、调用、测试或完成协作。Process 继续独占成员过程正文；原生日志、隐藏推理、私聊、保留答案不加入 Outcome。

评分配置升为 2.8.0，权重、Case 验收、关键项和 claim-audit-v4 判定不变，仅升级来源/投影 profile。旧配置和旧报告保持原样，新标准重新评价保留证据，不拼接不同标准得分。

开发者于本轮明确要求优化 110 的证据获取；此前已授权必要实现细节由实现者决定、实施后汇总。本项不触发产品 Bootstrap/Dynamic Context 的变更确认；上述方案在修改代码前记录。

## 验证与预算

- 原始 DEMO-110 回放先复现缺失；修复后新输入必须包含独立正文与长度，引用可解析。
- 测试相同尾文出现在 Agent 回复时不能自证；用户原文缺失、篡改、超限、派发后消息、其他 Camp、脱敏和 Unicode 长度。
- 测试旧 profile 不接收新材料，结果/过程隔离保持，来源文本不能认证测试执行；评分复算与硬失败门槛不变。
- 在独立证据目录重评这次 12 Case，沿用 sol/medium Judge，每 Case Judge 上限 600 秒、并行 2，总预算 7,200 秒，最多一次证据修复后的重评。不重新运行用户任务或 MiniMax，也不覆盖旧结果。若有失败/未知照实保留。

## 实际结果

2026-09-11 按上述预算完成一次 12 Case 保留证据重评，Judge 为 sol/medium，评分为 2.8.0。评测器提交 `063c612f6da1adb152b701c8217faeb243d6a9ad`；原任务执行仍属于产品提交 `f32874d596eeed638b446da7258dc156f1b8df1c` 和任务集 2.9.0。本次没有新的 Runtime 或验收命令执行，不能将重评差异解释为队伍能力提升。

- DEMO-110：同一复现脚本对旧输入失败、对 v10 输入通过。两份真实 Outcome Judge 均引用独立来源，确认 19,975 字符和末段签收条件；声明一致性满足，Case 质量 100，覆盖率 100%。
- 12/12 来源预检完整，逐条比较预检材料与最终 Outcome 输入，正文投影完全一致。原 observations、规则和硬性检查结果及旧报告摘要保持不变。
- 106 项实现测试及文档治理通过。报告分数独立复算一致，62 个 HTML 本地链接通过检查。
- 全套结果仍不可发布完整总分：DEMO-106 保留功能验收失败，质量 39.58；DEMO-104 的 Judge 将 Camp 报告／已发布结论声明纳入核验后得到未知，暴露判定范围不稳定；DEMO-105 的一份 Outcome Judge 超时。34 次 Judge 请求中 33 次取得响应、1 次超时，全部保留。全套加权质量评价覆盖率 92.01%，硬性通过 11/12；不是全套通过。

证据目录标识为 `evaluation-source-evidence-20260911-i4y29ejb`，包含 `reports/attempt-01/report.json`、离线 HTML、`reproduction-verification.json`、`source-projection-verification.json` 和 `run-verification.json`。演示时先查看 DEMO-110 的逐声明审计及来源引用，再查看原始重现失败和新输入通过，最后查看保留的 DEMO-106 失败以及 104/105 缺口。

保证范围仅为本协议声明且已持久化的 Camp 用户来源；外部网页、附件等没有因此获得完整证据。超限、缺失和摘要不符仍在 Judge 前失败。104 的范围判定与 Judge 超时稳定性是另外的待治理问题，本次未修改评分范围或反复调用直至通过。
