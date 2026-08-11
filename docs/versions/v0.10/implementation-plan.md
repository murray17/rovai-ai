---
document_type: implementation-plan
version: v0.10
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-25
---

# Lumen AI v0.10 实施计划与验收清单

> 状态：产品实现完成（检查点 6/6）
>
> 版本范围：[README.md](README.md)
>
> 架构协议：[architecture.md](architecture.md)

## 当前实现基线

本计划已经对照当前仓库，而不是只根据设计文档拆分：

- SQLite Memory Migration v21 已实现于 `crates/rovai-core/src/db.rs`，同时覆盖
  全新数据库和 v20 升级路径。
- 所有权威写入复用 `command.rs` 的 `DomainCommandGateway`、expected version、
  幂等 `command.result` 和脱敏 `event_log`。
- Agent Tool 复用 `team_tool.rs`、Native Binding credential、当前 AgentRun /
  Execution Epoch fencing，以及 `main.rs` 中的本机 MCP Server。
- live Memory Projection 新建独立 `memory_projection.rs`，复用 Skill/MCP
  Projection 已有的私有目录、原子发布、启动恢复和稳定 reconciliation 模式，
  但不把 Memory 放进项目目录。
- `[MEMORY_GUIDE]` 和暴露摘要扩展 `context.rs`、`read_model.rs` 与现有
  ContextManifest；正文不进入冻结 prompt。
- Bundled `memory-stewardship` 复用 `skill.rs` 现有不可变 SkillRevision 和
  Runtime 原生 SkillProjection。
- Renderer 合约继续集中在 `packages/contracts/src/index.ts`，Core Method
  Allowlist、Electron Main/Preload 和 React 管理面分别沿用现有窄边界。

## 实施原则

- 分为六个可独立验证的检查点；每个检查点完成代码、测试和文档状态更新后形成
  独立 Commit。
- 顺序固定为：SQLite/领域不变量 → 用户治理 → Agent Proposal Tool →
  live Projection/Guide/Skill → Renderer/导出 → 真实 Runtime 与完整验收。
- v0.10 不读取 Conversation、CampMessage、Task、Git 或历史 AgentRun 推断初始
  Memory；Migration 后 Memory Library 为空。
- 所有正式写入和 Proposal 状态变化都经过 `DomainCommandGateway`。Renderer、
  Markdown、Skill 和 Agent Tool 都不能直接写表。
- Projection 是 best-effort Read Side；发布失败不回滚已提交 SQLite 命令，但必须
  fail closed、显示诊断并稳定重试。
- 永久 command result、event、receipt、diagnostic 和遥测只保存 ID、状态、计数、
  digest 或稳定错误码，不复制 Memory/Proposal 正文。
- 以下物理路径、API 名称、错误码和导出格式是已确认架构内的实施默认值；若编码时
  发现会改变领域边界、用户权限或 Forget 保证的冲突，先暂停并返回架构讨论。

## 实施协议默认值

### Migration v21

Migration v21 一次性增加：

| 表/列 | 职责 |
|---|---|
| `memory` | 稳定 ID、不可变 Scope/Kind/Direction、Lifecycle、current Revision、Review、version |
| `memory_revision` | 不可变的 canonical body、创建时间和可选 Proposal 来源 |
| `memory_proposal` | add/revise 候选、三态状态、base、最小提案者与 Run 来源 |
| `memory_supersession` | 不可变 predecessor → successor 边 |
| `memory_projection_observation` | 逻辑路径、formatter、digest、健康与无正文诊断 |
| `context_manifest.memory_guide_json` | Guide 路径、状态、formatter 和物化时 digest |
| `context_manifest.memory_guide_digest` | 上述 snapshot 的 canonical digest |

具体约束：

- `memory` 的 active/retired 行必须具有完整且互斥的 Scope 形状：
  - Hearth 不带 Agent 字段；
  - Companion 只带一个 AgentProfile；
  - Relationship 保存按稳定 ID 排序的无序 pair、Direction 和可选 directed actor。
