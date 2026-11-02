---
document_type: documentation-index
authority: documentation-routing
last_updated: 2026-10-31
---

# Rovai AI 文档导航

先按任务选入口；精确字段与协议从[合同索引](contracts/README.md)确认当前版本，只读取相关章节。
不默认加载全部架构、合同或历史版本。
文档说明规范，代码、Migration、测试与验收证据说明实现。

## 按任务读取

| 任务 | 入口 |
|---|---|
| 理解产品与领域词汇 | [PRODUCT.md](../PRODUCT.md)；术语与概念边界见 [CONTEXT.md](../CONTEXT.md) |
| 修改架构或业务实现 | 从[架构索引](architecture/README.md)选择相关专题；跨主题约束查[基础不变量](architecture/foundational-invariants.md) |
| 修改 Renderer UI/UX | 先读 [DESIGN.md](../DESIGN.md)和[UI 索引](ui/README.md)，再读目标主题、组件或 surface brief |
| 修改 Thread 创建、成员、消息、单聊或草稿 | 按目标读[创建](architecture/camp-activation-lifecycle.md)、[成员关系](architecture/dynamic-camp-membership.md)、[公共投递](architecture/public-a2a-message-delivery.md)、[单聊](architecture/single-chat.md)或[输入框](architecture/camp-composer-draft.md) |
| 修改 Team、Mission 或 Task | [Team](architecture/team-management.md)、[Mission](architecture/missions.md)或[Task](contracts/durable-task-v6.md) |
| 修改 Thread/User 名称、ID 或兼容边界 | [Thread Naming](contracts/thread-naming-v1.md)、[Thread Identity](architecture/camp-identity.md)及 [User Naming](contracts/user-naming-v1.md) |
| 修改 Runtime 发现、配置、权限、启动或新增接入 | [Runtime 边界](architecture/runtime-catalog-boundaries.md)；新增接入另读[接入 Checklist](development/runtime-integration-checklist.md) |
| 修改执行恢复、停止或退出 | [AgentRun Recovery](architecture/agent-run-recovery.md)或[Planned Shutdown](architecture/planned-shutdown.md) |
| 修改 Rovai 的 Bootstrap、Dynamic Context、模型输入选择、证据或版本 | **先遵守[模型上下文变更治理](development/model-context-change-governance.md)的独立说明与二次确认要求**，再读[Bootstrap](architecture/foundational-invariants.md#context-session-bootstrap)与[ContextManifest](architecture/foundational-invariants.md#context-manifest-run-facts) |
| 修改 Skills、Built-in CLI 或外部 MCP | Skills 读[来源与投递](architecture/skills.md)；CLI/MCP 读[Built-in Tool Runtime](architecture/builtin-tool-runtime.md) |
| 修改 Memory | [在线捕获、治理与 Agent 读写](architecture/online-memory-capture.md) |
| 修改文件、附件或预览 | [附件与原路径引用](architecture/camp-published-attachment-view.md)或[文件预览](architecture/file-preview.md) |
| 修改渠道 | 按 Provider 选择[飞书](architecture/feishu-channel.md)、[Lark](architecture/lark-channel.md)或[钉钉](architecture/dingtalk-channel.md) |
| 修改启动、数据库、Host 或 Server | [启动与数据库准入](architecture/availability-first-runtime.md)或[统一 Rust Host](architecture/unified-rust-host.md) |
| 修改 Windows 平台行为 | [Windows 架构](architecture/windows-desktop-platform.md)与[交互差异](ui/windows-interaction-delta.md) |
| 修改定时任务或用户自动化 CLI | [Automation](architecture/scheduled-automation.md)或[User Automation](architecture/user-automation.md) |
| 修改 Runtime 活动、用量或通知 | [活动映射](runtime-activity/README.md)、[运行监控](architecture/runtime-monitoring.md)或[通知](architecture/notification-episodes.md) |
| 修改评测、Benchmark 或真实模型验收 | [评测流程](development/evaluation.md)；Benchmark 专题另读[协议架构](architecture/benchmark-protocol.md) |
| 修改仓库 Skill 的结构与触发描述 | [Skill 编写规范](development/skill-authoring.md)；涉及模型投递时同时遵守模型上下文变更治理 |
| 判断当前版本目标、范围、进度或切换版本 | [版本索引](versions/README.md)中的唯一 `current` 条目；切换时执行该索引的检查清单 |
| 修改文档、记录决定或查设计理由 | [文档与决定治理](decisions/README.md)；理由从[当前决定导航](decisions/CURRENT.md)进入 |
| 本地运行、测试、构建或管理 worktree | [开发者指南](development/README.md)；启动 App/Core/Runtime 前读[隔离流程](development/local-workflow.md)，worktree 操作读[生命周期规则](development/worktrees.md) |

使用产品见[用户指南](guides/README.md)，系统概览见[架构图解](architecture/system-views.md)，界面展示见[产品展示](product-showcase.md)。

## 文档归属

| 内容 | 权威位置 |
|---|---|
| 共享领域词汇与概念区别 | `CONTEXT.md`；只放简短定义，不放字段表、算法、配额或演进记录 |
| 当前系统结构、组件职责与跨主题不变量 | `docs/architecture/` |
| 当前字段、wire shape、授权、错误、幂等与可测试边界 | 对应的当前 `docs/contracts/` 文档 |
| 产品定位与品牌 | `PRODUCT.md` |
| 视觉、交互、主题、组件与页面构图 | `DESIGN.md` 与 `docs/ui/`，按 UI 索引分工 |
| 本地环境、隔离、测试与发布流程 | `docs/development/` |
| 版本目标、交付范围、进度与验收 | `docs/versions/` 中的当前版本 |
| 决定理由与取舍 | 对应版本的 `decisions.md`；路由和治理归 `docs/decisions/` |
| Runtime 活动映射目录与变更门禁 | `docs/runtime-activity/` |
| 调研、兼容性与复盘证据 | `docs/research/`、`runtime-compatibility.md`、`docs/postmortems/`；不替代当前规范或实现状态 |

规则只在拥有它的位置维护；索引和术语表引用它，不复制完整规格。
历史版本是冻结记录，不约束当前实现；决定理由不能覆盖当前 Architecture 或 Contract。

## 权威性与冲突处理

- 先区分问题：术语、当前设计、精确协议、版本范围、实现事实或历史理由；按上表选择来源。
- 当前版本以[版本索引](versions/README.md)为准，不从旧版本的 `accepted` 推断现行范围或完成状态。
- 发现文档与实现不一致时，指出双方位置、缺失证据与本次修复范围；不得静默选一方覆盖另一方。
- Architecture 与 Contract 不得静默互相推翻；修改长期语义时同步实际拥有它的当前文档。

## 文档维护

- 写当前可执行内容，删除重复规则、过期要求、评审过程和已完成迁移的流水账；保留必要的兼容与恢复边界。
- 新决定使用当前版本内 ID，不新增数字 ADR。历史正文的更正、链接与元数据修复遵守[决定治理](decisions/README.md)。
- 更新受影响的引用与 fragment。新增或修改 Architecture、Contract、Version Decision、版本文档或路由时，运行[通用文档门禁](decisions/README.md#自动治理)；不得添加功能、版本或 Skill 专属例外。
- 引用实施状态时提供代码、Migration、测试或可复现验收证据。

## 本地原型

`docs/prototypes/` 由 Git 忽略，仅供本机交互稿、截图和评审素材使用，不得强制提交；构建、测试与当前文档不能依赖它存在。
确认后的交互规则归当前 UI 合同或 surface brief，验收结果归版本记录。历史原型链接固定到当时提交，仅供追溯。
