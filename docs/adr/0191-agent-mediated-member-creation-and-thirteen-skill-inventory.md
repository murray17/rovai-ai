---
document_type: adr
id: ADR-0191
title: Agent-Mediated Member Creation and Thirteen-Skill Official Inventory
status: accepted
date: 2026-08-15
decision_scope: cross-version
source_version: v0.85
supersedes:
  - ADR-0181
intended_supersedes: []
superseded_by: null
---

# ADR-0191: Agent-Mediated Member Creation and Thirteen-Skill Official Inventory

## Context

Rovai 已有六字段 AgentProfile、受管本地头像、Agent-only Built-in CLI 和离线 official Skill Library，
但创建新队员仍只能从 Renderer 表单发起。用户希望从一个名字开始，让 Agent 帮助起草长期身份、准备头像、
展示完整名牌，并在用户确认后直接把队员加入名册。

这个工作流不需要新的头像工作流引擎、跨进程私有 bridge 或产品分配的临时 token。Agent 已经可能拥有生图、
联网找图和文件工具，也可能完全没有这些能力；Skill 应说明选择顺序和图片约束，文件暂存位置则由当前 Agent
根据 Runtime 环境决定。产品只需要一个窄、可证明、可幂等的创建边界。

现有 ADR-0181 同时冻结 exactly twelve official Skills，未来 inventory 变化必须有 successor ADR。
ADR-0056 又把 Renderer 上传的 managed avatar 写入职责放在 Electron Main。Agent CLI 创建需要在保持同一
manifest/reference 合同的前提下，为 Core 增加第二条受限写路径，而不是把任意文件写入能力暴露给 Agent。

## Decision

1. Rovai official Skill inventory 扩展为十三项：`analyze-agent-codebase`、`campfire`、
   `cli-operations`、`diagnosing-bugs`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、
   `memory-stewardship`、`review-duo`、`tasteful-ui`、`tdd`、`worktree`、`writing-for-agents`。
   `cli-operations` 与 `memory-stewardship` 保持 `system_required`；其余十一项为 `user_managed`。
2. `member-studio` 是 Rovai original bundled Skill，无外部 upstream。它负责从用户输入起草六字段身份、说明
   头像方案、展示完整“队员名牌”，并只在当前用户明确确认后调用 `rovai member create`。初始创建请求不替代
   最终名牌确认；A2A 或其他队员不能代替用户确认。
3. Skill 只描述可执行策略，不授予生图、网络、文件或 Runtime 权限。可用时优先生成原创 4:5 竖版头像，
   以头肩/半身、主体居中略靠上和中央方形安全区为默认构图；无生图能力时使用已获准的联网/图片搜索能力
   找来源清楚的图片；两者都不可用时省略头像，让产品使用默认回退。
4. 不要求人脸检测、精确分割或产品管理跨 Run 图片暂存。Agent 在当前 Run 选择 Core 可读的本地文件路径，
   有 `ROVAI_RUN_TMP` 时可以优先使用；调用完成前保证路径有效。产品按短边方形、横向居中和竖图顶部约 5%
   的轻量策略粗裁。预览跨 Run 时可以重新生成或下载最终文件，不能假设普通临时路径仍有效。
5. Built-in Transport 升至 v12，新增第十四项 `member.create -> rovai member create`。Core 只接受 attested
   active、`direct`、由当前 User CampMessage 触发的 AgentRun。Skill 的自然语言确认规则是调用政策；Core
   attestation 是最低授权门，不尝试把名牌正文或确认句持久化成新的协议对象。
6. `creationKey` 是 canonical lowercase UUID，并成为领域 command 与可选 managed avatar asset 的稳定身份。
   同 key、同最终输入重放；同 key 绑定不同身份或头像停止。Command 以当前 User 为 actor，不把 run ID、
   CLI request ID 或临时路径纳入跨 Run 幂等 identity。
7. Core 对可选 `avatarFile` 执行有界普通文件读取、PNG/JPEG 字节识别、decode limit、方向应用、元数据剥离、
   最长边 2048 标准化、默认方形粗裁和 192×192 PNG 生成，再使用 ADR-0056 的 manifest v1 与
   `rovai://member-avatar/managed/<uuid>` 引用原子发布。路径和原始字节不进入数据库或 Execution Evidence。