- Relationship 只能使用 Agreement/Lesson；Kind、Scope 与 Direction 创建后只读。
- Forgotten 行清空 Scope、Kind、Direction、current Revision、Review 和正文相关
  元数据，只保留最小 tombstone；所有 Projection/导出查询显式排除。
- `memory_revision.body` 只有 Forget 可以从非空变为 `NULL`；同一 Revision 不允许
  发布第二份正文。正文 byte count/digest 在 Forget 时一起清除。
- `memory_proposal` 使用 nullable 的结构化候选列，不保存一个候选 JSON 聚合。
  Rejected 与关联 Memory Forgotten 时清除可恢复候选字段。
- pending 精确候选使用 Core 计算的 canonical key digest 和 partial unique index；
  转入 terminal 状态时清除该 pending key。
- Proposal 来源 Camp/Run/Epoch 是弱 ID，不配置级联所有权 FK；Projection
  Observation 是可级联清理的派生状态。
- Supersession 使用复合唯一边和服务层循环检查；删除或改写旧边不进入命令面。
- active capacity 查询和每 Run 四条 Proposal quota 都在同一个 SQLite immediate
  transaction 内完成。
- 现有 AgentProfile 默认 Capability 增加 `memory.propose_change`；新 Profile
  创建 UI 默认勾选，用户移除后不被启动流程重新补回。CampMember override 的合法
  Capability 集合同时加入该值。
- ID 延续仓库现有 UUID v4 表达，不从正文、Scope 或文件路径派生。

### Core 方法与命令

用户管理面使用以下窄 Core Method：

```text
memory.list
memory.get
memory.create
memory.revise
memory.retire
memory.reactivate
memory.forget
memory.supersede
memory.review.schedule
memory.proposals.list
memory.proposals.accept
memory.proposals.reject
memory.proposals.rejectBatch
memory.projections.listIssues
memory.reconcile
memory.export
campMembers.memoryProposal.set
```

- v0.10 Read Side 返回受各 Scope 硬容量约束的完整 Library 与 Proposal 队列，
  Renderer 在本地按 Scope、Lifecycle、review due 和 Proposal 状态分类；不依赖
  FTS、语义检索或 Agent 搜索入口。
- 用户 create/revise 直接产生正式 Memory/Revision，不经过 Proposal。
- add Proposal 的“编辑后接受”提交完整最终候选，可修改正文、Scope、Kind 和
  Direction；revise Proposal 只能提交完整最终正文，不能改变 Memory 身份字段。
- Proposal accept 始终逐条执行；`rejectBatch` 是一个全有或全无的用户命令，
  每个条目携带 expected version。
- `memory.supersede` 支持“引用已有 successor”或“在同一事务创建 successor”，
  并原子 retire 一个或多个 predecessor、创建边和按最终 active 集合校验容量。
- Review 命令只设置或清除 `reviewAfter`。未显式指定时，新建/修订 Lesson 使用
  Revision `createdAt + 90 days`，其他 Kind 默认 `NULL`。
- Forget 是独立的高风险用户命令；确认后的事务同步清除全部 Revision body、
  accepted Proposal candidate 和候选结构，只留下允许的 tombstone/audit facts。

### 稳定错误族

预期领域失败返回稳定 code，不通过异常文本表达：

```text
memory.invalid_input
memory.not_found
memory.version_conflict
memory.revision_conflict
memory.proposal_stale
memory.lifecycle_conflict
memory.scope_forbidden
memory.direction_forbidden
memory.capability_denied
memory.run_not_current
memory.run_quota_exhausted
memory.capacity_exceeded
memory.already_exists
memory.no_change
memory.duplicate_pending
memory.secret_rejected
memory.supersession_cycle
memory.projection_unavailable
```

错误 payload 只带必要 ID、当前 version、上限或状态，不回显正文、Secret 命中位置
或相似片段。Tool 层将这些 code 映射为 MCP error；内部 I/O/SQLite 失败统一为无
正文的 internal error。

### Projection v1 物理协议

私有根固定为：

