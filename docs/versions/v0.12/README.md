---
document_type: version-overview
version: v0.12
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-27
---

# Rovai-ai v0.12 公共消息层检索与渐进摘要上下文治理

> 状态：实施完成；编码检查点 7/7
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.11 受控品牌与技术标识迁移](../v0.11/README.md)
>
> 跨版本决策：[ADR-0049](../../adr/0049-reproducible-context-delivery-v2.md) ·
> [ADR-0050](../../adr/0050-camp-shared-progressive-summaries.md) ·
> [ADR-0051](../../adr/0051-boundary-capped-context-retrieval.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.12 重构公共消息区与消息层的上下文供给方式。公共消息以 `camp_message` 为唯一事实源、
仅引用不复制；成员获取公共上下文收敛为四个策略：

- **相关搜索**：FTS5 trigram 全文检索 + 摘要检索 + 精确引用查询，经统一工具 `context.search`
  暴露；不足 3 字符的短查询自动回退有界 LIKE 扫描。
- **小范围原文**：`context.get_message` / `context.get_message_window` / `context.get_message_thread`
  按需回读单条、时间邻域与回复链，输出条数与片段长度有硬上限。
- **结构化状态**：Context Briefing 在 Bootstrap 与溢出投递时注入未读区间、覆盖摘要、
  发送者活跃度、open Task、pending ActionRequest、引用聚合与点名清单；各区段有独立上限，
  截断显式标注。
- **渐进摘要**：Camp 级共享的 Segment/Epoch 两级摘要，阈值触发异步生成，两级封顶，
  旧 Epoch 经 `context.search` 定位、`context.get_summary` 全文加载。

同时将 Native Delivery Cursor 更名为 **Context Read Marker**
（字段 `native_read_through_camp_message_sequence`），语义收敛为诚实的投递确认水位。

## 范围内变更

1. **术语与字段更名**：Context Read Marker 落库、落代码、落文档（[CONTEXT.md](../../../CONTEXT.md)）。
2. **去物化**：删除公共前缀向 `conversation_message` 的全文物化、gap 校验与
   `last_seen_camp_message_sequence`；AgentRun 触发指针二选一直指 `camp_message` 或私有
   `conversation_message`。
3. **摘要层**：新表 `camp_summary`（segment/epoch）；删除旧 `context_summary` 表与代码；
   阈值触发异步生成；应用级摘要模型配置与回退链。
4. **索引层**：`content_digest` 回填；`camp_message_fts` / `camp_summary_fts`（trigram）；
   `camp_message_reference`（`ADR-\d+`/`PR-\d+`/`issue-\d+` 文本模式 + 完整 Task UUID
   精确比对，不抽取 `task-\d+`）；`camp_message_mention`；`index_version` 整层重建。
5. **投递改造**：统一组成算法（正常/溢出/Bootstrap 共用）；软预算 60,000 字符约束原文，
   摘要注入预算 24,000 字符，超出部分落入 Coverage Baseline（briefing 声明 + 检索可达）；
   未覆盖尾部全部原文，未覆盖序列不得静默跳过；点名/回复本 Agent 的未读消息原文投递
   保证（≤ 20 条，超出在 briefing 引用列出）。
6. **工具组**：Team MCP 网关新增 `context.*` 五工具（含 `context.get_summary`），
   冻结边界封顶，tombstone 实时过滤，输出条数/片段长度硬上限。
7. **事件消息**：用户审批决定与 Task 状态变更落为 `author_type='system'` 的 CampMessage，
   进入增量、摘要与搜索，不设 recentEvents 旁路。

## 非目标

- 不做 semantic / vector / hybrid / embedding 检索。
- 不做公共消息编辑（不加 `edited_at`）与消息删除功能；tombstone 列与读取过滤保留，
  删除时的摘要级联设计已存档于 ADR-0050。
- 不抽取文件路径引用；不做阈值常数的用户配置面。
- 不改 `camp_message` 既有列名（`body` / `author_*` / `reply_to_camp_message_id`）。

## 关键常数

| 常数 | 值 |
|---|---|
| 公共上下文软预算 | min(Adapter 推导切片, 60,000 字符)，约束原文部分 |
| Segment 输入预算 | 60,000 字符（主阈值） |
| Segment 条数 | 300 双重语义：触发阈值 + 单段覆盖上限；禁止「< 100 条且 < 60,000 字符」碎片（此类尾部全部原文投递） |
| Epoch 触发 | 12 个未覆盖 Segment，或正文合计 ≥ 40,000 字符（护栏） |
| 溢出/Bootstrap 保留原文 | 最近 30 条（无条件下限） |
| 摘要注入预算 | 24,000 字符，自新向旧；超出部分落入 Coverage Baseline |
| 摘要正文上限 | Segment ≤ 2,000 字符；Epoch ≤ 4,000 字符 |
| Context Briefing | 总量 ≤ 8,000 字符；Task/ActionRequest 各 ≤ 10（组装时点快照）、引用聚合 ≤ 20、涉及本 Agent ≤ 20 |
| 点名原文保证 | ≤ 20 条，超出在 briefing 引用列出 |
| 检索输出 | 单条正文注入 ≤ 4,000 字符（可续读）；单次响应 ≤ 16,000 字符；search limit ≤ 20、片段 ≤ 200 字符；window 半径 ≤ 25；thread 单次 ≤ 100 条；附件元数据 ≤ 10 项；短查询 LIKE 扫描 ≤ 10,000 行 |
