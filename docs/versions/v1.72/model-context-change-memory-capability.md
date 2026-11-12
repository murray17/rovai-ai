---
document_type: model-context-change
version: v1.72
change_id: memory-capability
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: User
confirmed_at: 2026-11-11
confirmation_message_id: 04816bb6-4968-4df3-86bc-ee820c84644e
authority: proposed-model-input-change-statement
implementation_status: implemented
review_baseline: d7b69cb64b33fbc12f8e8cdb10e9876dae8a0633
last_updated: 2026-11-11
---

# Rovai 长期记忆实例开关

本说明记录 User 已审阅的收敛范围和文案。只增加一个默认开启的 Core 实例设置，控制 Rovai Memory
的业务操作、新生成输入和发现投递，以及 Desktop/Web/Mobile 的管理界面。同一开关覆盖 Hearth、
Companion、Relationship。关闭保留正式记录、修订、审核候选和已经发生的提交结果；人工管理也暂停。
不增加每 Thread、每队员、每 Scope 覆盖，不改 Runtime 原生记忆策略，不引入通用 Feature Flag 框架。

## 变更前

### 新生成 Bootstrap

公共 Thread 的 `BootstrapContents::read` 总是调用现有 `build_memory_entrypoint`，按当前权限选择
Memory ID、Kind、Retrieval Keys，生成以下已有形状。示例 ID/关键词只代替实际记录：

```text
[MEMORY_ENTRYPOINT]
### Hearth

| Memory ID | Kind | Retrieval Keys |
|---|---|---|
| memory_example | Agreement | review process |

Discovery index only. Use `rovai memory read` for current content and access state before relying on an entry.
[/MEMORY_ENTRYPOINT]
```

有记录的其他 Scope 沿用现有 Companion/Relationship 表格；无记录时沿用现有空库检索教学。
精确生成算法和文本以基线 `context.rs::build_memory_entrypoint` 为准，本次不修改开启分支的任何字节。
Single Chat 已省略 Memory Entrypoint，保持该选择。

平台索引形状为：

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"<existing description>"},{"name":"memory-stewardship","desc":"<existing description>"}]}
[/ROVAI_PLATFORM_SKILLS]
```

两个既有 description 的字节保持基线文件 frontmatter 原文；索引顺序、根路径和字段没有其他变化。

### 工具与结果

`rovai --help` 的 Agent operations 含以下一行，精确操作 help/目录包含四项 Memory 操作：

```text
  rovai memory view|search|read|write
```

`memory.view/search/read/write` 按现有权限执行；运输层同请求的缓存 Envelope 可先于领域服务返回。
User Host 的 `memory.list/get/create/revise/retire/reactivate/forget/supersede/review.schedule`、
`memory.hearthReviewItems.list/accept/reject` 和 `memory.export` 按原有规则执行。

## 变更后

### 开启

上述 Bootstrap、技能索引、四项 Memory 工具和管理界面正常提供；现有读取授权、Scope、Presence、
Revision、配额、审核与生命周期规则继续生效。读请求回放通过现有实时读取服务重新判断当前状态，
不交付陈旧缓存正文。已提交写入仍返回原有、不含记忆正文的回执，不重复产生业务效果。

### 关闭

仅在原本需要生成新 Bootstrap/新输入时：

- 不查询 Memory 索引，整个 `[MEMORY_ENTRYPOINT]` section 缺席；不生成空库检索教学。
- `observed_memory_revisions=[]`；授权摘要按现有 `{"schemaVersion":1,"memoryAccess":"none"}`
  计算。实际投递、预算和证据都反映省略后的内容。
- 平台 section 保留原有 shape，仅删除 `memory-stewardship` 条目：

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"<existing description>"}]}
[/ROVAI_PLATFORM_SKILLS]
```

- CLI 目录、操作说明和 help 隐藏 Memory 发现入口。技能源文件保留，`cli-operations` 及其他技能正文不改。
- 本地投影只控制发现；实际命令仍送 Core，由实时状态裁决，保留已有提交结果的返回能力。