```text
<data_dir>/memory/projections/v1/
├── hearth/current.md
├── companions/<agent-profile-id>/current.md
└── camps/<camp-id>/agents/<agent-profile-id>/relationships/current/
    ├── <counterparty-agent-profile-id>.md
    └── ...
```

- Guide 对 Agent A 只列 Hearth 文件、Companion(A) 文件和
  Relationship(C, A) 的 `current/` 目录，不列子文件。
- Relationship 的 `current` 是指向不可变 staging generation 的原子替换入口；
  这样整份 `(Camp, Agent)` 目录可以一次切换。generation 不是 per-Run snapshot，
  切换后立即清理非 current 副本。
- 子文件只包含 mutual(A, B) 与 directed(A → B)。不生成 B → A、Camp 外 pair 或
  complete-pair 文件。
- 文件与目录分别使用 `0600`/`0700`；不写项目、Git、Runtime 用户配置或
  `~/.lumen/skills`。
- Formatter v1 不写 `generatedAt` 等非确定值。条目按 Kind 固定顺序后
  `memoryId` 排序，正文作为字面缩进块渲染，不能逃逸到 ID/Kind/Direction 结构。
- 单文件发布前计算完整 UTF-8 bytes 和 SHA-256；超过 256 KiB 不截断、不分页。
  Relationship directory digest 基于排序后的相对子路径与文件 digest，不把子文件
  清单写入 Guide。
- 单文件失败时在原路径原子写入无正文 `UNAVAILABLE`；Relationship 失败时把
  `current` 切换到只含 `UNAVAILABLE.md` 的 generation，不能保留 last-good 子文件。
- 缺失、外部修改、digest 不符、版本过旧和 Observation 丢失都由 SQLite 重建。
  启动、权威状态变化、AgentRun 物化前与用户显式命令触发 reconciliation。

### Memory Guide v1

`[MEMORY_GUIDE]` 最多 8 KiB，只包含：

- 长期记忆的用途、建议读取时机和低于当前输入/任务/权限/仓库状态的优先级；
- 三个授权文件或目录路径及其 Ready/Empty/Unavailable 状态；
- live read 说明：路径内容可能在当前 Run 中更新；
- 不得依赖 unavailable Scope、不得直接编辑文件、Proposal receipt 不代表生效。

ContextManifest 保存 Guide 原文 digest、Guide schema/formatter version、三个逻辑
路径和物化时观察到的文件/目录 digest；不保存正文、Relationship 子文件列表，也
不声称 Runtime 已经读取。

### Export v1

- v0.10 只生成一个 UTF-8 JSON 文件，format 为
  `lumen-memory-export-v1`，默认文件权限 `0600`。
- 内容包括 active/retired Memory、完整非遗忘 Revision 历史和仍可解释的
  Supersession 边；不包括 pending/rejected Proposal、Agent Projection、
  command/event、Secret diagnostics 或 forgotten tombstone。
- 导出直接查询 SQLite，并在保存 Dialog 前展示“外部副本不再受 Forget 控制”的
  明确确认。v0.10 不实现 import/restore。

## 检查点 1：Memory Store、领域类型与不变量

> 实施状态：已完成。

目标：先建立唯一真相源和所有写入路径共同使用的领域内核。

实施内容：

- 增加 Migration v21、表/索引/CHECK、ContextManifest 默认列和 Agent Capability
  数据迁移；全新与 v20 升级路径使用同一结果。
- 新增 `memory.rs`，定义 Scope、Kind、Direction、Lifecycle、Revision、Proposal、
  Supersession 与 typed command。
- 新增 `memory_secret.rs`，实现高置信凭据规则；校验只返回稳定 code，不返回命中
  内容。首版覆盖 PEM 私钥、Authorization credential、常见 Token 前缀和明确的
  password/token/secret 赋值形态。
- 实现统一 canonicalization：CRLF/CR → LF、trim 外层空白、拒绝非法 C0、
  非空、最终 UTF-8 ≤ 2,048 bytes。
- 实现 active Scope count/byte capacity、exact no-op、pending key、Revision CAS、
  Proposal stale 派生、Review 默认值、Lifecycle 和 Supersession 图不变量。
