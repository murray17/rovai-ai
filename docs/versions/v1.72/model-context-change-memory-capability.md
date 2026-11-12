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

完整提示词、工具定义/help、错误回包与回放差异可直接按文末的
[逐项审阅清单](#完整提示词与工具对照)阅读；编号与 Task 方案一致，并单列关闭后仍保留的通用文字。

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

## 完整提示词与工具对照

本清单沿用 [Task 方案](model-context-change-task-capability.md) 的 B/D/S/C 编号和
“变更前、开启后、关闭后”审阅方式，补齐已实施 R1 的逐项设计。基线固定为
`d7b69cb64b33fbc12f8e8cdb10e9876dae8a0633`，实现快照固定为
`c0827c4810a4470edbc4f59c03a99a104310af55`；本次追加只整理事实，不改变 R1 语义或确认状态。

代码块中的 `<managed-root>` 是实例 Skills 目录变量；示例 Memory ID、Revision ID、成员名及检索词
代替业务数据。其他被列出的英文文本为源码原文。“省略”表示不发送相应字节，不是向 Agent 发送
“已关闭”说明。JSON 示例按字段语义展示，不要求对象字段的序列化顺序。

### 变更总表

| 编号 | 模型或调用方看到的内容 | 本次变化 |
| --- | --- | --- |
| B01 | 有记忆时的 Memory Entrypoint | 开启原样；关闭整段省略 |
| B02 | 空索引的搜索教学 | 开启原样；关闭也省略，不用空库模拟关闭 |
| B03 | Memory 观察、授权证据与预算 | 关闭按实际省略内容生成，不查询索引 |
| D01 | 每 Run 动态输入 | 不增加 Memory 开关字段或关闭提示 |
| S01 | 平台 Skill 索引 | 关闭只删除 `memory-stewardship` 条目 |
| S02 | `memory-stewardship` 正文及引用文件 | 内容、文件与受管身份保持；关闭不从平台索引发现 |
| S03 | 通用 Charter / `cli-operations` 中的 Memory 提及 | 原文保留，下面列明具体位置 |
| C01 | CLI 根 help | 关闭移除 Memory 一行，Task 独立 |
| C02 | 四项 Memory 操作的定义、参数和成功结果 | 保持唯一静态定义，发现时按开关筛选 |
| C03 | 四项精确 help、family help | 关闭不输出精确操作说明；没有新增 family help |
| C04 | 操作错误目录 | 四项各增加 `memory.feature_disabled` / `stop` |
| C05 | 实际调用的关闭回包 | Core 返回统一错误，CLI exit code 为 2 |
| C06 | 同请求读回放与写回执 | 读走实时服务；已提交写回执保留且不重写 |
| C07 | 普通 Runtime 的 CLI 发现投影 | 增加 `memoryEnabled`，统一刷新 Task/Memory |
| C08 | Hermes 发现 | 从原有 Core IPC 查询两个能力，不依赖每 Run context 文件 |
| U01 | User Host 控制接口 | 新增 get/set 与设置变更事件，Agent 无写设置入口 |
| U02 | User Host Memory 业务接口 | 关闭暂停人工读取及新变更，已提交结果仍可确认 |
| U03 | 客户端通知、界面文案 | 停用页、重试和独立事件水位；不产生 Agent 会话提示 |

### B01：有记录时的 Memory Entrypoint

来源：[Bootstrap 构建](../../../crates/rovai-core/src/context/claim.rs) 与
[Entrypoint 生成/渲染](../../../crates/rovai-core/src/context.rs)。

**变更前：**公共 Thread 新生成 Bootstrap 按既有授权构造索引。有相应记录的 Scope 输出以下段落；
没有记录的 Scope 不输出该标题和表格。三个 Scope 均有记录时的完整形状为：

```text
[MEMORY_ENTRYPOINT]
### Hearth

| Memory ID | Kind | Retrieval Keys |
|---|---|---|
| memory_hearth_example | Agreement | review process |

### Companion

| Memory ID | Kind | Retrieval Keys |
|---|---|---|
| memory_companion_example | Preference | concise answers |

### Relationships

| Counterparty | Memory ID | Kind | Retrieval Keys |
|---|---|---|---|---|
| Example Member | memory_relationship_example | Lesson | review handoff |

Discovery index only. Use `rovai memory read` for current content and access state before relying on an entry.
[/MEMORY_ENTRYPOINT]
```

**变更后，开启：**同一输入数据产生同一段字节，保留标题、表格、结尾教学、排序、Scope 权限与上限。
既有 Hearth 最多 16 项、Companion 最多 32 项、Relationship 每对最多 12 项及整体最多 24 项的选择规则不变。
索引本来就不投递 Memory 正文，本次也不增加正文。

**变更后，关闭：**不调用索引读取/选择服务，整个 section 缺席。没有标题、表格、ID、关键词、
对手成员定位信息或结尾教学。相邻的原有 section 按既有 renderer 拼接，不以空标记占位。

Single Chat 原先不输出 Memory Entrypoint，开启和关闭均保持该分支。

### B02：空索引的搜索教学

**变更前，以及变更后开启且没有可索引记录时：**

```text
[MEMORY_ENTRYPOINT]
No Memory indexed at Session start; use `rovai memory search` when needed.
[/MEMORY_ENTRYPOINT]
```

**变更后，关闭：**以上完整段落省略。不会用“当前索引为空”的教学继续引导 Agent 调用 Memory。

### B03：观察、授权证据和预算

下表是 Core 内部字段及证据，不是新增模型输入 section：

| 项目 | 变更前 / 开启 | 关闭 |
| --- | --- | --- |
| `memory_entrypoint` | 按既有服务生成索引或空索引教学 | 空字符串，renderer 整段省略 |
| `observed_memory_revisions` | 选中条目的 `memoryId` / `revisionId` 集合 | `[]` |
| `authorization_basis_digest` | 对既有 schemaVersion、agentId、campId、presentMembers 对象计算摘要 | 对 `{"schemaVersion":1,"memoryAccess":"none"}` 计算摘要 |
| 上下文预算、Blob/digest、投递证据 | 依据实际生成字节 | 依据省略后的实际字节 |

只在原本需要生成输入的路径读取开关。不标记旧 Bootstrap 过期，不重算已冻结输入，
不新增 epoch、Binding 版本、Session 轮换或重投递。

### D01：动态输入没有新增开关提示

`RUN_FACTS`、`RUN_INPUT`、`COLLABORATION_STATE`、历史和 Task 相关动态结构保持现有定义。
不把 `memoryEnabled`、设置序号或通知水位塞入这些 section；它们分别属于本地发现投影和 User Host 状态。

本次不增加以下任何模型可见提示：

- “记忆已关闭”或重新开启方法；
- 开关改变通知、会话迁移说明；
- 针对已投递 Memory 的清理或忽略指令。

Agent 在实际调用 Memory 时从 C05 的错误回包得到反馈。

### S01：平台 Skill 索引的完整前后文本

来源：[平台索引构建](../../../crates/rovai-core/src/context/claim.rs)、
[受管 Skills 索引](../../../crates/rovai-core/src/managed_skills.rs)。

**变更前，以及变更后开启：**

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."},{"name":"memory-stewardship","desc":"Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation."}]}
[/ROVAI_PLATFORM_SKILLS]
```

**变更后，关闭：**

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."}]}
[/ROVAI_PLATFORM_SKILLS]
```

只移除一项；section 名、root、JSON shape、保留项顺序和 description 字节不变。
Single Chat 的平台索引也按同一个 Memory 状态过滤，尽管它原本就没有 Memory Entrypoint。

### S02：记忆 Skill 的正文、文件和引用保持

[Memory stewardship](../../../skills/memory-stewardship/SKILL.md) 的 frontmatter、正文及
`references/authority-and-safety.md`、`scopes.md`、`read-write-workflow.md`、`content-and-keys.md`
均未修改。受管源文件和身份不删除，重新开启时恢复索引条目。

关闭不撤回旧上下文已经提供的 Skill description，也不阻止 Runtime 的通用文件工具读取本来可读的 Skill 文件。
这些文件不能授予 Memory 业务权限；实际调用仍由 Core 拒绝。

### S03：关闭后仍保留的通用 Memory 提及

这次没有像 Task 迁移那样统一改写公共 Charter 和通用 Skill。下列现有文字保持：

公共 Charter 的既有一行：

```text
- Follow current user instructions; preserve existing user work. Prefer current evidence to Memory, history and cached context.
```

[cli-operations](../../../skills/cli-operations/SKILL.md) 的 description 已完整列于 S01；
其正文表格和引用仍包含：

```text
| Durable collaboration preference, agreement or lesson | Memory governance |
```

```text
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
```

[Memory routing](../../../skills/cli-operations/references/memory.md) 文件全文也保持：

```text
# Memory routing

Use `memory-stewardship` for stable preferences, future collaboration agreements or reusable lessons. It owns eligibility, Scope/Kind, duplicate checks, authority, safety and the minimum write.

After that decision, read the relevant `rovai memory view|search|read|write --help`. Hearth, Companion and directed Relationship use `memory write`. Hearth success is `review_pending`, not effective Memory. Mutual Relationship and lifecycle, forgetting and review decisions belong to structured user governance.

Temporary plans, project facts and historical evidence belong to their existing authoritative sources. Cross-Run visibility alone is not a reason to store Memory.
```

因此关闭时仍可能从通用教学或旧上下文得知 Memory 名称；本次明确控制的是专用索引/发现与实际业务访问。
这些保留项已属于 R1 的“cli-operations 及其他技能正文不改”，不是本轮额外增加的提示词。

### C01：CLI 根 help 的完整前后文本

来源：[CLI help](../../../crates/rovai-core/src/bin/rovai.rs)。以下固定为受管 Runtime 且 Task 开启，
用于单独展示 Memory 差异。

**变更前，以及变更后 Memory 开启：**

```text
Rovai CLI

Agent operations:
  rovai send
  rovai member list|get|create|update
  rovai task create|get|list|update
  rovai thread list|search|read|runs
  rovai history search
  rovai memory view|search|read|write
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs.
```

**变更后，Memory 关闭：**

```text
Rovai CLI

Agent operations:
  rovai send
  rovai member list|get|create|update
  rovai task create|get|list|update
  rovai thread list|search|read|runs
  rovai history search
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs.
```

Task 关闭时独立移除 Task 一行，两项开关有四种组合。非受管终端仍按既有规则追加 User Automation 段，
不猜测 Core 实例；缺少可信 context/能力时隐藏相应发现入口，不把它当作用户已经关闭的权威状态。

### C02：四项操作的定义与参数

[静态目录](../../../crates/rovai-core/src/team_tool_catalog.rs) 中的四项描述原文如下，
变更前与变更后开启完全相同。关闭时不从能力感知的目录或精确说明投影提供它们：

| Operation / CLI | 未改动的完整描述 |
| --- | --- |
| `memory.view` / `rovai memory view` | Return the complete current applicable Memory set for Hearth, this Agent's Companion, or one exact Relationship pair. The result is never paginated or truncated; copy one returned target unchanged into memory.write revise. |
| `memory.search` / `rovai memory search` | Search active Memory that is currently accessible to this Agent. Results are discovery hints, include immutable Scope identity for safe target selection, and do not include full bodies. |
| `memory.read` / `rovai memory read` | Resolve stable Memory IDs against current Revision, lifecycle, Thread access, and Presence. Authorized current results include one copyable target; stale/deleted results never return old bodies or target identity. |
| `memory.write` / `rovai memory write` | Add or revise Memory within the current Agent's authority. Revise must copy the exact target from the deciding memory.view or current memory.read result. Companion and directed Relationship writes are immediately effective; Hearth writes create a pending user Review Item. |

输入 Schema、字段描述、直接 flags、示例、成功结果 Schema 和 Agent output projection 保持：

| 操作 | 保留的输入与约束 |
| --- | --- |
| view | `scope`；Relationship 另需 `counterpartyAgentId`；对应 `--scope`、`--counterparty-agent-id` |
| search | `query`、可选 `limit`，既有上限 6；对应 `--query`、`--limit` |
| read | `memoryIds`，1–4 个唯一 ID；对应可重复的 `--memory-ids` |
| write add | `action=add`、`scope`、`kind`、`body`、`retrievalKeys`；Relationship 另需对手 ID 和 `direction=directed` |
| write revise | `action=revise`、原样复制的 `target`、`body`、`retrievalKeys`；不改变 target 的身份/Revision 校验 |

精确定义仍分别归 [Memory retrieval](../../../crates/rovai-core/src/memory_retrieval.rs) 与
[Memory write](../../../crates/rovai-core/src/memory_tool.rs)。没有新建 Agent 工具，没有让 Agent 设置开关，
没有增加按 Scope 的参数或第二套关闭态 Schema。

静态 catalog 和 canonical 解析定义保留全量操作，供完整性检查、参数校验及旧调用执行使用；
能力感知的 `builtin_tool_list_with_memory` / `builtin_tool_description_with_memory` 才过滤发现。
这两个是内部函数，不是新增 `rovai tool list/describe` 命令。

### C03：精确 help 与实际执行分开

| 请求 | 变更前 / 开启 | 关闭 |
| --- | --- | --- |
| `rovai memory view --help` | 原有操作说明、参数和示例 | 不输出该说明 |
| `rovai memory search --help` | 原有操作说明、参数和示例 | 不输出该说明 |
| `rovai memory read --help` | 原有操作说明、参数和示例 | 不输出该说明 |
| `rovai memory write --help` | 原有操作说明、参数和示例 | 不输出该说明 |
| `rovai memory --help` | 既有 family-help 无效输入行为 | 保持，不新增 Memory family help |
| 合法的实际 `rovai memory <action> ...` | 解析后发送 Core | 仍解析并发送 Core，由 Core 判断当前状态与回执 |

当前 CLI 在精确 help 被过滤时沿用本地通用安全错误，exit code 为 2，输出原文为：

```json
{"error":{"code":"builtin_tool.cli_error","message":"Built-in Tool request could not be completed.","recovery":"stop"}}
```

这是 help 的本地结果，不是 C05 的 Memory 业务错误。内部 description helper 的拒绝含
`memory.feature_disabled: Rovai long-term memory is disabled.`，CLI 不直接打印该内部错误字符串。
本次没有在请求进入 Core 前整组阻断 Memory，所以已提交写入仍能走 C06 的确认路径。

### C04：工具错误目录新增一项

四项操作原有错误目录都保留；每项增加同一个 `errors[]` 元素：

```json
{"code":"memory.feature_disabled","recovery":"stop"}
```

该元素出现在结构化 `BuiltinToolDescription`，不是新增的 help 教学段落。
Envelope Schema 已支持 `stop`，Agent 错误投影也已有 `error` 外层；本次不改它们的 shape，
不新增“关闭原因”、设置入口或重试步骤。

### C05：Core 实际关闭回包

**变更前：**没有实例开关拒绝；按原有权限、Revision、生命周期等规则执行。

**变更后：**在有效调用身份、合法输入及既有回放规则下，关闭时新的
`memory.view/search/read/write` 业务停止。CLI 的模型可见完整错误为：

```json
{"error":{"code":"memory.feature_disabled","message":"Rovai long-term memory is disabled.","recovery":"stop"}}
```

Core 内部仍使用既有带 operation/requestId 的错误 Envelope，CLI 只投影上述错误对象，不返回正文、
片段或成功 result。CLI exit code 为 2。`stop` 只停止本次记忆操作，普通对话、其他工具和 Run 继续。
设置不可读、身份失效或输入非法仍沿用各自错误，不把它们伪装为已确认关闭。

### C06：缓存回放、重新开启与成功回执

来源：[运输层回放与结果选择](../../../crates/rovai-core/src/application.rs)、
[Memory 提交](../../../crates/rovai-core/src/memory.rs)。

| 场景 | 变更前 | 变更后 |
| --- | --- | --- |
| 相同读 request 命中旧 Envelope | 领域服务之前可能直接返回旧正文/片段 | 跳过旧读 Envelope 的直接返回，进入现有实时服务 |
| 当前关闭 | 没有此状态 | 检查与结果交付选择同处既有 Core 串行边界，返回 C05，不交付旧正文 |
| 重新开启后的相同旧读 request | 可能仍返回缓存读结果 | 重新判断当前授权、Presence、生命周期和 Revision；已遗忘/停用内容不从旧缓存恢复 |
| 相同 request/digest 的已提交写入 | 返回已有回执，不重复业务效果 | 保持；关闭期间也可确认原回执 |
| 新写入或新 Hearth 候选 | 按原规则形成 | 关闭时在实际提交事务拒绝，不形成业务效果 |

写入成功的两种模型可见回执保持以下完整 shape：

```json
{"outcome":"effective","memoryId":"memory_example","revisionId":"revision_example"}
```

```json
{"outcome":"review_pending","reviewItemId":"review_example"}
```

两者均不含 Memory 正文。`review_pending` 仍表示已有待审核候选，不表示正式记忆已经生效。
不因关闭重放写入，也不把已经提交的成功结果改判失败。
关闭期间已经记录的 durable 拒绝继续遵循原 commandId 的幂等事实，重新开启后的新意图使用新命令身份。

生效时间以 Core 设置提交与结果选择的顺序为准；此前已确认的结果可能晚到。
不增加读缓存版本、后台失效任务或 Memory epoch。

### C07：普通 Runtime context 的发现投影

以下仅展示完整 context 中的能力字段，认证、lease、Run/Binding 和 endpoint 字段保持原定义：

| 变更前 | 变更后 |
| --- | --- |
| `{"tasksEnabled":true}` | `{"tasksEnabled":true,"memoryEnabled":true}` |

`memoryEnabled` 缺失、文件不可信或版本不匹配时，CLI 不展示 Memory 发现入口。
这只是发现的保守降级，实际调用仍进入 Core。

设置变化及原有绑定刷新都经过
[统一发现刷新入口](../../../crates/rovai-core/src/application.rs)，在一次 Core 读取中取得 Task 和 Memory
当前状态后写完整 context，避免各刷新路径覆盖对方字段。刷新失败不撤销 lease、停止 Run 或回滚设置，
同值保存和既有有界重试可修复投影。刷新本地文件不会向旧会话发送新 Bootstrap。

### C08：Hermes 的发现路径

Hermes 是 Rovai 已接入的 `hermes-cli` Runtime，它使用已有逻辑/native Session 身份找到 Core，
没有普通 Runtime 的每 Run CLI context 文件。

**变更前：**Hermes 的 CLI 发现分支将 Task 视为可提供，Memory 随静态目录提供，不查询当前实例能力。

**变更后：**CLI 复用原有 discovery endpoint 与 Session 路由，发送只读 body：

```json
{"kind":"capabilities"}
```

Core 按当前权威状态返回：

```json
{"kind":"capabilities","capabilities":{"tasksEnabled":true,"memoryEnabled":false}}
```

随后按同一 C01–C03 逻辑生成 help。无法取得可信能力时保守隐藏两项发现，不能据此修改 Core 设置。
Core 读取能力状态失败时，IPC 返回以下控制错误；CLI 将其当作发现不可用，不打印为 Memory 业务结果：

```json
{"kind":"error","error":{"code":"builtin_tool.internal_error","message":"Capability state is unavailable"}}
```

实际 Invoke 仍走原有 Core 入口。此请求不创建业务操作、回放记录或新会话映射，不另建 Session 同步，
也不会因为发现调用而触发 Bootstrap 更新。普通 Single Chat 的 Task 投影仍为 false，Memory 为实例值。

### U01：用户控制接口及顺序

新增 User Host 方法和事件：

```text
preferences.memory.get {}
preferences.memory.set {"enabled":false}
preferences.memory_changed
```

get/set 返回完整快照示例：

```json
{"enabled":false,"headsUpAfterGlobalSequence":100,"observedThroughChangeSequence":7,"observedThroughGlobalSequence":110}
```

设置变更事件是提交后的失效提示，其 params 为 `{"enabled":false}`，客户端重读权威快照。
同值保存可修复投影但不推进设置时钟或提示边界。User Host 的这些接口不是 Agent CLI 工具，
不新增 `rovai memory enable/disable` 命令。

`observedThroughChangeSequence` 只排序设置；两个 GlobalSequence 字段只用于 Memory 事件边界。
快照中的示例特意使用不同数量级，不能将设置序号 7 与记忆事件序号 100/110 直接比较。

### U02：人工管理接口也停用

这些是用户管理业务，不加入 Agent 的四项工具目录：

| 类别 | 现有方法 | 关闭时 |
| --- | --- | --- |
| 读取/导出 | `memory.list/get/export`、`memory.hearthReviewItems.list` | 不加载/查询业务内容 |
| 正式记忆变更 | `memory.create/revise/retire/reactivate/forget/supersede/review.schedule` | 不提交新的业务效果 |
| 审核 | `memory.hearthReviewItems.accept/reject` | 不提交新的审核决定 |
| 控制/结果确认 | U01 的设置接口、已有提交的幂等回执 | 保持可用，不启动新的 Memory 业务 |

检查集中在读取服务和幂等回放之后的提交事务，不在最外层按 `memory.*` 一刀切。
保留数据、修订和待审核项；重新开启按原有生命周期恢复可用内容，不自动 reactivate 或接受候选。

### U03：客户端文案和通知边界

完整中文 UI 文案见本文“用户界面”表；界面只新增该表中的开关说明、上下文边界、停用/加载/失败态及入口。
开启时既有“正在沿用”“停止沿用”“重新沿用”等业务文案保持，关闭隐藏业务区及计数。
未提交草稿可以留在本地组件状态，停用时不展示或提交，重新开启不会自动形成记忆。

`preferences.memory_changed`、Web SSE 的 `memoryChanged`、Provider 状态均为客户端同步，
不是给 Agent 的会话消息。`events.subscribe` 的 User Host 响应增加可选 `memoryCapability`，
其 shape 与 U01 相同；Memory 事件 schema 9 及既有事件通道保持。

关闭/未知状态抑制记忆行为提示并继续推进现有事件游标；关闭→开启固定 Memory 事件水位，
断线重订阅使用事件边界过滤旧提示。关闭前提交的迟到回执仍可确认成功，但不触发新读取、
旧行为 toast 或“刷新失败”造成的保存失败印象。

### 版本轴与审阅结论

| 项目 | 本次结论 |
| --- | --- |
| 数据库 | Migration 224 / projection schema 174；只新增实例设置及提示水位 |
| Built-in transport / IPC | 45 / 3 保持；能力发现为现有 IPC 的加法形状 |
| Agent Output | 保持；成功回执和通用错误 shape 不变 |
| Bootstrap / Binding / formatter / profile / manifest | 均保持，不增加兼容版本或过期机制 |
| Skill 正文及 Runtime 原生 Memory 策略 | 均保持 |
| 本轮文档补充 | 仅补全已实现差异和仍保留内容，不新增模型输入规则 |
| 验证资格 | 前文自动化结果保持；真实模型 12 Case Gate 仍为 not_run / 证据不足 |

与 Task 方案相比，这次只做一个 Memory 能力的条件投递和业务阻断，不复刻 Task 的通用提示词清理、
Send 关联退役或会话治理。评审可按 B/D/S/C/U 编号定位每项变化；后续如要进一步清理通用 Skill 中的
Memory 提及，应作为独立语义变更再审阅，不能把它算作本清单已实施内容。
