---
document_type: model-context-change
version: v1.72
change_id: memory-capability
revision: 4
confirmation_status: confirmed
confirmed_revision: 4
confirmed_by: User
confirmed_at: 2026-11-12
confirmation_message_id: f9a37446-9a3f-4716-ac6c-7e0b9cd6aaf0
authority: proposed-model-input-change-statement
implementation_status: implemented
review_baseline: d7b69cb64b33fbc12f8e8cdb10e9876dae8a0633
last_updated: 2026-11-12
---

# Rovai 长期记忆实例开关

本说明累计记录 R1/R2、User sequence 25 的 R3 修正及 User sequence 27 已审阅前后行为并要求局部收口的 R4 修正。
R2 原稿固定保留在 [f0a8380ab](https://github.com/murray17/rovai-ai/blob/f0a8380ab291c97768ea682fb60364c69f147266/docs/versions/v1.72/model-context-change-memory-capability.md)。
R2 在 R1 实例开关上增加通用 CLI Skill 的固定精简，
采用 User 已审阅的五处替换，不动态改写开关两态的共享 Skill。R1 原稿固定保留在
[fb603a168](https://github.com/murray17/rovai-ai/blob/fb603a168198eec5d6486a6aae5c65f5214d804d/docs/versions/v1.72/model-context-change-memory-capability.md)。
只增加一个默认开启的 Core 实例设置，控制 Rovai Memory
的业务操作、新生成输入和发现投递，以及 Desktop/Web/Mobile 的管理界面。同一开关覆盖 Hearth、
Companion、Relationship。关闭保留正式记录、修订、审核候选和已经发生的提交结果；人工管理也暂停。
不增加每 Thread、每队员、每 Scope 覆盖，不改 Runtime 原生记忆策略，不引入通用 Feature Flag 框架。

完整提示词、工具定义/help、错误回包与回放差异可直接按文末的
[逐项审阅清单](#完整提示词与工具对照)阅读；编号与 Task 方案一致，并单列关闭后仍保留的通用文字。

## R4：观察顺序、恢复刷新与最终结果一致性

User 消息 `f9a37446-9a3f-4716-ac6c-7e0b9cd6aaf0` 已列出完整调用链、变更前后和局部修正范围，
要求继续修复且不增加复杂机制或页面信息。本 revision 只落实该范围，不改变提示词、工具 shape、
错误文案、三个快照字段或任何会话版本轴。R3 原稿固定保留在
[5e3202faf](https://github.com/murray17/rovai-ai/blob/5e3202faff7361afda5f044e45b735add31e7b7a/docs/versions/v1.72/model-context-change-memory-capability.md)。

| 位置 | 变更前 | R4 变更后 |
| --- | --- | --- |
| Provider | save 错误可能掩盖 read 错误；get 与轮询分开排序 | 读取失败明确 ready=false；共用现有本地观察代次，先按 Core 设置序号，再按同序号观察顺序接收；旧 null/失败不能覆盖较新观察，较高 Core 设置序号仍可更新 |
| 恢复连接 | 通知抑制水位同时过滤内容刷新 | 旧通知继续抑制；恢复成功独立刷新内容和审核数，Web 沿用 resync |
| 工具最终读取结果 | 成功活动记录已保存，外层可能再改判拒绝 | 在既有数据库串行边界内选定最终结果，再共同生成活动记录、Envelope 与返回；关闭先于选择则一致失败，选择先于关闭则保留在途成功 |
| 审核列表 | 父页面与 Memory 页面均读取完整审核列表 | Memory 页面打开时由其现有回调提供计数，页面外由父组件读取；合并初次/内容刷新触发 |
| Web 失效 | 任意失效都读取 Memory 全量内容 | 现有通道增加 metadata-only memoryContentChanged；实际已提交新变更发出 memory.changed，SSE 解码/合并保留此标记，Memory 只响应内容变化和 resync；设置标记 memoryChanged 继续独立 |
| 批量管理读取 | list 每条 get 重复检查，export 又重复检查 | 公开入口保持检查，内部使用私有记录加载；export 复用已检查的 list，不增加开关缓存 |
| 读取恢复 UI | 已有列表时刷新失败没有重试入口 | 原错误行始终提供既有重试按钮，保留当前列表与选中内容，不新增提示块或文案 |

结果选择与设置提交共用现有 Core DB 锁；不新增锁、结果副本、持久字段、epoch、会话缓存或后台刷新。
冻结 Bootstrap/已投递输入与旧会话保持，不主动更新或提示。现有幂等回放与已提交写入回执保持。
验证扩展 Provider 交互、Core 工具/活动记录、Web SSE/解码/恢复及 Memory 管理既有 owners，
不以受控测试代替真实 Runtime/模型资格。实施结果见下节。

## R4 实施与验证结果（2026-11-12）

复核确认三处行为问题成立，重复读取也有明确调用来源。本轮修正保持在原函数、Provider 和既有失效通道内。
Provider 只扩展内存中的观察元数据，快照仍为三个字段；成功/失败/事件回包共用同一接收规则。
Core 将最后一次检查前移到成功证据之前，并复用该数据库 guard 记录证据；外层不再改判。
Web 的 memory.changed 覆盖 applied 正式记忆与 accepted 待审核候选的新提交，SSE 内容标记不携带正文。

| 复核 | 实际结果 |
| --- | --- |
| `cargo test --workspace` | 484 passed / 1 existing ignored |
| Core `task_discovery_refresh_scopes_bindings_and_repairs_saved_preferences` owner | 通过；利用现有 FIFO DB 锁队列稳定安排实际读取之后、最终结果选择之前关闭；回包、完整分段存储证据和活动记录均失败，错误一致且无正文；正式写入/accepted 审核候选各一次内容提示，回执回放/重复候选拒绝零提示；R3 三类坏设置及回执用例继续通过 |
| `cargo test -p rovai-core --features slow-tests --lib memory` | 29 passed；权限、生命周期、管理与幂等回放保持 |
| `pnpm test` | Vitest 276 files / 3275 passed / 2 skipped；默认 Node 377 passed / 2 skipped；通知与 Web 解码 owners 通过 |
| `pnpm test:memory-workspace-ui` | 通过；生产 Provider 的 save→read 失败、两个方向同序号旧轮询、较高 Core 序号的旧 get、未知/关闭与重试；无关失效零全量读取，内容失效/resync 各一次读取，已有旧列表失败仍可原位重试 |
| `pnpm test:startup-presentation` | 通过；生产 Desktop App 配受控 API/时钟，轮询断线及事件缺口恢复后内容和待审核数更新，页内审核列表各读一次，不补旧提示；其余启动/导航/Task 场景保持 |
| `pnpm test:memory-web-ui` | 通过；真实隔离 Host/Web，页内审核读取一次，无关 Task 失效零 Memory 读取，远端内容变更各读一份列表；受控网络中断期间 Core 保持运行，恢复后刷新内容，页面外恢复读取待审核数 |
| `pnpm typecheck`、`pnpm build:desktop`、`cargo check --workspace`、格式与通用文档门禁 | 通过 |

list/export 的开关检查均收为一次入口检查，get 保持检查。这里减少重复 SQL，不将它描述为主要性能瓶颈。
Memory 页内与父组件的审核读取互斥；初次与内容刷新使用同一 effect。没有引入缓存、计数表、定时任务或新通知系统。
界面只放开原错误行的既有重试按钮，没有新增说明文案或区块。真实 Runtime/模型 Gate 仍为
`not_run / 证据不足`；受控 Desktop/网络测试不替代原生 Runtime 或跨平台真机验收。

## Desktop 全局内容刷新补正（2026-11-12）

User sequence 29（`7321ce5b-de3f-432c-b680-044c6cb68a2a`）指出，选中 Thread 时忽略全局 Memory
失效并依赖该 Thread 的轮询，会漏掉其他 Thread 和 camp_id=NULL 的管理变更。Core 的实际过滤已核对；
发出端与授权正确，仅修正 Renderer 两处接收条件。

| 路径 | 变更前 | 变更后 |
| --- | --- | --- |
| 全局 memory.changed | 只有未选中 Thread 才刷新内容 | Memory active 时统一刷新实例内容和审核数 |
| 当前 Thread 轮询 | 恢复/缺口及普通 memory.* 都刷新内容 | 仅恢复/缺口补刷新；领域事件继续驱动本会话行为提示 |

沿用 R4 的页内/页外读取分工和通知过滤，不改变事件查询范围、协议字段、Provider、Core、存储、
模型可见字节、工具定义或任何 Session/Bootstrap 版本轴，本次仅补正 R4 实现，不增加模型输入 revision。
在现有 Desktop production App owner 中补充：选中 A 时接收 B 的候选与人工管理变化、页外审核计数刷新、
全局通知和本会话领域事件不重复读取，以及普通领域事件仍显示行为提示；断线/缺口原 owner 保留。
验证结果：新增 production App 场景在 `b14d20ec9` 的原条件下明确失败，报错为选中 A 时 B 的记忆变化未刷新；
仅修改上述两处条件后 `pnpm test:startup-presentation` 通过。场景覆盖跨会话候选、人工管理变化、
页外仅刷新待审核数、本会话领域事件仍产生行为提示，以及全局/轮询不重复读取；原断线/缺口场景保持通过。
`pnpm typecheck`、`pnpm build:desktop`、`pnpm test` 与通用文档门禁通过；Vitest 3275 passed / 2 skipped，默认 Node 377 passed / 2 skipped。
该 owner 使用生产 Desktop App、独立 Electron profile 和受控 API/时钟，不启动 Core 或真实 Runtime。
本次无 Rust/模型输入变更，既有 Core 和真实模型资格记录保持。

## R3：局部故障隔离与通知/发现收简

User 已审阅 `d7b69cb → f0a8380ab` 的完整实现，消息 `2b3bcad2-ac73-41d8-bcb7-076ba5a1b8ab`
明确列出五项修正的变更前后行为并要求独立判断后修改，本节先记录该授权范围再实施。

| 位置 | 变更前 | R3 变更后 |
| --- | --- | --- |
| 普通输入准备（含 Single Chat） | Memory 设置读取错误导致输入准备失败 | 只省略 Memory Entrypoint 与记忆技能索引；普通输入继续，已冻结输入保持 |
| `events.subscribe` | Memory 快照失败导致整个事件请求失败 | 事件和自身游标正常返回；`memoryCapability: null` 明确表示局部不可用，Provider 进入读取失败态；字段缺省仍按既有可选字段处理 |
| 统一 CLI context 与能力发现 | Memory 设置读取失败阻断 Task 投影/能力返回 | 同次读取保留有效 Task 状态，Memory 不可用时仅隐藏其发现入口；不写回设置、不生成替代设置记录 |
| Memory 工具与设置接口 | 严格读取设置，读取错误不交付正文/不提交新效果 | 保持；错误不伪装为用户关闭，已提交写回执保持 |
| 已显示通知 | 仅在观察到关闭时清空，新通知按边界过滤 | 边界推进后清除旧审核提示，已有变化只保留 `sequence > headsUpAfterGlobalSequence`；保留边界后的新提示，迟到回调保持顺序隔离 |
| Hermes CLI | 每条命令先远程查询能力，失败返回两项 false | 仅 help 等发现路径远程查询；实际已知命令直接进入 Core。发现失败明确报不可用，不作为 Task 已关闭 |
| Memory 快照 | 四字段，事件表最大序号会造成无关更新 | 删除 `observedThroughGlobalSequence`，完整新形状如下；不增加替代字段或数据库结构 |
| 审核列表刷新 | 全局设置排序时钟变化触发全量请求，多个入口可重复读取 | 由实际启用状态、重新启用边界及 Memory 内容事件触发；同一 BusinessApp effect 合并同一轮刷新入口，排序序号只隔离设置快照/未知回包，原 effect cleanup 隔离过期列表回复 |

```json
{"enabled":true,"headsUpAfterGlobalSequence":100,"observedThroughChangeSequence":7}
```

Memory 设置异常时新输入的 Memory 段为空，`observed_memory_revisions=[]`，授权摘要沿用
`{"schemaVersion":1,"memoryAccess":"none"}`，预算与实际字节一致，不增加模型提示文案。
事件 `schemaVersion=9`、工具错误结构、数据库 Migration 224/schema 174 及全部上下文版本轴保持。
不新增 Memory epoch、会话缓存、后台刷新机制或通用 capability 框架；不重建 Session、作废 Bootstrap、
补发输入、主动提示旧会话，也不删除已经进入上下文的内容。

验证扩展现有 Core discovery、Bootstrap、CLI 进程、Memory 通知与 Web owners，覆盖缺行/非法设置、
普通输入与事件继续、Task 投影更新、已有提示跨漏看的关闭→开启边界、Hermes 已知调用零预查询和
无关全局时钟零审核读取。真实模型 Gate 的既有未执行状态保持，不以受控夹具替代。

## R3 实施与验证结果（2026-11-12）

独立核对后采纳五项修正。此前可用性复核覆盖了正常关闭，遗漏了设置单例缺行/损坏时的依赖传播，
R3 在原有 owners 中补齐这些故障用例。权威读取仍严格；只有可选输入/发现使用省略分支。
设置中的 enabled 与提示水位同次读取，快照 SQL 从四次降为两次，不再每次查询事件表最大序号。
BusinessApp 的审核列表读取入口从三处收为一个 effect，以 active、重新启用边界和 Memory 内容刷新信号驱动，
原 cleanup 隔离旧请求；不新增在途缓存。审核提示由布尔值改为当前提示的事件序号，既清旧提示，也保留边界后的新提示。
通知数组的边界剪裁和重新合并由纯函数 owner 验证；审核刷新条件通过唯一调用点及 effect 依赖核对，
Host/Web 夹具验证真实接口与开关同步。旧会话与真实模型行为的资格边界保持独立。

| 复核 | 实际结果 |
| --- | --- |
| `cargo test --workspace` | 484 passed / 1 existing ignored |
| `cargo test -p rovai-core --features slow-tests --lib task_discovery_refresh_scopes_bindings_and_repairs_saved_preferences` | 通过；缺行、非法 enabled、非法提示水位时，设置 get 报错，普通会话打开/事件/成员操作继续，Task 仍可切换和投影，Memory 读取拒绝，既有写回执保持，坏记录未被改写 |
| `cargo test -p rovai-core --features slow-tests --lib newly_bound_session_bootstraps_on_its_current_generation` | 通过；三个故障下普通/Single Chat 新内容省略 Memory，冻结 evidence ID 与 payload 保持 |
| `cargo test -p rovai-core --features slow-tests --lib memory` | 29 passed；原权限、生命周期、回执和重启 owners 保持 |
| `pnpm test` | Vitest 3275 passed / 2 skipped；默认 Node 377 passed / 2 skipped，包含通知边界前剪裁/合并后正确计数的反例 |
| `pnpm test:send-input-file` | 通过；Hermes help 成功/失败、实际 send/Task/Memory 只发一次 Invoke，失败未转成 Task 已关闭；其隔离子 Home 的 Hermes 进程子矩阵在 Unix 执行，共享命令分类 owner 覆盖全部平台 |
| `pnpm test:memory-workspace-ui` | 通过；10 组交互 / 18 组视口配色，三字段状态、显式 null 投影、较旧不可用回包和不可用之后同序号旧成功回包隔离、重试与停用业务零读取 |
| `pnpm test:memory-web-ui` | 通过；真实隔离 Host/Web，三字段接口、远端关闭同步、页内开启、创建/修订内容保留；夹具按现有设置内记忆导航及 Activity 可见性操作 |
| `pnpm typecheck`、`pnpm build:desktop`、`cargo fmt --all` | 通过；包含 Desktop/Web 构建 |
| `pnpm docs:test`、`pnpm docs:check`、diff-aware gate、`git diff --check` | 通过 |

本轮未新增数据库结构、持久化记录、会话版本或后台刷新层。真实 Runtime/模型的通用 Gate 仍为
`not_run / 证据不足`；受控 IPC、Core 与浏览器夹具不能替代真实模型资格。

## 用户界面实际改动

开启后的记忆管理页保留现有列表、详情或审核交互，标题旁增加同一个 Core 总开关。
2026-11-11 按 User 后续界面要求（消息 `36e691bf-4064-42c2-8c00-79466a98f2a6`），关闭态改用 MCP 首次空状态的留白、图标和窄内容列，支持在记忆页直接开启。
此项仅调整用户界面，不改变 R2 已确认的模型输入、工具或会话语义。

| 位置/状态 | 修改前 | 修改后 |
| --- | --- | --- |
| 通用设置 → 会话 | 自动打开执行台、会话任务、世界地图 | 在会话任务后新增“Rovai 长期记忆”开关和问号说明；其他行保持 |
| 记忆管理页，开启 | 列表、详情、搜索、计数、新增、审核与管理可用 | 原有管理功能照常使用，标题旁增加与通用设置同步的总开关 |
| 记忆管理页，关闭 | 没有此状态 | 保留记忆导航，隐藏列表、详情、搜索、计数、新增、编辑、审核和复核业务；以 MCP 首次空状态为参照，显示图标、停用说明和直接开启的总开关 |
| 设置状态读取失败 | 没有此状态 | 显示“状态暂不可用”及重试，不加载业务，不显示为确认关闭 |
| 迟到结果/通知 | 原业务刷新和提示路径 | 关闭时不恢复业务区、不再发起后续读取或补弹旧行为提示；已有提交事实保留 |
| 重新开启 | 不适用 | 重新读取当前仍有效的数据，恢复原有管理功能，不自动提交本地草稿 |

因此评审需要分别查看“开启时保留管理功能并增加开关”和“关闭后管理页停用”。
精确文案见下文“用户界面”；停用不改变已经保存的记录、修订或审核项。

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

以上是变更前的基线 frontmatter；R2 的通用 description 替换及完整索引对照见 S01/S03。

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

Memory Entrypoint、四项 Memory 工具和管理界面正常提供；平台索引中 cli-operations 使用 S03 的
统一精简描述，memory-stewardship 正常提供。现有读取授权、Scope、Presence、
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
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."}]}
[/ROVAI_PLATFORM_SKILLS]
```

- CLI 目录、操作说明和 help 隐藏 Memory 发现入口。技能源文件保留；cli-operations 在开启/关闭时
  共用 S03 的精简正文，其他技能正文保持。
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

通用设置 → 会话，位于会话任务旁；记忆页提供同一个总开关：

| 位置 | 完整文案 |
| --- | --- |
| 标题 | Rovai 长期记忆 |
| 帮助 | 允许队员读取并形成 Rovai 的长期记忆。关闭后暂停记忆访问与管理，已保存数据保留。 |
| 帮助中的上下文边界 | 已进入当前对话上下文的内容仍可能保留。 |
| 停用页标题 | Rovai 长期记忆已关闭 |
| 停用页说明 | 已保存的记忆会保留，重新开启后可继续使用和管理。 |
| 记忆页开关（开启态标题旁、停用态说明下） | Rovai 长期记忆 |
| 初始读取 | 正在读取记忆设置… |
| 读取失败 | 无法读取长期记忆设置，请重试。 |
| 保存中/失败/重试 | 正在保存… / 未能保存，请重试。 / 重试 |

Memory 导航保留；两处开关共用同一 Provider，保留保存中、读取失败、保存失败和重试行为。
停用页不加载/展示业务内容、计数、审核或复核提示。开启时原有沿用/复核文案保持，
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
`04816bb6-4968-4df3-86bc-ee820c84644e` 明确要求“那你开启wt执行”，作为 R1 的实施确认。

User 在 `1d843388-cde5-4038-a344-6b3af2b55228` 要求重新评估 S03。完整五处前后差异、替换后的
SKILL.md、旧 reference 全文和规则去向已通过离线 HTML 交付，见消息
`919c2ceb-f6a0-418b-8d99-ea3664dab723`。随后 User 在
`1d5d32d6-6b6f-40a0-88bd-2de7062ac1df` 明确要求“那你动吧，然后再给我一份md”，
确认该五处方案，作为 R2 的实施授权。R2 不扩大 Core、数据库、Session 或 UI 业务行为。
本文件的 R2 全文先于 Skill 实现归档；原 R1 通过上述不可变 commit 保留。

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

## R2 实施与验证结果

R2 全文先通过独立提交 `bd6b4acbe` 归档，再修改 Skill 资源。实现只涉及三个文件中的五处位置：
通用 description、选择表、References、界面 short_description 和旧 Memory reference 正文。
实际资源与 User 之前审阅的完整替换稿逐字一致。memory-stewardship、Charter、Core 业务代码、数据库
和全部上下文版本轴没有新增改动。

| R2 复测 | 结果 |
| --- | --- |
| `pnpm skills:check` | 12 个 Skill 通过；名称、引用及界面元数据保持合法 |
| `cargo test --workspace` | 484 passed、1 existing ignored |
| `cargo test -p rovai-core --features slow-tests --lib managed_skills::` | 3 passed；覆盖 frontmatter/index、资源同步修复及既有配置/回放 owner |
| `cargo test -p rovai-core --features slow-tests --lib newly_bound_session_bootstraps_on_its_current_generation` | 1 passed；新生成能力分支和已冻结 Bootstrap 保留 |
| `pnpm test` | Vitest 276 files / 3275 passed、2 skipped；默认 Node 377 passed、2 skipped；文档、Skills 和沙箱门禁通过 |
| 通用文档门禁、diff-aware gate、`git diff --check` | 通过 |

上述 R2 Skill 精简阶段没有修改 Renderer 生产组件；当时交互稿只增加评审场景按钮、差异说明及默认的关闭态对比，便于看清
“开启时管理页原样”与“关闭后管理页停用”。产品中的 UI 差异以上方表格和实际生产组件为准。
真实模型 12 Case Gate 仍为 `not_run / 证据不足`，不将文本核对、单测或交互稿当作模型行为资格。

## 界面跟进与验证（User sequence 17）

按消息 `36e691bf-4064-42c2-8c00-79466a98f2a6` 完成两项界面修改：关闭页参照真实 MCP 首次空状态，
采用 460px 内容列、32px 图标、实际计算样式的 18px 标题和 13px 说明；在开启态标题旁和关闭态说明下
提供同一个 Core 开关。通用设置保留原开关，两个入口共用 Provider，不新增状态源或业务设置。
仅修改 Renderer、现有 UI owner 和界面合同；模型 R2、工具、数据库与 Session 边界保持。

| 验证 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| App、GeneralSettings、interface-language-catalog 现有 Vitest owners | 3 files / 194 passed |
| `pnpm test:memory-workspace-ui` | 通过；沿用 10 组交互与 18 组视口/配色，补齐页内开关、失败重试、保存防重复、键盘开启、停用无业务读取和横屏布局 |
| 真实源码离线对比稿 | 6 组交互核对、16 张截图；关闭态覆盖 5 套配色 × 5 种桌面/移动/横屏视口，两处开关状态同步，MCP 与记忆空状态尺寸核对一致 |
| `pnpm build:desktop` | Desktop/Web/执行台生产构建通过 |
| 通用文档门禁、diff-aware gate、`git diff --check` | 通过 |

对比稿直接编译上一版 `927613194` 与本工作树的生产组件/CSS，只替换演示数据与 transport；
沿用 BusinessApp 的设置侧栏及移动布局，另提供真实 MCP 空状态参照。原型按仓库规则仅本地保存，
测试和当前文档不依赖它存在。验收使用隔离浏览器 profile，不启动 Core 或真实 Runtime，不修改日常数据。

## 收尾与可用性复核（2026-11-12）

User sequence 23（消息 `572a80f2-b5f7-4352-a93e-0c788e7b2ce4`）授权继续在现有 Memory worktree 执行。
读取失败提示统一收简为“无法读取长期记忆设置，请重试。”，同步中文/英文界面及当前 UI 说明。
保留既有请求失败与重试分支；S03.3 补清旧 reference 的准确路径和原位覆盖理由，Skill 内容与同步机制保持。
此次收尾不改变 R2 的模型输入、业务授权、默认值或旧会话边界。
类型检查、4 个 Renderer owners 的 199 项用例、生产 Memory UI owner（10 组交互 / 18 组视口配色）、
Desktop/Web 构建及通用文档门禁通过；读取失败仍与已确认关闭分开，保存失败沿用原重试机制。

可用性复核重新运行现有 owners，共 32 项通过：

| 命令 | 结果与覆盖 |
| --- | --- |
| `cargo test -p rovai-core --features slow-tests --lib memory` | 29 passed；三种 Scope、读写/管理权限、生命周期、已提交回执与重启保留关闭 |
| `cargo test -p rovai-core --features slow-tests --lib task_discovery_refresh_scopes_bindings_and_repairs_saved_preferences` | 1 passed；两个开关独立、现有运行进程发现、关闭读缓存、提交回执与重开实时读取、Hermes 既有发现路径 |
| `cargo test -p rovai-core --features slow-tests --lib newly_bound_session_bootstraps_on_its_current_generation` | 1 passed；新输入按当前状态生成，已冻结 Bootstrap 的 evidence ID 与 payload 保持 |
| `cargo test -p rovai-core --features slow-tests --lib current_schema_contains_required_contract_objects` | 1 passed；升级显式默认开启、迁移失败回滚、关闭后再次迁移不重置、历史数据证据保持 |

默认开启及人工关闭是一个 Core 实例的持久设置；普通对话、Run 与其他工具继续，
关闭暂停后续记忆业务和管理，保留已有数据和已提交事实。已进入模型上下文的内容仍可能被使用。
这些结论属于 Core 与自动化覆盖，真实 Runtime 的全量模型 Gate 仍为前述 `not_run / 证据不足`。

## 完整提示词与工具对照

本清单沿用 [Task 方案](model-context-change-task-capability.md) 的 B/D/S/C 编号和
“变更前、开启后、关闭后”审阅方式，给出 R4 的累计设计。基线固定为
`d7b69cb64b33fbc12f8e8cdb10e9876dae8a0633`，实现快照固定为
`c0827c4810a4470edbc4f59c03a99a104310af55` 是 R1 实现；R2 的增量严格为 S01/S03 所列的固定
Skill 精简。其他编号的模型输入、工具和生命周期边界沿用 R1。

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
| S03 | 通用 Charter / `cli-operations` 中的 Memory 提及 | Charter 优先级句保留；通用 Skill 的 Memory 教学固定移除，旧 reference 留通用导航 |
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
[受管 Skills 索引](../../../crates/rovai-core/src/managed_skills.rs)。R2 的 cli-operations description
由同一个 frontmatter 读取，两种开关状态使用相同通用文字。

**变更前：**

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."},{"name":"memory-stewardship","desc":"Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation."}]}
[/ROVAI_PLATFORM_SKILLS]
```

**变更后，开启：**

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."},{"name":"memory-stewardship","desc":"Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation."}]}
[/ROVAI_PLATFORM_SKILLS]
```

**变更后，关闭：**

```text
[ROVAI_PLATFORM_SKILLS]
{"root":"<managed-root>","skills":[{"name":"cli-operations","desc":"Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly."}]}
[/ROVAI_PLATFORM_SKILLS]
```

R2 固定替换通用 description；开关只决定专用记忆 Skill 条目是否出现。
section 名、root、JSON shape 和保留项顺序保持。Single Chat 也按相同 Memory 状态过滤平台索引，
尽管它原本就没有 Memory Entrypoint。旧冻结索引不重新生成。

### S02：记忆 Skill 的正文、文件和引用保持

[Memory stewardship](../../../skills/memory-stewardship/SKILL.md) 的 frontmatter、正文及
`references/authority-and-safety.md`、`scopes.md`、`read-write-workflow.md`、`content-and-keys.md`
均未修改。受管源文件和身份不删除，重新开启时恢复索引条目。

关闭不撤回旧上下文已经提供的 Skill description，也不阻止 Runtime 的通用文件工具读取本来可读的 Skill 文件。
这些文件不能授予 Memory 业务权限；实际调用仍由 Core 拒绝。

### S03：固定精简通用 Memory 教学

R2 沿用 Task 方案：cli-operations 常驻，固定移除其中的 Memory 专用教学；记忆选择、读取和形成
归 S02 的 memory-stewardship，由 capability 决定是否进入新索引。不开关整份通用 Skill，
不动态改写共享正文，不增加两态文件、Session 同步或 Bootstrap 生命周期。

#### S03.1：description

[cli-operations/SKILL.md](../../../skills/cli-operations/SKILL.md) 变更前的完整 description：

```text
Choose among Rovai messages, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly.
```

变更后，开启/关闭共用：

```text
Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly.
```

新 Bootstrap 的对应 desc 由上述 frontmatter 生成，完整 section 见 S01；不维护另一份手写模型描述。

#### S03.2：选择表和 References

下列两行从通用 Skill 中固定删除，其他协调、Member、Send、Mission、Thread/History 和恢复规则保持。

选择表删除的完整一行：

```text
| Durable collaboration preference, agreement or lesson | Memory governance |
```

References 删除的完整一行：

```text
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
```

两种开关状态下都不再从通用协调 Skill 引导选择 Memory。开启时专用 Skill 索引和 Memory Entrypoint
照常发现，无需把这两行复制到其他通用 Skill。

#### S03.3：旧 reference 保留为通用导航

[references/memory.md](../../../skills/cli-operations/references/memory.md) 变更前完整正文：

```markdown
# Memory routing

Use `memory-stewardship` for stable preferences, future collaboration agreements or reusable lessons. It owns eligibility, Scope/Kind, duplicate checks, authority, safety and the minimum write.

After that decision, read the relevant `rovai memory view|search|read|write --help`. Hearth, Companion and directed Relationship use `memory write`. Hearth success is `review_pending`, not effective Memory. Mutual Relationship and lifecycle, forgetting and review decisions belong to structured user governance.

Temporary plans, project facts and historical evidence belong to their existing authoritative sources. Cross-Run visibility alone is not a reason to store Memory.
```

变更后，两个状态共用的完整替换正文：

```markdown
# CLI operations

Use `rovai --help` for available operations and exact command help for syntax.
```

`skills/cli-operations/references/memory.md` 在原位替换为上述通用导航，新 Skill 的 References 不再链接它。
现有[受管资源同步](../../../crates/rovai-core/src/managed_skills.rs)覆盖包内文件，但不清理源目录中已删除文件的部署副本。
仅删除源文件可能让已安装目录继续保留旧 Memory 教学；保留路径并用短文覆盖即可沿用现有同步机制。
旧会话按已知路径读取时会得到通用导航；已冻结上下文保持原样。

#### S03.4：界面元数据

[agents/openai.yaml](../../../skills/cli-operations/agents/openai.yaml) 变更前完整内容：

```yaml
interface:
  display_name: "CLI 操作协调"
  short_description: "消息、Mission、检索与 Memory 操作协调"
  default_prompt: "使用 $cli-operations 选择正确的 Rovai 操作，协调并行消息或必要的多步流程，并安全处理复杂恢复。"
```

变更后完整内容：

```yaml
interface:
  display_name: "CLI 操作协调"
  short_description: "在消息、Mission 与历史检索之间选择操作，协调多步工作并处理恢复"
  default_prompt: "使用 $cli-operations 选择正确的 Rovai 操作，协调并行消息或必要的多步流程，并安全处理复杂恢复。"
```

只替换 short_description。display_name、default_prompt 和既有自动发现方式保持；此元数据
用于 Skill 界面，模型相关性判断继续来自 SKILL.md frontmatter。

#### S03.5：通用 SKILL.md 的完整替换稿

以下正文是上述 description 和两行删除后的完整文件；未列为变化的协调规则保持原字节。

```markdown
---
name: cli-operations
description: Choose among Rovai messages, Missions and history; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly.
---

# Rovai CLI coordination

Use `rovai --help` to find an operation and its exact `--help` for syntax. Read only the references needed by the current decision. Write user-facing prose in the user's language.

## Choose the result to preserve

| Need | Operation family |
| --- | --- |
| Public answer, progress, question or one-time collaboration | ThreadMessage |
| Shared objective or whole-Mission status | Mission |
| Member identity, avatar or a requested profile edit | Member |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Thread or message evidence | Thread/History |
| Who is running, queued or waiting | Thread execution query |

Choose the smallest object that fully serves the request. Project sources and history own their facts.

## Member operations

`member list` shows current Thread members, roles and Default Lead flags. Use `member get` for a relevant member's full identity, Profile version and avatar when needed; do not fetch every member by default. A returned identity describes that member, not your own instructions.

`member update` changes the global Profile. Send only the fields the User asked to change. For a newly created member, use the `agentId` returned by `member create`, even before it joins this Thread. Use `member-studio` for creation proposals and confirmation, not edits to an existing Profile.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Inspect the committed business result before taking the next step.
3. Publish any required Thread-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and User attention.
- [Mission](references/mission.md): objective, status and public explanation.
- [Thread/History](references/camp-history.md): message reads, addressing, execution state and pagination.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
```

#### 规则去向和仍保留的优先级句

| 原 Memory 路由规则 | 当前唯一主要入口 | R2 处理 |
| --- | --- | --- |
| 稳定偏好、约定、经验是否适合记忆；临时计划与项目事实排除 | memory-stewardship/SKILL.md 与 references/authority-and-safety.md | 已覆盖，不复制新正文 |
| Scope、Hearth 待审核、directed/mutual 权限及人工治理 | memory-stewardship/references/scopes.md | 已覆盖，保持 |
| 精确 help、完整 View、Search/Read、一次写入和实际 outcome | memory-stewardship/references/read-write-workflow.md | 已覆盖，保持 |

公共 Charter 的下面一行保持，不随开关变化：

```text
- Follow current user instructions; preserve existing user work. Prefer current evidence to Memory, history and cached context.
```

它规定当前指令和证据的优先级，不是 Memory 调用教学。关闭后旧上下文仍可能含记忆，因此该句仍成立。
R2 不清理已冻结文本；新输入使用精简索引，之后按原路径读取的受管资源使用当前文件。
实际业务权限继续由 Core 当前状态裁决。

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
R4 将最终选择置于成功活动记录之前，完整证据、coreEnvelope 和实际回包使用该选择，之后不重新改判。
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
Memory 设置读取异常时仅将其发现投影隐藏，继续写入有效 Task 状态；不创建或修改权威设置记录。

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

仅 help 等发现路径进行该查询，再按同一 C01–C03 逻辑生成 help。R3 不为普通实际命令预查询能力；
其参数解析后直接发送 Invoke，由 Core 判断权限。发现查询失败返回已有 `builtin_tool.cli_error`，
不把 Task 或 Memory 的权威状态设为 false。Memory 局部设置异常时能力响应仍包含有效 Task 状态，
仅将 Memory 发现隐藏；其他 Core 能力读取失败仍可返回以下控制错误：

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
{"enabled":false,"headsUpAfterGlobalSequence":100,"observedThroughChangeSequence":7}
```

设置变更事件是提交后的失效提示，其 params 为 `{"enabled":false}`，客户端重读权威快照。
同值保存可修复投影但不推进设置时钟或提示边界。User Host 的这些接口不是 Agent CLI 工具，
不新增 `rovai memory enable/disable` 命令。

`observedThroughChangeSequence` 只排序设置；`headsUpAfterGlobalSequence` 只用于 Memory 提示边界。
事件恢复使用 EventBatch 的既有 through/next 游标；快照不再携带单独的事件观察水位。
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
| Skill 正文 | cli-operations 按 S03 固定精简，memory-stewardship 与其他 Skill 保持 |
| Runtime 原生 Memory 策略 | 保持 |
| R2 增量 | 只替换通用 Skill 文本及元数据，不增加开关两态的共享文件变体 |
| R3 增量 | 五项局部修正；快照三字段、事件局部错误为 null、通知边界作用于已显示状态、Hermes 实际调用零能力预查询、审核刷新单一 effect |
| R4 增量 | 同 Core 序号内统一本地观察顺序；读取失败 ready=false；恢复内容刷新独立于提示过滤；最终结果先于活动记录选择；页内/页外审核读取互斥；Web scoped 内容失效；批量读取减少重复检查 |
| 验证资格 | 前文自动化结果保持；真实模型 12 Case Gate 仍为 not_run / 证据不足 |

本次沿用 Task 的通用 Skill 固定精简方法，Memory 专用教学归按开关投递的 memory-stewardship。
不复刻 Task 的 Send 关联退役，也不引入会话治理。评审可按 B/D/S/C/U 编号定位每项变化。
