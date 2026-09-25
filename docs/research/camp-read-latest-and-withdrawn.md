---
document_type: research
authority: camp-read-latest-and-withdrawn-design-input
status: implemented-design-input
last_updated: 2026-09-24
---

# `camp.read` 最新读取与撤回占位：方案草案

本文保留实施前方案的推导；当前规范由 [Camp History v10](../contracts/camp-history-v10.md) 拥有，实施范围与验收见 [v1.69](../versions/v1.69/README.md)。目标是让队员主动读取或搜索公屏时找到已发布消息；本地用户在首个目标 claim 前仍可撤回，即使 Agent 曾通过读取或搜索看到原文。撤回后的下一次读取返回英文状态项。

## 实施前已核对的现状

- 不带 `--before` 的 `rovai camp read --limit N` 从调用时最新的**可见**消息中选 N 条，`items` 按 sequence 从旧到新返回；`--before` 只读取更早的页。[Core 读取入口](../../crates/rovai-core/src/camp_history.rs)每次查询目标 Camp 的当前 sequence，不受本 Run 的 ContextManifest 历史上界限制。这一边界在 v10 保持不变。
- v9 的 `camp.read`、`camp.search` 和 `history.search` 查询都过滤仍可撤回的消息、已撤回消息，以及当前队员自己尚未领取的 Delivery。已撤回消息按 ID 读取返回 `message.withdrawn` 错误，时间线没有对应项。
- [撤回事务](../../crates/rovai-core/src/collaboration.rs)以 `recall_state = recallable`、消息版本及所有 Delivery 仍为 `waiting` 为条件；成功后取消等待中的 Delivery，清空正文、结构化内容、引用、附件关系和回复关联，保留消息 ID、sequence 与撤回状态。`camp.read` 本身不执行 claim。

因此，v9 的“读不到最新”主要是可见性过滤，不是无游标读取的上界停在旧 Run。

## 建议行为

1. **主动读取最新原文**：`camp.read` 的时间线、按 ID 和未撤回消息的线程读取，在调用时选择已发布、未撤回的消息。仍可撤回的本地用户消息，以及当前队员 Delivery 尚为 `waiting` 的消息，也以正常消息项返回原文；正常项沿用现有 body、metadata、引用和附件投影。`--limit`、`--before` 和返回顺序保持不变。
2. **主动搜索同样可发现**：`camp.search` 和 `history.search` 在各自现有的发布边界内，也可命中仍可撤回或本队员 Delivery 尚为 `waiting` 的已发布消息；结果沿用现有 snippet、排序和边界。当前 Camp 的 `camp.search` 仍按调用时最新状态搜索，跨 Camp 的 `camp.search` 与 `history.search` 仍受本 Run 冻结的全局发布边界限制。搜索不返回已撤回消息，也不把撤回占位当作可搜索正文。
3. **claim 仍是撤回边界**：读取和搜索都不领取 Delivery、不关闭撤回资格、不推进 accepted 水位，也不把新消息加入当前 Run 的冻结输入。首个目标 claim 前，用户仍可按现有版本条件撤回；即使此前 Agent 主动读取或搜索过，撤回也不因此失败。首个目标 claim 后维持现有不可撤回规则。既有工具返回不追溯改写；再次读取或搜索时使用新的数据库状态。
4. **撤回后的英文占位**：时间线和按 ID 读取将已撤回消息投影为状态项，例如 `{ "messageId": "…", "sequence": 42, "withdrawn": true, "displayText": "Message withdrawn" }`。状态项在原 sequence 位置占一个分页名额；`displayText` 由读取投影生成，不写回已擦除的 `body`，且不含原正文、quotes、附件、寻址、作者或回复信息。正常消息仍使用原有字段。状态项只能从目标公开 Camp 内、当前读取边界内的消息生成，不能靠 ID 探测未授权或未发布消息。
5. **其他入口**：v1.68 的新公开 Run 已不自动注入公共历史；`RUN_INPUT` 和引用来源投影仍按各自现有可见性规则处理，已撤回内容不进入这些入口。`--thread` 对已撤回 anchor 及撤回前的回复位置暂沿用现有不可恢复语义：撤回事务已经清除回复关联，不能仅靠当前消息行准确放回原线程。

## 改动位置与验收

- **Core 与输出合同**：在 `camp_history.rs` 为显式读取和搜索放宽 `recallable` 与本队员 `waiting` 过滤，不改变冻结输入；时间线、按 ID、线程选页和投影处理正常项与撤回状态项，在 `team_tool_catalog.rs` 为两种 read item shape 更新输出 Schema，并同步 CLI 帮助。撤回事务和 claim 条件不变。
- **当前权威**：实施以 [Camp History v10](../contracts/camp-history-v10.md)、[公共历史不变量](../architecture/foundational-invariants.md#context-public-history)和[消息与 Delivery 架构](../architecture/public-a2a-message-delivery.md)固定“显式读取／搜索可见”与“冻结输入仍隔离”；版本范围见 [v1.69](../versions/v1.69/README.md)。显式工具输出改变需按[双轨评测 Gate](../development/evaluation.md#上下文改动-gate)保存前后对照与验证证据。
- **验证**：同一 Run 中新消息发布后无游标读取、claim 前按 ID 读取原文与当前 Camp 搜索命中、读取或搜索后仍能撤回、撤回后再次读取 ID 与 `--limit 1` 都得到 `Message withdrawn` 且搜索不再命中、旧游标翻页、跨 Camp 搜索不越过冻结发布边界、首个 claim 后撤回失败；检查状态项无原正文／引用／附件／寻址泄漏，且冻结输入与引用来源过滤未被误放宽。先按[Rust 测试准入规则](../development/testing.md#rust-测试准入与退役门槛)选择既有 owner 测试，文档运行通用门禁。