- 确保 canonicalization 在构造 DomainCommand 前完成，使 request digest、精确比较、
  持久正文与 Projection 使用同一 bytes。
- Memory event helper 只写 ID、状态、version、Scope 类别和计数；不得写正文或候选。

必须测试：

- v20 → v21、全新数据库、重复启动、foreign-key check 和失败回滚。
- 三种 Scope 的互斥形状、Relationship Kind/Direction、无序 pair 规范化。
- CRLF、TAB、控制字符、Unicode 保留、2,048-byte 边界和空正文。
- Secret 正例/安全占位符/误报边界；失败后的 DB、event 和 diagnostic 无明文。
- 三组 active count/byte 上限及 retire/reactivate/supersede 最终集合。
- Revision 不可变、Scope/Kind/Direction 不可变、Review 不自动改变 Lifecycle。
- Forget 清除所有可读正文、digest 和候选字段，且不能恢复。

完成门：

- SQLite 是唯一 Memory 真源，没有 Markdown 解析或 JSON aggregate 写路径。
- 所有正文写入入口只能调用同一 canonicalization/Secret/容量内核。
- Migration 不从历史内容创建任何 Memory。
- `cargo fmt --check`、定向 Rust 测试和 `cargo test --workspace` 通过。

## 检查点 2：用户治理、Proposal 状态机与 Read Side

> 实施状态：已完成。

目标：完成用户对完整 Memory Library 的直接治理和可审计 Proposal 队列。

实施内容：

- 实现 create/revise/retire/reactivate/forget/review/supersede 用户命令及 expected
  version、幂等结果和最小事件。
- 实现 add/revise Proposal 内部保存服务、每 Run quota、pending exact unique、
  submission-time base 校验和后来 stale 派生；此检查点暂不暴露 MCP Tool。
- 实现逐条 accept、编辑后 accept、reject 和原子 batch reject。
- Accepted Proposal 保留原候选并链接最终 Revision；Rejected 同事务清除候选；
  linked Memory Forget 同事务清除 accepted candidate。
- Read Side 返回完整用户 pair（mutual、A→B、B→A）、Revision 历史、Supersession、
  capacity、review due、Proposal stale 与 sourceUnavailable。
- Proposal 来源跳转只在弱 ID 当前可解析时返回；来源不可用不阻塞接受/拒绝。
- 扩展 Core request dispatch、TypeScript contracts 与 Main Allowlist；所有预期冲突
  返回 StoredCommandResult，不用 Renderer 猜状态。
- Projection wake 先留出统一 hook；此检查点只记录“需要重建”，不发布文件。

必须测试：

- 用户直接 create/revise 不生成 Proposal；Agent 候选未接受不生成 Memory。
- add/revise accept、编辑 Scope/正文后 accept、重复 commandId、并发 accept。
- stale Proposal 禁止 accept/edit/rebase，只允许 reject 或创建新候选。
- pending 永不过期；ignore 无命令；rejected 无正文；accepted 审计可对照。
- Profile disabled/archived 不改变 Memory/Proposal；reactivate Profile 不创建 Revision。
- retire 可恢复，outgoing Supersession predecessor 不可恢复，forgotten 永不可恢复。
- merge 型 Supersession、existing/new successor、容量原子释放、循环拒绝。
- Camp/Run 删除后的 sourceUnavailable 与 Proposal 保留。
- 用户 complete-pair 可见性与管理页本地分类。

完成门：

- 用户能够通过 Core API 治理全部三类 Scope，且没有任何 Agent 权威写入路径。
- Proposal 状态只有 pending/accepted/rejected；stale 和 sourceUnavailable 都是派生。
- Forget、Revision CAS、容量和 Supersession 在并发下保持单事务不变量。
- Rust、contracts typecheck 和 Core request 集成测试通过。

## 检查点 3：`memory.propose_change`、Capability 与 Native Binding

> 实施状态：已完成。

