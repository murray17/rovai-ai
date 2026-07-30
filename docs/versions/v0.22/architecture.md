---
document_type: version-architecture
version: v0.22
lifecycle: historical
authority: version-design
last_updated: 2026-07-29
---

# Rovai-ai v0.22 架构设计

> 状态：架构已冻结；实现状态以实施计划和代码证据为准
>
> 版本范围：[README.md](README.md)
>
> 当前决策：
> [ADR-0071](../../adr/0071-configured-camp-creation-and-lazy-conversations.md)
>
> 继续适用：
> [ADR-0001](../../adr/0001-core-transaction.md) ·
> [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md) ·
> [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md) ·
> [ADR-0059](../../adr/0059-runtime-owned-resource-permissions.md) ·
> [ADR-0060](../../adr/0060-opaque-member-routing-identity.md) ·
> [ADR-0066](../../adr/0066-managed-product-runtime-resolution.md) ·
> [ADR-0067](../../adr/0067-native-session-bootstrap-and-agentrun-context-v3.md)

## 1. 当前实现基线与冲突

合并 v0.21 后的实现仍采用 ADR-0058 的旧创建边界：

| 事实面 | 当前实现 | v0.22 目标 |
|---|---|---|
| Camp 创建时机 | `camps.createFromFirstMessage` 在首条消息准入后创建 | `camps.create` 在用户点击「创建」后立即创建 |
| 初始成员 | Core 自动快照全部 `present` Profile | 用户提交非空精确集合，Core 原子复核 |
| 初始 Lead | 第一位完整配置 Runtime 的成员；无人配置则失败 | 用户选择；UI 推荐第一位 Ready，否则第一位 |
| Runtime | 创建前执行 Resolution/Readiness 准入 | 创建完全不读取 Runtime 准入 |
| Conversation | 为全部初始成员预建 | 只为已准入执行的精确目标按需创建 |
| 后续加成员 | `add_camp_member` 立即创建 Conversation | 只更新 CampMember |
| 名称 | 首条消息全文规范化，未限制长度/来源 | 创建可选；持久来源；首条接受时最多 80 scalar 自动生成 |
| 新对话 UI | 全屏 Lobby composer，发送后才有 Camp | 760px 配置 Dialog，创建后进入空 Camp composer |

现行 `resolve_address` 和 `active_address_target` 通过 `INNER JOIN conversation` 判断成员是否
可寻址，因此无法表示“有效 CampMember 尚无 Conversation”。v0.22 必须先按 CampMember
与 Presence 解析身份目标，再在最终执行事务中创建或复用 Conversation。

现行 `camp` 表只有 `title`，没有 `name_origin` 或 `collaboration_mode`。现行 Read Side
虽可读取零消息 Camp，但大部分测试辅助函数通过“建 Camp→加成员”而间接依赖 eager
Conversation，需要一起改写不变量和断言。

## 2. 领域与事务边界

### 2.1 创建前

`New Conversation Draft` 只存在于 Renderer：

```text
NewConversationDraft
├── projectSelection: lobby | known binding | verified local Git worktree
├── selectedMemberIds: non-empty present set
├── defaultLeadAgentProfileId: member of selected set
├── collaborationMode: peer
└── optionalName
```

打开或编辑 Draft 不写数据库。系统文件选择器和 `repositories.inspect` 只产生临时、
已验证的 `SelectedProjectBinding`。取消 Dialog 丢弃 Draft，不创建 Camp、Project 或
Repository Scope。

### 2.2 创建事务

Renderer 提交：

```ts
type CreateCampRequest = {
  commandId: string;
  name: string | null;
  project: SelectedProjectBinding | null;
  memberAgentProfileIds: string[];
  defaultLeadAgentProfileId: string;
  collaborationMode: "peer" | "lead_coordinated";
};
```

主进程对所选 Git worktree 重新执行仓库身份校验，随后把 Lobby 映射到应用管理的绝对
`data_dir/lobby` 路径，把 Project 映射到精确 worktree root 与 Repository Binding。
Core command 继续通过 `DomainCommandGateway` 获得 request digest、幂等 replay 和
单事务 receipt。

Core 在一个 transaction 中依次验证：

1. Actor 是 User；
2. 名称输入可规范化且不超过 80 Unicode scalar values；
3. collaboration mode 为当前支持的 `peer`；
4. member IDs 非空、无重复，且每个 Profile 仍为 `present`；
5. Default Lead 正好属于所选集合；
6. project path 是非空绝对路径；
7. Repository Binding 结构和 Repository Scope 解析有效。

任何失败都只产生允许的 rejected command receipt，不产生 Camp 或 CampMember。Core
不得因为 stale 状态而删除成员、替换 Lead、改 mode 或改为 Lobby。

成功写入：

```text
Camp
  name/title
  name_origin
  project_path + Repository Binding
  collaboration_mode
  default_lead_agent_id
  status/version/timestamps

CampMember × selected set
```

