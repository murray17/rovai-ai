---
document_type: implementation-plan
version: v0.52
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-09
---

# v0.52 实施与验收计划

## Checkpoint 0：版本与合同

- [x] v0.51 冻结为 historical，v0.52 成为唯一 current；
- [x] ADR-0149 与 ContextManifest Evidence v9 冻结 bounded aggregate / exact bounded omission 分界；
- [x] ContextManifest 升到 v9，Profile v2 与 Context Formatter v11 保持；
- [x] Data Contract v0.52/schema 28/Migration 69 与 CampSnapshot schema 27 的独立版本轴明确。

## Checkpoint 1：精确模型字节与恢复

- [x] Public A2A Current Input 从 CampMessage/MessageDelivery/source Run 权威关系投影
  `member_call` sender，普通用户仍精确为 `type:user`；
- [x] preflight、重复 frozen Delivery 与最终 materialization 均 fail closed 校验作者和 lineage，
  Frozen payload 与 Manifest payload 复用同一 source bytes；
- [x] Run Notice 建立单一 rendered result，Frozen Delivery、模型 section、Manifest 共用 exact bytes/digest；
- [x] 增加带 Task 的 A2A preflight → materialize → Manifest 端到端回归；
- [x] structured history 使用持久 `camp_message.body`，与 canonical `camp.read item` continuation 同一文本空间；
- [x] 增加 Mention 发送后改名、长正文截断与前缀+continuation 精确重组回归。

## Checkpoint 2：有界 omission Evidence

- [x] `max_public_messages` 改为 count/sequence envelope aggregate，不保存 `messageIds`；
- [x] history/runtime budget 与 reference closure 的有界 omission 继续保存 exact IDs；
- [x] Core 用 SQLite aggregate 排除 trigger、included 和 already-explained bounded IDs，不构造完整历史 ID Vec；
- [x] 千级消息压力回归证明 Frozen/Manifest omission JSON 不随全部 ID 线性增长。

## Checkpoint 3：current-only cutover 与 Read Model

- [x] Migration 69 只接受 v0.50/schema 27/Migrations 66–68 source，清除旧技术 context/delivery state；
- [x] 保留完成业务历史，终止非终态 Run/Turn 与未完成 Delivery，重置 Binding/Session 水位；
- [x] Rust/TypeScript/Renderer CampSnapshot schemaVersion 统一升到 27；
- [x] 完成定向、workspace、TypeScript、docs 与 diff 验证。

## 完成条件

- [x] Rust workspace format/check/clippy/test 全部通过；
- [x] TypeScript typecheck 与 Renderer/Node tests 全部通过；
- [x] `pnpm docs:check` 与 `git diff --check` 通过；
- [x] 概览和本计划根据真实验证结果更新为 complete。

## 实际验证结果（2026-08-09）

- `cargo fmt --all -- --check`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- Rust Core Library 306 项全部通过；bundled CLI 9 项全部通过；Core Main 54 项通过、3 项真实
  Runtime smoke 按合同 ignored。bundled CLI 的 2 项 Unix socket 测试在受限沙箱中被系统拒绝，
  在同机允许临时 socket 的隔离权限下复跑通过；
- `pnpm typecheck`、39 个 Vitest 文件/239 项测试、Node Qualification 78 项测试全部通过；
- `pnpm docs:check`、以 `origin/main` 为真实 base 的 `pnpm docs:check:ci` 与 `git diff --check` 通过。