目标：让受 fenced AgentRun 约束的 Agent 只能保存非权威 add/revise Proposal。

实施内容：

- 新增 `memory_tool.rs`，复用 Team Tool Binding credential、Runtime tool-call ID、
  current AgentRun/Epoch 和 DomainCommandGateway。
- 在本机 MCP Server 注册唯一 Memory Tool `memory.propose_change`；不增加
  `memory.search`。
- Tool schema 使用一个 `additionalProperties: false` 的扁平 object，不在根使用
  `oneOf/anyOf`：
  - add：`action/scope/kind/body`，Relationship 才允许
    `counterpartyAgentId/direction`；
  - revise：`action/memoryId/baseRevisionId/body`。
- Gateway 推导 proposer、Camp、Run、Epoch、Companion target 和 directed actor；
  忽略模型声称的身份是不允许的，额外字段直接失败。
- 校验 effective config 含 `memory.propose_change`，并重新验证 Native Binding、
  Run fencing、当前 CampMember、counterparty 和 A 的 Projection 适用性。
- 四条 quota、tool-call 幂等、no-op、duplicate pending 和 base conflict 与 Proposal
  INSERT 在同一事务。
- 成功只返回固定 Memory Proposal Receipt：

  ```json
  {
    "lumenTeamTool": "memory.propose_change",
    "lumenTeamReceipt": "Proposal saved; awaiting user confirmation.",
    "proposalId": "...",
    "status": "pending",
    "effective": false
  }
  ```

- Profile 管理面已有 `defaultCapabilities` 继续作为默认层；新增窄 CampMember
  override 命令。两者只影响后来物化的 AgentRun。
- 保存 Proposal 后追加只含 `proposalId` 的 Camp-scoped event，Renderer 通过 Read
  Side 取详情；Tool 不阻塞或唤醒新的 AgentRun。

必须测试：

- A 只能提议 Hearth、Companion(A)、Relationship(A,B current member)。
- directed 只允许 A→B；B→A、Camp 外成员、其他 Companion、猜测 Memory ID 全拒绝。
- revise 只能针对 A 当前可读的 active Revision，Scope/Kind/Direction 不能改变。
- Capability allow/deny、Profile/Camp override、当前 Run 冻结和未来 Run 生效。
- 同 Run 并发第五条、失败不计数、terminal 不返还、幂等 replay 不重复计数。
- exact no-op、different-call duplicate pending、tool-call idempotency conflict。
- Receipt、MCP error、event 和日志没有正文；成功也不返回 Memory/Revision ID。
- Codex/Claude/OpenCode/Copilot 的 Tool schema Translator 保留所有字段；Tool List
  明确没有 `memory.search`。

完成门：

- Agent 永远只能创建 `effective=false` 的 Proposal。
- 模型参数不能伪造身份、来源、actor、时间或 idempotency key。
- 当前 Run 的 Capability 与 Native Binding fencing 在 Core 中强制，而非依赖 Skill。
- Team Task/A2A Tool 的现有发现、调用与恢复测试不回归。

## 检查点 4：live Projection、Memory Guide 与 Stewardship Skill

> 实施状态：已完成。

目标：让 Agent 用 Runtime 原生文件工具按需读取适用 Memory，不把正文预注入。

实施内容：

- 新增 `memory_projection.rs`，实现 Projection v1 路径、Formatter、digest、
  Observation、原子文件/目录 generation 和 stable reconciliation。
- 启动扫描、Memory 权威写入、Profile/Camp 状态变化及 AgentRun 物化前触发重建；
  文件缺失、篡改、版本过旧或 Observation 丢失直接从 SQLite 恢复，用户也可显式
  Reconcile。
- Hearth/Companion 只投影 active current Revision；inactive Profile 不保留自己的
  Companion 或 Relationship 入口。
- Relationship 按 `(Camp C, perspective Agent A)` 生成目录，只包含 C 的其他当前
  active member，并按 mutual + A→B 过滤。
- 实现 256 KiB file guard、无正文 UNAVAILABLE sentinel、总文件系统失败诊断和重试；
  SQLite 命令从不因 projector 失败回滚。
