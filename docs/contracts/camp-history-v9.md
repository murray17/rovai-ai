---
document_type: protocol-contract
contract: camp-history-v9
version: 9
status: accepted
authority: public-camp-history-read-scope
last_updated: 2026-09-23
---

# Camp History v9

继承 [v8](camp-history-v8.md) 的认证、全部存续公开 Camp 读取范围、实时可见性、附件、recipient suppression、撤回与 quote source 过滤。新公开 Run 不再自动投递 `SHARED_CONVERSATION`；Agent 按需使用 `rovai camp read` 查询。Manifest 的旧历史字段仍保存旧行，但新 Manifest 29 不以它们作为自动上下文。

`camp.read` timeline 和 thread 的 `--limit` 省略时默认 20；显式值只接受 1–100 的整数。0、101、负数、非整数及非数字明确报参数错误，不钳位或静默代换。符合条件的消息超过本页数量时返回完整本页、`hasMore=true` 和可续读的 `nextCursor`；不足时返回实际可见消息、`hasMore=false` 和 `nextCursor=null`。页内按 sequence 升序；`before` 是排他游标，从最新页往较早消息翻。`messageId` 精确读取不接受 `limit`。

`RUN_FACTS.historyHint` 中的执行前边界仅供判断相关历史，不是 `before` 游标，也不保证一次请求覆盖边界以后的全部消息。Agent 可从最新页按需逐页倒翻；读取不 claim Delivery、关闭撤回或推进 accepted 水位。跨 Camp 搜索与冻结全局 publication boundary 继续继承 v8。