新的 Agent Memory 操作在既有 Core 串行/事务边界停止，错误字段精确为：

```json
{"code":"memory.feature_disabled","message":"Rovai long-term memory is disabled.","recovery":"stop"}
```

这些字段位于现有错误 Envelope/Agent projection 的既有位置；其他字段和版本保持。
读缓存同样不能绕过开关；读取开关与选择可交付的读取结果在同一 Core 串行边界内完成。
关闭前已在该边界确认的结果可能晚到，不以客户端点击或网络到达时间重新定义 Core 顺序。
写入与 User 管理变更在现有幂等回放之后、实际业务 handler 事务内检查。已有身份校验和回放规则保持，
已保存事实不改判失败；新写入不发布正式记忆，也不创建审核候选。
User 管理读取、导出和全部新变更暂停，控制接口和结果确认可用。

### 用户界面

通用设置 → 会话，位于会话任务旁：

| 位置 | 完整文案 |
| --- | --- |
| 标题 | Rovai 长期记忆 |
| 帮助 | 允许队员读取并形成 Rovai 的长期记忆。关闭后暂停记忆访问与管理，已保存数据保留。 |
| 帮助中的上下文边界 | 已进入当前对话上下文的内容仍可能保留。 |
| 停用页 | Rovai 长期记忆已关闭。重新开启后可继续使用和管理已保存的记忆。 |
| 停用页按钮 | 前往设置 |
| 初始读取 | 正在读取记忆设置… |
| 读取失败 | Rovai 长期记忆状态暂不可用，请重试。 |
| 保存中/失败/重试 | 正在保存… / 未能保存，请重试。 / 重试 |

Memory 导航保留；停用页不加载/展示业务内容、计数、审核或复核提示。开启时原有沿用/复核文案保持，
取消上一版关闭态计数改名。App 启动和页面外预加载同样受开关控制，迟到业务响应不恢复界面或提示。

## 明确不变

- 不处理旧会话上下文版本，不增加 Memory epoch、Binding compatibility 或 Session 迁移。
- 不使已有 Bootstrap 过期，不触发补发、轮换或关闭提示，不修改任何已冻结/已投递正文。
- Charter、Member Identity、Team Guidance、Dynamic Context shape、历史选择和其他工具保持。
- Bootstrap/formatter/profile/manifest/Binding 版本轴不变；本次新增数据库结构只保存能力设置和通知水位。
- 已有 Session/Run/队列照常运行；关闭错误仅随实际 Memory 调用返回，`stop` 只停止本次记忆操作。
- Task 开关独立。Runtime context 由统一入口读取两个当前值后生成；Hermes 复用 Core IPC 连接，
  仅增加只读发现能力，不新增会话同步。所有发现投影都不建立实际授权。
- Claude/Codex/Hermes/ZCode 等原生记忆策略保持现有实现，本功能只控制 Rovai Memory。

## 数据、兼容与通知

新库和升级都显式插入 `memory_preference.enabled=true`。后续启动和升级不覆盖保存的 false；
非法/缺失设置返回不可用，不当作确认关闭。保存提交后发布 `preferences.memory_changed`，再刷新派生发现；
失败重试和同值保存只修复投影，不回滚设置。
`preferences.memory.get/set` 仅由 User Host 提供，Agent 不能修改设置。
快照的 Core change sequence 仅排序设置；Memory 事件 global sequence 只用于提示水位。
关闭→开启在设置事务固定提示边界，读取和同值保存不后移。断线/重订阅以已有事件水位建立新的提示起点，
不回放旧提示，不扩展通知系统。已确认关闭、状态未知和迟到响应均不产生新记忆行为提示。
冻结输入和旧 Bootstrap 字节保持，迁移不删除或重建任何 Memory/Session 内容。

## 二次确认

User 在消息 `5666ee22-7c9b-41d5-9002-9485255c539b` 给出收敛边界，随后要求解释 Hermes 和完整文案清单。
清单已由消息 `5c868cdd-59fd-4a6a-aeed-a106ab17f116` 交付。User 之后通过
`04816bb6-4968-4df3-86bc-ee820c84644e` 明确要求“那你开启wt执行”，作为本 revision 的实施确认。
本文件把已审阅的范围和文案归档，不将实现者新增语义视为已确认；语义变化须升级 revision 并另行确认。

