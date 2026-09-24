---
document_type: implementation-plan
version: v1.69
authority: version-implementation-and-acceptance
status: in_progress
last_updated: 2026-09-24
---

# v1.69 实施与验收

## 实施顺序

1. 保留 Command Code 1.64.0 独立 headless NDJSON 传输、完整 UUID 恢复和 ManagedProcess 清理；用隔离本机模型 fixture 验证 revision 3 的首轮 `B + "\n\n" + P`、精确恢复后只新增 `P`，以及首次用户层引导是否仍在原生历史中。
2. 在 Product Adapter 入口复用 Core 的 `CharterDeliveryMode::FirstPayload`、`PreparedContext.runtime_payload`、冻结 Runtime Input Delivery 和接受证据；不得增加独立 mode、marker、每 Run 重投或受管 Bootstrap Mod。
3. 按[接入清单](../../development/runtime-integration-checklist.md)与[Parity Matrix](../../research/command-code-runtime/parity-matrix.md)逐项解决权限、MCP/Skill/Taste 隔离、Tool/Activity、Usage、取消、认证与压缩连续性。不能证明成员与 Session 隔离时保持研究态，不建立 Product Catalog identity。
4. 所有产品轴有可审阅证据后，原子接入 identity、discovery、Probe、dispatch、Migration、设置与诊断，按平台独立执行 Golden Flows。若要求改变 revision 3 的模型输入语义，先递增说明 revision 并重新取得 Principal 二次确认。

## 当前验收状态

| 项目 | 状态 |
| --- | --- |
| revision 3 二次确认与当前版本说明 | 已记录 |
| 现有 FirstPayload 的格式、冻结与预算 owner | 已有实现，Command Code 产品入口尚未接线 |
| 隔离 Command Code 首轮与精确恢复模型请求 | 1.64.0 本机受控 fixture 通过：首轮两次请求为 user 层 `B + P`，按完整 UUID 恢复的一次请求仅新 `P`，历史仍含旧 `B`；同 cwd 第二个隔离 Home 无法恢复此 ID；不代表真实模型、压缩或 Core 冷恢复 |
| 真实认证、成员隔离、MCP/Skill、权限、Usage、压缩、跨平台 | 未通过 |
| Product Runtime Catalog 与正式 AgentRun dispatch | 未实施 |

内部传输既有子进程 fixture 是进程边界的唯一 owner；本版先扩展隔离原生 CLI fixture 的模型请求观察，不新增镜像实现的 Rust 单元测试。需要新增或调整 Rust 测试时遵守[测试准入政策](../../development/testing.md#rust-测试准入与退役门槛)。
