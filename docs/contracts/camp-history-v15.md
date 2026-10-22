---
document_type: protocol-contract
contract: camp-history-v15
authority: public-camp-history-read-scope
status: accepted
version: 15
source_version: v1.72
last_updated: 2026-10-22
---

# Camp History v15

继承 [v14](camp-history-v14.md) 的身份、实时目录、显式公开读取、搜索、消息投影、撤回、引用和附件规则。
仅为 `thread.read` 增加 `after` 正向分页；公开命名沿用 [Thread Naming v1](thread-naming-v1.md)。

## 输入

`threadId` 可省略，仍选择当前公共 Thread。封闭输入接受以下互斥形式：

```ts
type ThreadReadInput =
  | { threadId?: string; messageId: string }
  | { threadId?: string; replyChain?: string; before?: number; limit?: number }
  | { threadId?: string; replyChain?: string; after: number; limit?: number }
```

`before` 必须为正整数，`after` 必须为非负整数，均在有符号 64 位整数范围内。
`before` 与 `after` 不能同时出现；单条 messageId 不能与 replyChain、before、after 或 limit 组合。
错误类型、负值、小数、未知字段及非法组合明确报参数错误，不静默钳位、转换或忽略。
不接受 `since`、`all`、`mode`、`direction` 或通用 `cursor` 输入。

默认 timeline 取最新页；未给 cursor 的 replyChain 保持从锚点向前读取且包含锚点的原行为。
limit 默认 20，显式允许 1–100。CLI direct flags、JSON stdin 与 input-file 采用同一 Schema。

## 正向读取与续页

`after N` 在所选集合中取 `sequence > N` 的最早 limit 条，始终按 sequence 升序输出。
`after 0` 从最早可见消息起读。replyChain 只选取回复链，序列号仍属于整个 Thread；
显式 cursor 可以早于锚点，但不能绕过锚点存在、归属或可见性校验。
N 无须对应现存消息，允许 tombstone 等导致的序列空洞；没有合格消息时正常返回空页。

输出继续使用已有封闭 Schema：`mode`、`direction`、`items`、`hasMore`、`nextCursor` 及对应定位字段。
正向页 `direction=after`；在本次读视图中仍有合格项时，hasMore=true，nextCursor 等于本页末项 sequence，
下一次传 `--after <nextCursor>`。无后续项或空页时 hasMore=false、nextCursor=null。
before 保持排他上界，nextCursor 取本页首项，下一页继续传 before。
撤回 marker 仍占一条消息和页容量；tombstone 不返回。

每次调用在自己的事务读视图内解析实时边界；后续调用可以看到新消息，不提供跨页冻结快照。
hasMore=false 只描述本次查询，旧消息后来发生的修改或撤回不因 after 重新投递。
调用方在成功处理后按 Thread/读取范围保存最后 sequence，空页保持原位置；
回复链进度不等于完整 timeline 进度，historyHint 不证明读取或处理。
工具自身不保存已读位置、不 claim Delivery、不改变 accepted 水位或执行状态。

## 兼容

原请求与返回 shape 保持兼容，direction 输出 Schema 原已允许 after。
History 合同为 15；配套 CLI/Core 准入见 [Transport v44](builtin-tool-transport-v44.md)。
无数据库迁移、历史结果/receipt 回填、Native Session 或 Bootstrap 失效。
