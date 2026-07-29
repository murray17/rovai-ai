---
document_type: version-overview
version: v0.22
lifecycle: current
authority: version-scope-and-status
last_updated: 2026-07-29
---

# Rovai-ai v0.22 配置式 Camp 创建与延迟 Conversation

> 状态：实现完成，验收通过
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](../v0.21/README.md)
>
> 跨版本决策：
> [ADR-0071](../../adr/0071-configured-camp-creation-and-lazy-conversations.md) ·
> [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md) ·
> [ADR-0066](../../adr/0066-managed-product-runtime-resolution.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.22 把“新对话”从首条消息前的轻量 Renderer 草稿改为明确的配置式 Camp 创建。
用户先选择 Project Binding、初始成员、Default Lead、协作模式和可选名称，点击
「创建」后 Core 立即原子持久化 Camp 与 CampMembers。创建成功后直接进入这个可为空的
Camp，再由正常 Composer 提交首条执行请求。

Camp 创建不再依赖 Runtime Resolution 或 Readiness，也不再为全部成员预建空
Conversation。Conversation 只在某次执行的精确目标全部通过准入后，和该次 CampMessage、
CampTurn、AgentRuns 一起按需创建。这样协作结构、执行可用性和 Agent 私有连续性拥有各自
清晰的持久化边界。

## 已确认交付范围

### 新对话配置

- 全局「新对话」打开配置 Dialog，默认不关联项目；
- Project 侧栏 `＋` 先打开系统目录选择器，再以已验证 Git worktree 预选状态打开同一
  Dialog；
- Project 选择提供「不关联项目」、已知 Project 路径快捷项和「选择本地 Git 项目…」；
- 初始成员默认选择全部 `present` AgentProfiles，但必须至少保留一名；
- Default Lead 必须属于所选成员；初值为稳定 Member Order 中第一位 Runtime Ready
  成员，若无人 Ready 则为第一位所选成员；
- 当前只开放左侧「并肩协作」；右侧「领队统筹」可见、禁用并标记「暂未开放」；
- 名称位于折叠的「可选配置」中；留空创建为「未命名对话」；
- 创建失败保留完整 Draft；创建成功关闭 Dialog、选择新 Camp、进入工作区并聚焦
  Composer。

### Camp 与首条消息

- 「创建」是用户专属、幂等、原子的领域动作；
- 创建只持久化 Camp 与所选 CampMembers，包括名称及内部来源、Repository Binding、
  collaboration mode 和 Default Lead；
- 创建不进行 Runtime Resolution/Readiness 准入，也不创建 Conversation、CampMessage、
  CampTurn、AgentRun、Native Session 或 Bootstrap；
- `peer` 模式下未显式寻址的用户请求只发送给 Default Lead，不广播；
- 首条执行请求和后续请求使用同一执行准入；多目标必须全部通过；
- 最终准入成功时，只为精确目标创建缺失 Conversation，并原子创建消息、Turn 与 Runs；
- 仍为默认名称的 Camp 在首条已接受用户请求事务中同步、确定性生成名称；
- 成员后续加入或恢复不预建 Conversation；既有 Conversation 连续性不丢失。

### 数据边界

- Camp 名称规范化为去除首尾空白并折叠内部空白，最多 80 个 Unicode scalar values；
- 名称来源为内部 `default | generated | user`，不对用户展示；
- collaboration mode 持久化为闭集 `peer | lead_coordinated`，但 v0.22 Core 只接受
  `peer`；
- 未发布数据直接切换 schema；不回填、不双读、不保留旧首条消息创建流程；
- 空 Camp 是合法耐久状态，只有明确永久删除才消失。

## 明确不在范围

- 不实现 `lead_coordinated` 路由；
- 不增加创建后的成员编辑器或 collaboration mode 切换 UI；
- 不增加 Project 迁移 UI，也不在创建界面承诺创建后可移动；
- 不创建 Project 聚合或 Project 表；
- 不让 Agent、Runtime、LLM 或异步 Job 生成 Camp 名称；
- 不为未发布的旧协作数据提供兼容层。

## 架构状态

[ADR-0071](../../adr/0071-configured-camp-creation-and-lazy-conversations.md) 已接受，并局部
替代 ADR-0058 的首条消息建 Camp、全成员预建 Conversation、成员加入时预建
Conversation 和“不持久化空 Camp”条款。ADR-0058 的 Presence、Default Lead、精确寻址、
全目标执行准入、Task 与永久删除语义继续有效。

正式领域词已经同步到仓库根目录 [CONTEXT.md](../../../CONTEXT.md)。参考设计包、原型和
截图仅用于核对意图；与有效 ADR、当前版本文档、UI 规范和代码事实冲突时，不构成实现
权威。

## 完成定义

v0.22 只有在以下事实同时成立时完成：

- Schema、Core command、Read Side 与 Renderer 对可为空 Camp 和可缺失 Conversation
  使用同一不变量；
- 配置创建对成员、Lead、mode 和 Repository Binding 进行原子结构准入，且不接触
  Runtime；
- 首条和后续执行只为全部已准入的精确目标延迟创建 Conversation，不产生部分业务状态；
- 名称规范化、来源状态机和同步自动命名均由 Core 决定并经过边界测试；
- Dialog 在 Day/Night、`1440×920` 与 `1040×700` 下通过键盘、焦点、错误保留与
  无溢出验收；
- 旧 `camps.createFromFirstMessage` 产品路径和 eager Conversation 分配不再存在；
- 完整 Rust/Renderer 测试、typecheck、clippy、desktop build 与针对新流程的可复现
  UI/IPC 验收全部通过。

当前完成进度只以 [implementation-plan.md](implementation-plan.md) 中有证据的勾选项为
准；ADR `accepted` 不表示实现已经完成。