创建事件记录稳定的结构事实，但不复制可选名称之外的敏感或执行内容。结果返回
`campId`、最终规范化名称、Default Lead、mode、member count 和 Repository Scope，供
Renderer 选择并打开新 Camp。

### 2.3 创建后

Camp 允许：

```text
CampMembers >= 1
CampMessages = 0
Conversations = 0
CampTurns = 0
AgentRuns = 0
```

Renderer 不显示额外 Draft 或“等待首条消息保存”状态。它加载普通 Camp snapshot，
工作区为空态与 Composer 同时可用，焦点落在 Composer。

## 3. 初始成员与 Default Lead

Dialog 只列出 `present` AgentProfiles，并按 `(memberOrder, id)` 稳定排序。初次打开默认
选择全部成员：

- UI 不允许取消最后一名成员；尝试时保留勾选并显示“至少选择 1 位成员”；
- 用户移除当前 Lead 后，UI 自动选择剩余集合中稳定顺序第一名；
- 用户手动更换 Lead 后，只要该成员仍被选择就保持选择；
- 初始推荐先找 `runtimeReadiness.status === "ready"` 的第一名；若无 Ready，选择稳定
  顺序第一名；
- 所有选中成员都可成为 Lead，Runtime 未配置或未就绪不影响结构合法性；
- Core 不信任 Renderer 的推荐算法，只验证提交的精确关系。

v0.22 不增加 Camp 创建后的 membership editor。既有 `camp.member.add`/离队恢复等领域
能力仍可被内部或后续产品面使用，但必须停止预建 Conversation。

## 4. Project Selection 与 Repository Binding

Dialog 的 Project selector 顺序为：

1. `不关联项目`；
2. 当前 Navigation Read Side 中已知 Project 的具体路径快捷项；
3. `选择本地 Git 项目…`。

快捷项绑定它显示的精确 `projectPath + gitCommonDir + objectFormat`，不提交 Project ID。
同一 Repository Scope 的不同 worktree 可以分别出现；创建后仍由 Repository Scope
聚合到同一 Project 视图。

全局入口以 `不关联项目` 为默认。Project 侧栏 `＋` 先调用系统目录选择器；用户取消时
不打开 Dialog。选择成功并经 `repositories.inspect` 验证后，Dialog 以结果预选。Dialog
内部再次选择本地项目时使用相同流程。创建提交前主进程必须复核：

- 选择路径仍是同一 Git worktree root；
- `gitCommonDir` 仍指向同一 Repository；
- `objectFormat` 未变化。

复核失败保留 Draft 和用户选择，但创建被拒绝；不静默改成 Lobby。

v0.22 没有 Project 移动 UI，创建文案不得承诺“之后可调整项目归属”。

## 5. Collaboration Mode

持久值为：

```text
peer | lead_coordinated
```

v0.22 的 Dialog：

- 左侧显示已选、可用的「并肩协作」；
- 右侧显示禁用的「领队统筹」并标记「暂未开放」；
- 不出现“推荐领队统筹”；
- 不把「并肩协作」描述为广播。

`peer` 继续保留 Default Lead。用户未显式 `@` 时，`MessageAddressSpec::Default` 只解析为
Default Lead；显式寻址和广播仍遵守 ADR-0058 的精确、全目标准入。

`lead_coordinated` 预留为“只有 Default Lead 与用户直接对话”的持久语义，但本版没有
创建、切换或执行该模式的可用路径。Core 收到该值返回
`camp.unsupported_collaboration_mode`。

模式状态不在 Camp 工作区对外展示。未来显式切换只影响后续路由，不改历史。

## 6. Camp Name 状态机

持久字段：

```text
title: normalized string
name_origin: default | generated | user
```

规范化函数由 Core 独占：

1. `split_whitespace` 语义折叠全部内部 Unicode whitespace；
2. 用单个 ASCII space 连接；
3. 计算 Unicode scalar values（Rust `char`）；
4. 手工输入超过 80 时拒绝，不截断；
5. 自动生成超过 80 时确定性截断到 80。

状态迁移：

```text
create blank     → ("未命名对话", default)
create nonblank  → (normalized input, user)
first accepted user execution while default
                 → (truncate(normalized body, 80), generated)
explicit rename from any origin
                 → (normalized input, user)
```

若首条消息规范化后为空，现有消息校验先拒绝，因此不会产生空 generated 名称。用户显式
命名为「未命名对话」仍是 `user`，自动命名不得覆盖。

`name_origin` 是内部治理状态，不加入 Navigation、Camp Snapshot 或普通 UI 合同，除非
实现状态机所需的 Core 内部读取。

## 7. 首条与后续执行

创建后的 Composer 统一调用 `camp.messages.send`，不再调用
`camps.createFromFirstMessage`。请求仍包含结构化 address 和 execution。

目标解析拆成两层：

```text
Address identity resolution
  Camp + current CampMember + present AgentProfile
  → ordered target agentProfileIds

Execution target preparation
  find existing Conversation or reserve missing identity
  + Runtime Resolution / Readiness / workspace / capability / queue admission
  → admitted target configs
```

