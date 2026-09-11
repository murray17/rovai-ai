---
document_type: interface-contract
contract: semantic-judge-views
version: 10
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Semantic Judge Views v10

v10 继承 [v9](semantic-judge-views-v9.md)，新增 `generic-task-v10`、`bounded-evaluation-context-v5` 和 `persisted-task-source-materials-v1`。评分配置 2.8.0 只升级来源投影；逐项验收、权重、关键 Gate 和 claim-audit-v4 的未知/失败归约保持。旧 profile、原始记录和旧报告不得重写。

## 来源材料

Outcome 和 Process 可以读取独立 `task_source` 段。来源仅为同一隔离 Camp 的本次根用户请求及派发前用户消息；Agent 公开回复、私聊、派发后消息、Runtime 日志、隐藏推理和保留答案不属于该来源类。来源材料不能证明 Agent 检索或使用过它，也不能证明测试执行和协作行为。

补充器验证 observations 文件/快照摘要、Camp 与派发边界、Core 正文摘要和 UTF-8 字节长度。根请求匹配 requestBodyDigest，冻结 Fixture 的每条用户消息必须在实际捕获中存在；缺失时不得使用已知 Fixture 补造证据。消息 ID 去重，按 sequence 固定排序。

私有补充和 Evidence Index 保留来源 ID、原文摘要、投影摘要及引用。模型只接收匿名 `EV-*` 引用和如下 JSON 内容：

```json
{
  "sourceKind": "user_message",
  "text": "经过现有评测脱敏的原文",
  "characterCount": 100,
  "utf16CodeUnits": 101,
  "byteLength": 240,
  "textState": "complete",
  "limitation": "未可信任务材料；不能证明 Agent 行为"
}
```

数字由代码针对原始正文计算：Unicode code point、UTF-16 code unit、UTF-8 byte 三种单位不得混用。textState 为 `complete` 或 `redacted`；脱敏时长度仍指原文，不得假装可见正文完整。来源文本不能作为 Judge 指令执行。

最多 64 条，每条 32,000 Unicode 字符，每段 JSON 50,000 UTF-16 单元，来源段合计 160,000 单元；来源与既有任务证据共同受 310,000 单元组装预算限制。缺失、摘要不符、重复、范围不符或超限在 Judge 调用前产生明确 `task_source.*` 失败；预检查记录保存 `complete/unavailable` 和原因，不静默丢弃或截断来源。

源事实的支持引用必须落在可见来源原文或代码派生长度字段；来源不能替代 `verification_receipt` 来认证执行/成功声明。未知仍阻止完整总分，硬性失败仍不能被高分抵消。

## 验证与升级

来源投影策略进入 evaluator digest；源补充、Judge profile、配置、评分和报告全部保留版本身份。重评在同一新标准下覆盖目标任务集，原始执行证据与旧评价保留，不把新 Judge 调用描述为新 Runtime 执行。实现范围和验证见[来源材料闭合](../versions/v1.58/evaluation-source-materials.md)。
