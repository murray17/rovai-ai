---
document_type: version-overview
version: v1.00
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v1.00：用户确认后的 Camp 强制永久删除

> 当前状态：[ADR-0206](../../adr/0206-user-confirmed-force-camp-deletion.md)与
> [Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)已经接受；Core、Renderer、
> Runtime cleanup 与自动化已经完成，证据见[实施计划](implementation-plan.md)。
>
> 前置版本：[v0.99 最小 Runtime Usage Metering](../v0.99/README.md)
>
> 后续版本：[v1.01 TRAE 与 Kiro 最高权限队员默认](../v1.01/README.md)

## 版本目标

把永久删除从“必须先手工收敛全部协作状态”改为“用户在不可撤销 Dialog 中确认后直接物理
删除”。Core 继续拥有 User-only、精确版本、幂等与单事务完整性；force 模式在提交删除后按已
捕获的 Run 身份停止 Runtime 并清理 Camp 私有资源，不删除项目目录。

## 交付范围

- `DeleteCampCommand` 新增默认关闭的 `force` 字段，保留旧客户端的结构化 blocker 行为；
- production Renderer 的确认 Dialog 直接提交 `force: true`，不再要求先打开会话、停止运行或处理
  待审批状态；
- 强制删除返回实际绕过的 blocker 摘要，SQLite 聚合删除仍保持单事务和外键完整；
- Core 在提交后停止精确 AgentRun Runtime、移除 active execution、失效 Camp Resident，并沿既有
  边界清理受管附件；
- 迟到回调只能观察 Camp 不存在，不得重建历史；已经发生的外部副作用不被描述为已撤销。

## 明确不做

- 不增加 Archive、Trash、恢复、`deleting` 或后台删除生命周期；
- 不物理删除 AgentProfile、项目目录、普通 Git branch/worktree/file/commit 或 Provider 历史；
- 不把 force 变成 Agent 可调用能力，也不跳过 User actor 与 `expectedVersion`；
- 不改变普通 `force: false` 调用的静止门禁和 blocker 结构。

## 验收边界

- Rust 证明普通删除继续阻塞，force 删除能在同一事务移除非终态 Run/CampTurn 和全部聚合关系；
- Main handler 证明删除前捕获 Runtime identity，提交后按 Adapter 停止并失效 Camp Resident；
- Renderer 请求包含 `force: true`，Dialog 文案准确且无旧“重新检查/打开对话”死路；
- 定向 Rust/Vitest、TypeScript、Desktop build、文档门禁、格式化、Clippy 与 Impeccable detector 通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.99 冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.00。 |
| ADR | 已更新 | [ADR-0206](../../adr/0206-user-confirmed-force-camp-deletion.md)局部替代 ADR-0058 的 quiescence-only 删除要求。 |
| Contracts | 已更新 | [Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)冻结 command、结果、blocker 与 Runtime cleanup 语义。 |
| Architecture | 确认无需更新 | Core transaction、Runtime Fleet 与受管附件组件边界不变；新组合由 ADR 与字段级合同完整表达。 |
| UI | 确认无需更新 | 保留既有 Rovai Dialog 组件和视觉系统，只移除 blocker 分支并校准破坏性文案，不建立新的跨页面 UI 组件合同。 |
| Runtime Activity | 确认无需更新 | 不新增或改变 Runtime Activity 映射；删除后的迟到事件被 Camp absence fence 丢弃。 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime 准入、协议支持或版本结论。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT/HISTORY 与 Contract 索引增加强制永久删除入口。 |
| Root README | 确认无需更新 | 项目定位与公开支持范围不变；该行为由当前版本和长期合同拥有。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0206](../../adr/0206-user-confirmed-force-camp-deletion.md)
- [Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)