- Memory Guide 只提供路径和说明，Agent 使用各 Runtime 已有的普通文件读取工具；
  读取工具不可用时不回退为正文注入。
- `context.rs` 生成独立的低优先级 `[MEMORY_GUIDE]`；ContextManifest 冻结 Guide 与
  digest，不冻结 body/子文件。Camp Snapshot/Context Inspector schema 升级为 v7。
- 新增 `resources/skills/memory-stewardship/` 并加入 Bundled Skill 安装：
  - 首次默认启用；
  - 升级创建不可变 Revision且保留用户启停；
  - 项目同名内容按现有 shadow 规则优先；
  - 不授予 Capability，不承担 Core 校验。
- Skill 明确指导“判断长期价值 → 读当前路径 → 避免重复 → 选 Scope/Kind/Direction
  → 去 Secret/原子化 → 提交 Proposal → 解释 pending receipt”。

必须测试：

- Projection 路径、权限、排序、escaping、digest 和相同 SQLite 状态的 byte-for-byte
  重建。
- A 文件只有 mutual + A→B；B 文件只有 mutual + B→A；无 complete-pair。
- 同一 A 在不同 Camp 得到不同成员目录；Guide 仍只有一个目录根。
- revise/retire/reactivate/supersede/forget 后当前路径 live 更新；旧 Run prompt
  不重写。
- 丢失、外部编辑、污染 Markdown、Observation 丢失、Core 重启和并发 reconcile。
- 超限、render/rename/permission/disk 失败先 fail closed；不提供 partial/last-good。
- ContextManifest 只有路径、版本、digest；prompt 与 Managed Blob 不含 Memory body。
- Guide 小于 8 KiB、优先级说明稳定、Relationship 子文件不随成员数进入 prompt。
- Bundled 首装/升级/禁用、项目 shadow、Runtime unsupported 与不阻塞 Run。

完成门：

- SQLite 与 Projection hash 可对账，Markdown 永远不能反向写入。
- Agent 只得到三个授权位置，没有正文注入、per-Run Memory copy 或搜索工具。
- 同一 Run 后续文件读取可以看到新投影，恢复仍复用原 ContextManifest。
- 现有 Skill、Context、MCP、Native Session 和 Recovery 测试不回归。

## 检查点 5：Memory Library UI、会话提示与导出

> 实施状态：已完成。

目标：提供用户可理解、可审计且不会诱导批量学习的完整治理体验。

实施内容：

- 左侧全局导航新增一级“记忆”，显示 pending 数量；Memory 是应用级页面，不嵌入
  某个 Project/Camp 的所有权层级。
- 新增 `MemoryLibrary.tsx` 与定向测试，页面包含：
  - 待确认；
  - 家园记忆；
  - 伙伴记忆；
  - 协作默契；
  - 建议复核；
  - retired/history 过滤。
- 列表显示 Scope、Kind、Direction、Lifecycle、Review、当前 Revision、容量和
  Supersession；Relationship 用户视图展示完整 pair 的两个 directed 方向。
- 用户可直接新增/修订、retire、reactivate、supersede、forget 和 reschedule。
  Forget 使用独立危险确认，明确“从长期记忆中遗忘”与外部副本边界。
- Proposal 审阅 Dialog 同时展示完整正文、Scope、Kind、Direction、提案 Agent、
  时间与来源可用性；支持接受、编辑后接受、拒绝和批量拒绝，不提供批量接受。
- stale Proposal 禁用接受/编辑并解释原因；ignore 只关闭当前 Camp 提示。
- 当前 Camp 收到 `memory.proposal_saved` event 后显示非阻塞提示卡；关闭不写状态，
  管理页仍保留。
- AgentProfile 表单加入“允许提出共同记忆”开关；Camp 当前成员设置加入同名 override，
  文案明确只影响未来 AgentRun。
- 投影诊断显示 Ready/Empty/Unavailable/write failed、路径、formatter 和 digest，
  提供显式 Reconcile；不显示正文。