## 验证

复用现有 Memory、Bootstrap、Built-in lease/CLI、数据库准入、Web HTTP/SSE 与 Renderer owners。
覆盖默认/升级/重启/事务失败回滚、三 Scope 读写及审核候选、用户读取/导出/全部管理暂停、同请求写回执、
关闭读回放与重开实时授权、新 Bootstrap 省略及冻结输入不变、Task/Memory 四组合、Hermes、投影失败修复、
Host 切换/乱序响应/状态未知/迟到响应、关闭重开和离线重连无旧提示。
执行定向 Rust/TS/Node、默认 workspace、文档/Skills gates、Desktop/Web 构建和隔离 UI 验收。
真实模型 Gate 按既有通用 12 Case 流程冻结基线、候选、通过标准与预算并保留实际结果；
未执行或基础设施受阻时明确记录证据缺口，不用受控 fixture 代替真实模型 Gate。

实施与验证结果在完成后追加，不改写本 revision 的已确认模型输入规则。

## 实施与验证结果（2026-11-11）

已按 R1 完成 Core 设置、业务阻断、读回放、条件输入与发现、共享 Provider、停用页和必要同步。
Migration 224 / projection schema 174 是本次唯一数据库版本变化；Builtin transport 45、IPC 3、
事件 schema 9 及 Bootstrap/Binding/formatter/profile/manifest 版本保持。统一发现刷新同时写入 Task、
Memory 当前值。Hermes 的已有逻辑 Session 路由只承载只读能力发现，没有新增会话治理。

验证均在独立 worktree 与隔离夹具完成，没有启动日常 App、生产数据目录或真实模型：

| 验证 | 结果 |
| --- | --- |
| `cargo check --workspace`、`cargo test --workspace` | 通过；默认 Rust workspace 484 passed、1 existing ignored |
| `cargo test -p rovai-core --features slow-tests --lib memory` | 29 passed；包含三 Scope、管理停用、既有回执与提示水位 |
| 既有 Core discovery / Bootstrap / schema / catalog migration / Memory restart owners | 通过；覆盖读缓存拒绝、重开后的实时生命周期、Hermes、两开关独立、冻结输入不变、迁移回滚及重启保留 false |
| `pnpm test` | 通过；Vitest 276 files / 3275 passed、2 skipped；默认 Node 377 passed、2 skipped；文档、Skills 和沙箱门禁通过 |
| `pnpm typecheck`、`pnpm build:desktop` | 通过；构建包含 Web 和 Desktop |
| `pnpm test:send-input-file` | 通过；关闭时 help 隐藏但实际命令仍送 Core，保留 stop 错误与回执路径 |
| `pnpm test:settings-workspace` | 通过；隔离 Electron 设置页的相邻开关、说明、保存失败与重试 |
| `pnpm test:memory-workspace-ui` | 通过；10 组交互、18 组视口/主题，包含停用零业务查询、未知/重试、迟到快照/业务响应/已提交回执，以及草稿保留且不自动提交 |
| `pnpm docs:test`、`pnpm docs:check`、diff-aware documentation gate、`git diff --check` | 通过 |

全量验证后新增的小范围回执/草稿保护、通知序号断言和集中操作识别由相应 UI、TS 与 Core owner 复测；
不把复测数量重复计入全量结果。UI 证据位于本 Thread 附件 `memory-capability-ui/`。

真实模型通用 Gate 为 **not_run / 证据不足**。本次未取得固定 snapshot Judge 和完整冻结的
baseline/candidate campaign；检查到的既有计划为 `judge=null`。没有将受控 Core/IPC/Hermes 路由或 UI
夹具当作真实 Runtime/模型资格，也没有宣称通用 12 Case Gate 通过。本分支只交付实现及自动化验收，
不创建 PR、不合并或发布；正式模型 Gate 仍按既有通用流程完成，不继承其他任务的豁免。