缺失 Conversation 不得阻止 preflight。Busy/queued 检查对缺失 Conversation 等价于无既有
Run。需要冻结 Runtime config、workspace 或 session identity 的代码必须能在 final
transaction 中使用新 Conversation ID，而不能提前发布该 row。

ADR-0066 允许在最终准入前写入 Runtime Resolution Job 和 Pending Execution Intent。
解析完成后，`send_camp_message` 的单个最终 transaction：

- 再次解析精确成员与 Lead，防止 stale recipient；
- 再次验证全部目标及其冻结配置；
- 对每个目标 `INSERT ... ON CONFLICT DO NOTHING` 并读取稳定 Conversation ID；
- 原子写 CampMessage、CampTurn、AgentRuns；
- 对 `name_origin = default` 的 Camp 同事务自动命名；
- consume Pending Execution Intent。

任一目标失败时，不创建任何目标 Conversation、CampMessage、CampTurn 或 AgentRun，也不
改变 Camp 名称。既有 Camp 和 CampMembers 保持原样。显式多目标不能部分成功。

普通非执行型 CampMessage 若仍由内部能力支持，不需要 Conversation；只有带 execution
的用户 Composer 提交触发上述按目标创建。

## 8. Read Side 与删除

Read Side 的成员查询继续以 `camp_member + agent_profile` 为权威，不得通过
Conversation inner join 过滤成员。Camp Snapshot、Navigation 和 Default Lead
reconciliation 必须适用于零 Conversation、零消息 Camp。

删除空 Camp 不应有额外 blocker。永久删除仍遵守 ADR-0058 的 quiescent 检查，并删除
已有从属数据；“没有消息”不是自动回收条件。

Navigation 仍按 Repository Scope 派生 Project。创建成功后应立即出现新的
`未命名对话` 或用户名称；`lastActivityAt` 使用 Camp 创建/更新时间，在首条消息前也
可稳定排序。

## 9. Renderer Dialog

使用已有 Radix Dialog 与 Meridian token，不引入第二套视觉系统：

- 常规宽度 `min(760px, calc(100vw - 48px))`，窄窗口降为可滚动单列；
- Header：`创建新对话`、简短结构说明、关闭按钮；
- Body 顺序：Project、成员与 Lead、协作方式、折叠的可选名称；
- Footer：左侧结构摘要；右侧「取消」与 primary「创建」；
- 不展示提交快捷键承诺，按钮名称不参与系统流程；
- 禁用 mode 仍可读其名称、说明和「暂未开放」，但不可聚焦为可选 radio；
- 创建期间锁定重复提交；失败在 Dialog 内或 Toast 明确呈现并保留全部字段；
- `Escape` 与关闭按钮仅在非提交状态关闭；焦点被困在 Dialog，关闭后回到触发入口；
- 成功后关闭、刷新 Navigation、激活 Camp，并把焦点交给普通 Composer；
- Day/Night、reduced motion、200% zoom、`1440×920`、`1040×700` 均不得横向溢出。

参考原型中的以下内容明确作废：领队统筹默认/推荐、并肩协作广播、清空全部成员、
“创建后可调整成员/项目”的承诺和「创建对话」按钮文案。实现以本文件和
[Meridian §9.3](../../ui/meridian.md) 为准。

## 10. Schema 与迁移

v0.22 使用直接 schema 切换：

- `camp` 增加受 CHECK 约束的 `name_origin` 与 `collaboration_mode`；
- collaboration mode 只允许闭集值，schema 可存两值，command 在 v0.22 只接受
  `peer`；
- 删除或停止使用 `camps.createFromFirstMessage` 产品合同；
- 不增加 CampMember→Conversation 非空约束；
- 保留 Conversation `(camp_id, agent_profile_id)` 唯一性；
- 更新 migration version 与 fresh-schema tests；
- 清除不兼容的开发 collaboration aggregate 数据，或要求开发数据库整体重建；
- 不实现 backfill、dual read/write、feature flag 或 legacy compatibility view。

迁移不得删除 AgentProfiles、Runtime 安装目录、Skills、MCP 或 Memory 等不属于旧
collaboration aggregate 的配置数据，除非 fresh database 策略整体重建。若选择局部清理，
必须按外键安全顺序清除 Camp-owned 表并通过 `foreign_key_check`。

## 11. 失败合同

至少区分：

| 代码 | 含义 |
|---|---|
| `camp.no_present_members` | 提交成员集合为空 |
| `camp.invalid_initial_member` | 成员不存在、重复或已不再 present |
| `camp.invalid_default_lead` | Lead 不属于精确成员集合 |
| `camp.unsupported_collaboration_mode` | v0.22 收到非 `peer` |
| `camp.name_too_long` | 手工名称超过 80 Unicode scalar values |
| `camp.repository_binding_changed` | 选择的 worktree/Repository 身份已变化 |

Renderer 可本地提前阻止明显错误，但不得把本地校验当作权威。rejected result 保留 Draft，
刷新成员/Project 候选供用户明确修正。
