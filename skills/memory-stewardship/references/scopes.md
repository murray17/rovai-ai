# Scopes、Kind 与方向

多个 Scope 看似合理时，选择能完整表达含义的最小 Scope。修订不能改变既有 Memory 的
Scope、Kind、counterparty 或 Relationship direction；需要不同身份时重新判断是否新增。
View/Read 返回的 `target` 是不可分割的目标身份而非可编辑字段；revise 必须原样复制并让 Core 校验，
不能仅凭相似正文或“这个 Memory 也在我的可修改集合中”推断目标。

## Companion

保存用户与当前队员之间的稳定协作理解，允许 `preference`、`agreement`、`lesson`。当前队员只能新增或
修订自己的 Companion；成功 `outcome: effective` 后立即用于后续协作。

判断：这件事是否只需要我以后与用户协作时记住？

## Relationship

保存当前队员与当前 Camp 中另一位在场队员之间的协作约定或经验，只允许 `agreement`、`lesson`。
Agent 只能新增或修订 `当前队员 → counterparty` 的 `directed` Relationship：方向表示当前队员对对方承担
未来责任。Agent 不能写 `mutual`、反向 directed、另一队员的 Companion，也不能替对方承诺。

Agent 可以读取适用于自己的既有 mutual Relationship，但这不授予修改权。
Mutual 只属于 structured user governance。

Relationship View 是 actor-relative exact-pair applicable View：对当前 Agent A 与 counterparty B，只返回
`directed(A -> B)` 和 `mutual(A, B)`，不返回 `directed(B -> A)`。它不是用户治理面上的完整 pair。

判断：这件事是否只影响我对某位在场队员今后的协作方式？

## Hearth

保存本地 Rovai home 内所有 AgentProfile 都应理解的 application-global 偏好、原则或经验，跨 Camp，
但不是 Camp-wide Memory。允许 `preference`、`agreement`、`lesson`。Agent 仍用
`rovai memory write` 提交，但 Core 只创建隔离的 pending Hearth Review Item；成功输出必须是
`outcome: review_pending`。候选不会成为 Memory、Revision 或 Agent 可读内容，只有用户接受后才生效。

判断：这件事是否应该让用户的所有队员都知道？

## Active 容量

条数上限与 active current body 总字节上限同时生效：Hearth application-global 为 32 条 / 16 KiB；
Companion 每个 AgentProfile 为 32 条 / 16 KiB；Relationship 每个 unordered pair 为 12 条 / 12 KiB。
Retire/Forget 释放 active 配额。收到 `memory.capacity_exceeded` 时停止，不拆成语义碎片规避配额，也不把
同一 `runtimeToolCallId` 当作新命令重试。

Retire、Reactivate、Forget、Supersession、Review schedule 和 Review decision 都只属于 structured user
governance。不要用相反正文模拟 Forget。
