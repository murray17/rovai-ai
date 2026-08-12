---
document_type: adr
id: ADR-0167
title: Seven-Skill Official Inventory
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes:
  - ADR-0159
superseded_by: null
---

# ADR-0167: Seven-Skill Official Inventory

## Context

ADR-0159 把 Rovai official Skill inventory 冻结为恰好六项，并拥有 pinned `tasteful-ui` 的上游来源、
许可、完整打包和不可变 Revision 边界。v0.65 的渐进式 CLI 教学需要新增 `cli-operations`；只修改 Core
fixture 或 UI 数量会让正式 inventory 仍停在六项，也可能在新增 Skill 时意外弱化第三方来源和既有五项
Rovai-owned Skill 的决定。

`cli-operations` 应通过现有统一 Skill Library 与 Runtime-native discovery 按普通 official Skill 交付。
为它增加 required/locked 状态、专属设置组或第二套投递协议，会绕过用户已有的 enabled 与 Runtime Group
Assignment 权威。

## Decision

1. Rovai 当前发布恰好七个 official Skills：`analyze-agent-codebase`、`cli-operations`、
   `memory-stewardship`、`worktree`、`grill-duo`、`grill-duo-with-docs` 与 `tasteful-ui`。
2. Unprefixed name + `origin=official` + immutable bundled Revision 仍是 official identity；同名 Imported
   Skill 拒绝。`cli-operations` 的教学内容与窄触发由 ADR-0166 拥有。
3. `cli-operations` 是普通 official bundled Skill：首次安装默认 enabled、默认全部九个 Runtime Groups，
   用户后续可以禁用或调整 Assignment。它不获得 required/locked 状态、专属 UI group、特殊来源标签、
   第二套投递协议或额外 Capability。
4. `tasteful-ui` 继续完整使用 ADR-0159 固定的上游仓库
   `https://github.com/DonkeyKing01/tasteful-ui-skill`、Revision
   `159ccd47a320f3a7bd0289d07366d422211895a1`、MIT license、source notice、84-file bundled snapshot、
   build-time symlink/unsupported-node rejection、immutable Revision 与无启动/构建网络拉取。其 router、
   investment gates、catalog、implementation/verification workflow 全部保留，且不授予额外权限。
5. `analyze-agent-codebase` 的 evidence-first/read-only default、`worktree` 的 Task-scoped isolation、两项
   duo Skill 的 self-contained references/A2A workflow、`memory-stewardship` 的既有治理边界，以及所有
   Skill 不授予 filesystem/Git/tool/approval/implementation authority 的决定全部保留。
6. 未来增加或删除 official Skill 必须以新 ADR 完整替代本精确 inventory，并同步 Core manifest、
   terminology、UI copy、source labels、smoke 与 acceptance fixtures。刷新 `tasteful-ui` 仍需精确上游
   Revision、完整 re-vendor、许可/notice 和全 manifest 验证。

本决策完整替代 ADR-0159，并无损继承其 pinned `tasteful-ui` 与此前 ADR-0150 的五项 official Skill
决定；ADR-0158 继续拥有所有 managed Skill 默认全 Runtime Group 与用户后续修改保持的一般策略。

## Consequences

- Core、Renderer、文档和验收 fixture 共享一个精确七项 inventory；
- 新 CLI Skill 复用现有来源、启停、Assignment、Revision 和 exposure evidence，不产生产品特例；
- `tasteful-ui` 的可复现来源、许可、文件 manifest 与离线安装保持不变；
- Skill Exposure 只证明 Runtime-native discovery 可见，不证明模型读取，也不授予命令或执行权限；
- 以后修改 inventory 必须显式接替本 ADR，不能在实现或 UI 中静默增减。

## Rejected Alternatives

- **只把 `cli-operations` 加入 Core fixture。** 会让长期 inventory、UI 与实现事实分叉。
- **把 CLI 指导直接并入 `memory-stewardship`。** 会混淆 Memory 治理与跨领域 operation 选择。
- **为 CLI Skill 创建锁定组或 prompt injection。** 会绕过统一 Skill governance、否定用户 Assignment，
  并把可发现内容误称为已被模型读取。
- **借本次新增刷新 `tasteful-ui` 上游。** 未经独立 review 的来源变化会破坏已固定的 provenance、许可
  与文件清单，不属于新增 inventory item 的必要效果。
- **使用浮动 official 集合。** 代码、设置、离线包与验收将无法证明同一发布内容。

## References

- [v0.65 版本目标](../versions/v0.65/README.md)
- [v0.65 实现规格](../versions/v0.65/implementation-spec.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0159: Pinned Third-Party Tasteful UI Bundled Skill (historical)](0159-pinned-third-party-tasteful-ui-bundled-skill.md)
- [ADR-0166: Progressive Built-In CLI Teaching](0166-progressive-built-in-cli-teaching.md)
- [Skill settings UI strategy](../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../CONTEXT.md)