- Electron Main 增加窄 `exportMemory()` Save Dialog，Core 生成 Export v1，Main 以
  `0600` 原子写入；Renderer 不获得任意文件系统写权限。
- Diagnostics export 只增加 Memory count/projection health，不包含 Memory 或
  Proposal body。
- 全部遵守当时现行的 Hearth & Camp UI 规范（后续 Meridian 文件也已删除，原文见
  Git 历史）：Day/Night 功能等价、状态不只靠
  颜色、可见 Label、最安全动作初始聚焦、Dialog 焦点返回、最小窗口无整页横向滚动。

必须测试：

- Loading/Empty/Error/Busy、本地分类、capacity full、review due。
- 用户 direct create/revise 与 Proposal accept 后只在 Core 成功后刷新，不做乐观
  伪生效。
- accept as-is、编辑 Scope/正文后 accept、stale disable、single accept 和 batch
  reject。
- session ignore 后管理页仍 pending；Core 重启后 badge/队列恢复。
- retire/reactivate/superseded predecessor/forget 的动作可用性与确认文案。
- Profile/Camp Capability toggle 的 expected version、冲突和 future-Run 提示。
- source available/unavailable、完整 pair、A→B/B→A 标签不混淆。
- Export 取消、确认、写入失败、文件权限、forgotten/Proposal 排除和外部副本警告。
- Day/Night × `1440×920` / `1040×700`，键盘与 Screen Reader 基本语义。

完成门：

- 用户可以从一个应用级页面完成所有 Memory 治理与 Proposal 处理。
- UI 不把 pending、Skill enabled、Projection ready 或 Tool success 描述成已学习。
- Renderer 没有 SQLite、任意路径、Shell 或原始 `ipcRenderer` 权限。
- `pnpm typecheck`、`pnpm test` 与 `pnpm build:desktop` 通过。

## 检查点 6：Runtime 边界、恢复、安全与最终验收

> 实施状态：已完成。

目标：证明 Memory 在 Native Runtime 边界、重启和文件污染下满足已确认边界。

实施内容：

- 新增 `scripts/smoke-memory.mjs` 与 `pnpm smoke:memory`，使用隔离 Data Dir 和
  临时 Projection，不读取日常 Lumen Memory，也不调用模型。
- Core-only Smoke 覆盖：
  - Migration/重启；
  - 用户 direct write；
  - 幂等、Secret 拒绝；
  - revision/lifecycle/supersession/forget/export；
  - Projection 污染、权限、恢复和无正文诊断。
- Native Binding、current Run/Epoch、Capability、pending receipt、四条 quota、
  用户接受与 A→B 方向由 Rust 集成测试确定性覆盖；本机 MCP Tool List 测试同时
  证明不存在 `memory.search`。需要第三方账户的 Codex、Claude Code、OpenCode 与
  Copilot 真实调用保留为环境相关手工验证。
- ContextManifest 测试证明 Guide 只冻结路径/digest 而不冻结正文；Projection
  测试覆盖外部污染、Observation 丢失、Relationship 视角过滤和 fail-closed
  `current` 目录替换。
- 执行全量 Rust/TypeScript/Vitest/隔离 Smoke/Build/macOS Package，删除实验 API、
  临时 fallback、调试正文和未使用样式。
- 更新根 README、local development、v0.10 状态、检查点实施记录和真实版本证据。

