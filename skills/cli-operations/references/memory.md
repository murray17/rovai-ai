# Memory：只做领域路由

当信息可能是跨未来 AgentRun 仍有价值的稳定偏好、未来协作约定或可复用经验时，使用
`$memory-stewardship` 判断是否应进入 Memory、选择 Scope/Kind、查重、读取和执行最小 mutation。

根据该 Skill 的决定，再查看具体 operation：

- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`

Hearth、Companion 与 directed Relationship 都通过 `memory write`；Hearth 的成功结果是
`review_pending`，不是已生效 Memory。Mutual Relationship 与 Lifecycle/Forget/Review decision 只属于
structured user governance。

本 reference 不拥有 Memory 的 authority 顺序、Entrypoint/cache state、安全边界、Revision、正文或
retrieval-key 限制；这些规则全部由 `$memory-stewardship` 管理，不能用这里的 CLI 路由摘要替代。

当前任务、临时计划、项目事实、历史证据或需要追踪的责任分别属于 Task、项目权威来源或 Camp/History，
不要为了跨 Run 可见而一律写成 Memory。
