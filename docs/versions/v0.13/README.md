---
document_type: version-overview
version: v0.13
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-27
---

# Rovai-ai v0.13 伙伴经验自动沉淀与分级记忆权威

> 状态：实现与验收完成；编码检查点 6/6
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.12 公共消息层检索与渐进摘要上下文治理](../v0.12/README.md)
>
> 跨版本决策：[ADR-0052](../../adr/0052-explicit-memory-revision-authority.md) ·
> [ADR-0055](../../adr/0055-explicit-opt-in-provisional-companion-lessons.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.13 在不放宽 Hearth、Relationship、偏好、约定和修订治理边界的前提下，让每位
Companion 可以自动形成少量、明确标记为 provisional 的可复用 Lesson。

用户通过应用级策略预先授权这一条低爆炸半径路径。Agent 仍只调用
`memory.propose_change`；Core 根据实时策略、冻结 Capability、Scope、Kind、配额、
容量和安全闸门，在同一事务中决定“自动形成 provisional Memory”或“保留 pending
Proposal”。Agent 不能选择或伪造最终权威。

## 已确认范围

1. **Revision 权威分级**：`MemoryRevision` 增加
   `user_confirmed | provisional` 权威；现有可读 Revision 全部迁移为
   `user_confirmed`。
2. **同正文确认**：用户确认 provisional Memory 时，以 CAS 创建同正文的
   `user_confirmed` Revision，并保留 `confirmedFromRevisionId`。
3. **唯一自动矩阵**：仅 `add + companion(self) + lesson` 可以自动生效；
   Hearth、Relationship、Preference、Agreement 和全部 revise 继续逐条确认。
4. **双重配额**：每个 AgentRun 最多自动形成 1 条；每个 Companion 最多同时拥有
   8 条 active provisional Memory；现有每 Run 4 条 Proposal 和 Companion
   64 条/64 KiB 总容量继续生效。
5. **实时全局策略**：新安装与旧数据库升级均默认关闭，不显示启动弹窗；用户可在
   「设置 → 记忆」主动开启。开关在每次工具事务内实时读取，关闭只阻止未来自动
   形成，不处理已有 provisional Memory。
6. **原子自动决议**：Proposal、Memory、Revision、`resolutionMode=policy_auto`、
   策略版本、事件和幂等结果同事务提交。
7. **严格失败语义**：自动预算或容量不足时合法 Proposal 降级为 pending；stale/CAS、
   secret、no-op、duplicate、越权和无效输入保持失败，不保存无效候选。
8. **分级 Projection**：confirmed 与 provisional 分区渲染；confirmed 优先，
   provisional 明确是未确认假设，不能授予权限或覆盖当前输入和已确认记忆。
9. **持久透明度**：会话内聚合轻通知；记忆管理页提供长期 provisional 筛选、数量、
   确认、编辑确认、停止沿用、遗忘和受 CAS 保护的窄撤销。
10. **Stewardship v2**：同一 `memory-stewardship` Skill 学会区分 pending 与 effective
    provisional receipt，不能把 provisional 描述为用户确认。

## 非目标

- 不自动形成 Hearth 或 Relationship Memory。
- 不自动形成 Preference 或 Agreement。
- 不自动 revise 任何 Memory，也不自动替代、retire、reactivate 或 forget。
- 不根据模型置信度、重复次数、多 Agent 投票或时间自动转正。
- 不自动过期、淘汰、合并、压缩或语义去重 provisional Memory。
- 不新增通用 Fact、Observation、Personality、Capability Score 或敏感度 Kind。
- 不新增 Memory 搜索、向量检索、云同步、自动导入或外部备份。
- 不把 live Projection 声明为同一 OS 用户下的文件系统安全沙箱。

## 关键常数

| 常数 | 值 |
|---|---:|
| 每 AgentRun 自动形成上限 | 1 |
| 每 AgentRun Proposal 总上限 | 4（既有） |
| 每 Companion active provisional 上限 | 8 |
| 每 Companion active Memory 总上限 | 64（既有） |
| 每 Companion active 正文总量 | 64 KiB（既有） |
| 单条正文上限 | 2 KiB（既有） |
| provisional Lesson 默认复核 | 30 天 |
| user-confirmed Lesson 默认复核 | 90 天 |

## 当前版本状态

ADR-0052/0055 已确认并完成权威切换。Migration v23/v24、Core 命令、原子自动形成、
工具 receipt、Projection v2、Bundled Skill v2、Export v2、诊断、Renderer 管理面与
真实 Runtime/App 验收均已完成，逐项证据见[实施计划](implementation-plan.md)。

已通过的最终验证包括：

- `cargo fmt --check`、`cargo clippy --workspace --all-targets -- -D warnings`；
- `cargo test --workspace`：Core library 166 项、Core main 33 项通过，4 项既有手工
  Runtime smoke 保持 ignored；
- `pnpm typecheck`、9 个 TypeScript test files / 53 项测试；
- `pnpm smoke:core`、`pnpm smoke:memory`；
- bounded Codex 与 Claude Code `memory.propose_change` 真实调用，验证 effective
  provisional receipt 与重启不重复；
- `pnpm package:mac`、ad-hoc codesign 严格校验和 `pnpm accept:memory-ui`；打包 App
  同时验证无启动策略弹窗、新库与 v22 升级默认关闭、设置页主动开启、Day/Night
  布局与重启恢复。