完成门：

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:core`
- `pnpm smoke:memory`
- `pnpm build`
- `pnpm package:mac`
- `pnpm accept:memory-ui`
- `codesign --verify --deep --strict "dist/mac-arm64/Lumen AI.app"`

现有 Agent/Profile、Camp、Task、Action/Approval、A2A、Context、Skill、MCP 和
Recovery 的 Rust/Vitest 回归必须保持通过。真实 Runtime 不可用时只记录可复现
环境证据，不伪报成功。

## 最终验收矩阵

| 场景 | 预期 |
|---|---|
| 首次升级 v20 → v21 | Memory Library 为空；历史聊天不被推断为 Memory |
| 用户直接新增 | 同事务创建 Memory + 首个 Revision，无 Proposal |
| Agent add/revise | 只保存 pending Proposal，Receipt `effective=false` |
| 用户接受 | 逐条创建/修订正式 Memory；原 Proposal 可审计 |
| 用户编辑后接受 | 最终值重新经过 canonicalization、Secret、容量和 CAS |
| stale revise | 不能接受、编辑或原地 rebase，只能拒绝/新提案 |
| 每 Run 第五条 | 明确 quota error；terminal 不返还名额 |
| 精确重复 | no-op/duplicate pending 均不插入、不占 quota |
| Secret | 所有入口 fail closed，日志、错误、导出和诊断无片段 |
| Hearth/Companion | A 只读全局 Hearth 和 Companion(A) |
| Relationship A/B | A 只读 mutual+A→B，B 只读 mutual+B→A |
| 多 Camp | Relationship 目录按 `(Camp, Agent)` 过滤，Guide 大小固定 |
| live 更新 | 当前 Run 后续文件读取可看到新投影，prompt 不被重写 |
| Projection 污染 | 从 SQLite 重建；Markdown 外部修改不写回 |
| Projection 失败 | body-free UNAVAILABLE；不截断、不留 last-good |
| retire/reactivate | 普通 retired 可恢复；superseded predecessor 不可恢复 |
| supersede | predecessor retire、successor/边和容量校验原子提交 |
| forget | Library/Projection/导出无正文，只剩最小 tombstone |
| Profile inactive | 不级联 Memory/Proposal；不生成自身 active 投影 |
| Proposal 来源消失 | 显示 unavailable，仍可接受或拒绝 |
| Stewardship Skill | 单一 Bundled Skill；项目同名优先；不授予 Capability |
| Capability revoke | 只影响未来 Run；用户管理不受影响 |
| 导出 | SQLite 生成 Export v1；无 forgotten/Proposal；警告外部副本 |
| App 重启 | SQLite、Proposal、Guide/Projection 健康和 UI 状态一致恢复 |

## 明确不在 v0.10

- `memory.search`、embedding、语义召回或 FTS；
- 通用 Fact、人格标签、能力评分、观察档案、任务状态或游戏化成长；
- Agent retire/reactivate/forget/supersede；
- 自动接受、批量接受、TTL、自动淘汰、自动复核或自动失效；
- Memory import/restore、自动备份、云同步或 Memory 专用加密；
- per-Run Memory 正文副本、完整 pair Markdown、项目/Git 中的 Memory；
- CampMember leave/remove 后的 Relationship Projection 新协议；
- 对 OS 快照、Runtime 历史、用户导出或同系统用户进程的全局擦除/隔离承诺。

## 实施记录

用户已明确授权完成编码，六个检查点的产品代码已落地。模型无关的验收由 Rust
单元/集成测试、TypeScript/Vitest、`smoke:memory`、Desktop Build 与 macOS
Package 覆盖；会调用第三方模型账户的多 Runtime Smoke 仍按
[测试与 Smoke Test](../../development/testing.md) 作为环境相关手工证据执行，不用缺失的
外部账户伪造成功。

2026-07-25 完成证据：

- `cargo fmt --all` 与 `cargo clippy --workspace --all-targets -- -D warnings` 通过；
- `cargo test --workspace`：lib 142/142，main 33/33；4 个真实 Runtime 手工用例按
  既有标记 ignored；
- `pnpm typecheck`、Vitest 45/45 与 `pnpm build:desktop` 通过；
- `pnpm smoke:core` 与 `pnpm smoke:memory` 通过；
- `memory-stewardship` 通过 Skill validator；
- `pnpm package:mac` 生成 `dist/mac-arm64/Lumen AI.app`，并通过
  `codesign --verify --deep --strict`；
- `pnpm accept:memory-ui` 通过真实打包 App 完成 direct create、revise、
  retire/reactivate、forget、Projection 污染恢复与冷重启，并以白昼和紧凑夜间
  截图人工确认布局；验收中发现并修复侧栏“记忆”标签换行回归。