8. ADR-0056 的 Renderer 上传路径仍由 Electron Main 独占；本 ADR 只增加 attested `member.create` 的 Core
   写路径。Main 与 Core 必须写出同一 managed asset contract。它不是通用文件 importer，也不开放
   Main↔Core 私有头像 bridge。
9. 启动时，如果 newly claimed official name 已存在为 imported Skill，Core 保留 Skill ID、enablement 与
   group assignments，把 origin 原子提升为 official，再发布 bundled Revision 并留下事件；不因历史本地安装
   阻断启动。official inventory 建立后，用户 import 仍不能覆盖同名 official Skill。
10. 未来 official inventory、management policy、`member.create` authority 或 managed-avatar writer 变化仍需
    successor ADR、版本化合同及 bundled/Core/Renderer/docs/smoke 的协调更新。

本决定完整替代 ADR-0181；其中 Review Duo、Runtime-aligned collaboration、pinned third-party provenance 和
两项 system-required policy 均原样继承。它局部扩展 ADR-0056 的 writer ownership，不替代其 compound asset、
reference、integrity、orphan 或 Renderer read contract。

## Consequences

- Core 和 Runtime discovery 精确包含十三项 official Skills；Settings 自动显示十一项可配置项，无需新的
  Renderer 专用分支。
- 用户可以在 Agent 会话中完成“名字 → 身份 → 头像方案 → 确认 → 入队”，但创建成功不自动配置 Runtime、
  权限、Presence、Camp membership、Default Lead 或 Memory。
- 图片能力差异在 Skill 层诚实降级；产品不需要检测模型类型，也不需要替 Agent 选择临时目录。
- Core 新增图像解码依赖和受控头像资产写入职责，但该职责只位于 direct user-triggered、attested、closed
  operation 内；本地路径不成为领域真源。
- 头像 asset-first 发布可能在后续名称冲突时留下受管 orphan；这比把未提交路径或远程 URL 持久化更安全，
  并沿用 ADR-0056 的清理边界。
- 旧 imported `member-studio` 不会让新版本冷启动失败；其旧 Revision 保留为历史，当前 Revision 切换为
  official bundled 内容。

## Rejected Alternatives

- **让 Electron Main 通过新私有 bridge 接收 Agent 头像。** 不需要；CLI 已经进入 Core，增加 bridge 会复制
  授权、幂等和失败恢复边界。
- **由产品分配头像 temp token 或固定暂存地址。** 不需要；Agent 只需在当前 Run 提供一个可读路径，Core
  立即导入且不持久化路径。
- **要求精确人脸检测和智能裁切。** 对首版头像识别价值过低；4:5 构图指导加轻量方形粗裁足够，并允许用户
  后续从既有 Renderer 入口调整头像。
- **没有生图能力就创建本地图形头像。** 产品已有默认头像回退；无必要新增一套视觉生成器。已获准时网上找图
  更符合用户要求，网络也不可用时诚实省略即可。
- **仅凭任意 AgentRun 调用创建。** 创建队员是用户治理动作；A2A 或系统 Run 不应把 Skill 文本当授权。
- **把完整名牌或确认文本写进 idempotency key。** 自然语言表述会漂移且泄漏不必要内容；稳定 UUID 加
  canonical command digest 已足够。
- **同名 imported Skill 阻断启动或被删除重建。** 前者会惩罚早期试用者，后者丢失 ID、配置和审计链；
  原地晋升加新 Revision 保留了两者。

## References

- [v0.85 current version](../versions/v0.85/README.md)
- [Built-in Tool Transport v12](../contracts/builtin-tool-transport-v12.md)
- [ADR-0056: Controlled Member Avatar Assets](0056-controlled-member-avatar-assets.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0181: Twelve-Skill Official Inventory (historical)](0181-twelve-skill-official-inventory-and-runtime-aligned-collaboration.md)
- [`member-studio` bundled source](../../skills/member-studio/SKILL.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
