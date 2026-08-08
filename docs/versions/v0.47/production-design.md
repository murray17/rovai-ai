---
document_type: production-design
version: v0.47
authority: renderer-ui-contract
status: frozen
implementation_status: complete
last_updated: 2026-08-08
---

# v0.47 Durable Task v2 生产设计

本文件局部替代 [v0.38 唯一实时 Task 卡](../v0.38/production-design.md)中的四态文字和
Task Inspector 细节，但保留“创建位置唯一实时卡”的模型。全局视觉、布局、断点、组件与
无障碍仍以 [Arctic Dawn V3](../../ui/arctic-dawn.md)为准；领域字段、授权和事务以
[Durable Task v2](../../contracts/durable-task-v2.md)为准。

当前状态是设计与生产实现均已完成；Renderer、Core contract 与隔离桌面验收共同约束本文行为。

## 1. 四个表面各自负责一件事

| 表面 | 用户要解决的问题 | 不承担 |
| --- | --- | --- |
| 会话 Task 卡 | 这个持久责任当前是什么状态 | 管理、审计、执行过程 |
| Inspector list | Camp 里有哪些可见 Task | 展开完整正文与历史 |
| Inspector detail | 这项责任的完整内容、版本与审计是什么 | 替代 Run 详情或控制执行 |
| 现有 Run UI | 已接受/正在执行/历史执行发生了什么 | 推导或改变 Task 状态 |

不得把四层重新合并成一张复杂 Task 卡，也不得把 Run 状态折叠为 Task 状态。

## 2. 会话唯一实时卡

每个 Task 只在其 `createdAt` 对应的创建位置显示一张紧凑可点击卡。卡片只显示：

- 五态中文状态文字；
- Task 标题；
- 当前负责人，未分配时显示“未分配”。

状态文字固定为：

| Domain status | 中文 |
| --- | --- |
| `pending` | 待处理 |
| `in_progress` | 进行中 |
| `blocked` | 已阻塞 |
| `completed` | 已完成 |
| `cancelled` | 已取消 |

`blocked` 只显示“已阻塞”，不展开 Blocked Reason。卡片不显示 description、Acceptance
Criteria、Completion Summary、Cancellation Reason、Closure Metadata、audit cause、关联
AgentRun/Delivery、进度百分比或执行失败。

title、status 或 Assignee 改变时只刷新同一张卡：

- 不产生新 CampMessage 或 Task 消息；
- 不改变创建时间或卡片位置；
- 不在会话中重新排序或移动到末尾；
- 不触发自动滚动；
- membership 自动释放也只原地刷新。

整卡是“打开任务详情”按钮，支持 `Enter`/`Space`，点击或键盘激活后打开 Inspector“任务”并
选中该 Task。状态不能只靠颜色表达，Focus 必须清晰可见。

## 3. Inspector list：发现 Task

列表使用紧凑 `TaskListItem`，每项默认显示：

- title；
- 中文 status；
- Assignee；
- 最多一行并截断的 preview；
- Acceptance Criteria 数量，例如“3 个验收条件”。

Preview 来源固定为：

| Status | Preview source |
| --- | --- |
| `pending` | `descriptionPreview` |
| `in_progress` | `descriptionPreview` |
| `blocked` | `statusNotePreview`（Blocked Reason） |
| `completed` | `statusNotePreview`（Completion Summary） |
| `cancelled` | `statusNotePreview`（Cancellation Reason） |

空文本不补造内容。Criteria 只显示数量，不在列表逐项展开。List 不加载或显示完整 description、
Criteria 正文、Closure Metadata、source Run 或完整关闭说明。选择一项在同一 Inspector 中打开
详情；列表滚动位置不因后台更新无故跳动。

## 4. Inspector detail：完整责任与审计

详情完整展示：

- title 与 description；
- 按定义顺序展示全部 Acceptance Criteria；
- status 与 Assignee；
- creator 与 source AgentRun；
- version、createdAt、updatedAt；
- 适用的 Blocked Reason、Completion Summary 或 Cancellation Reason；
- `closedBy`、`closedAt`；
- membership 自动释放等 Task audit，明确显示
  `cause = assignee_membership_ended` 的中文说明。

系统内部 ID 仍遵守既有 Inspector disclosure 规则；可解析 actor 使用身份组件和显示名，不把
裸 ID 当主要产品文案。Creator 可读不等于可编辑，详情按钮必须以当前 authorization/
`availableActions` 为准。

### Related execution

详情增加只读“关联执行”区域。Renderer 从 CampSnapshot 的 AgentRun/Delivery 关系派生，不向
TaskRecord 增加字段，也不允许该区域反向改变 Task。

区域只显示紧凑摘要：

- 当前/历史关联执行数量；
- 排队中、运行中、等待中、已成功、已失败、已取消等真实状态；
- 可进入现有 Run 详情的入口。

它必须允许同时显示两个不同事实，例如：

```text
Task：已完成
关联 AgentRun：运行中
```

不得把运行中改写为 Task 进行中，也不得因 Task 已完成隐藏、停止或标记 Run 失败。

## 5. Editor：按 projected final state 形成表单

编辑器根据用户当前草稿计算 projected final state，并动态展示/校验条件字段，不以打开表单时
的原 Task status 固定控件：

| Projected final status | 表单要求 |
| --- | --- |
| `pending` | Assignee 可有可无；不要求状态说明 |
| `in_progress` | 必须选择 Current CampMember Assignee |
| `blocked` | 必须选择 Assignee，并填写非空阻塞原因 |
| `completed` | 必须填写非空完成说明 |
| `cancelled` | 必须填写非空取消原因；只由专用取消交互进入 |

离开 `blocked` 后不再要求阻塞原因，提交成功时由 Core 清除。释放 `in_progress/blocked` 必须在
一次请求中形成 `status=pending + clearAssignee=true`，UI 不制造中间版本。

Assignee picker 包含所有 Current CampMember，包括 `away`；away 目标要显示“当前不可执行”的
辅助信息，但仍可承担责任。是否能立即发起 linked execution 由 Executable Assignee 条件另行
决定，不能用 Runtime readiness 过滤 Task Assignee 候选。

普通 Agent 只看到合同允许的 own update/claim，不显示取消入口。Unassigned claim 可以在同一
草稿中设置自己、内容和 `pending/in_progress/blocked`，但 UI 与 Core 都不得让 projected final
state 成为 terminal。

## 6. 取消 Task

“取消 Task”是 User/Default Lead-only 的独立危险操作入口，但不是新领域 operation。底层始终
提交：

```text
tasks.update(expectedVersion, status=cancelled, cancelReason=非空文本)
```

确认界面使用中文，必须填写取消原因，并在主操作附近明确显示：

> 取消 Task 不会取消已经接受或正在运行的 AgentRun。

如需停止执行，引导用户进入现有执行取消流程。不得把 Task cancel 与 Run stop 合并成一个
复选框、隐式级联或二义性按钮。

## 7. Terminal Task

`completed` 与 `cancelled` 详情完全只读，显示：

- Closure actor；
- Closure time；
- Completion Summary 或 Cancellation Reason；
- Related execution 摘要。

不显示任何 Task mutation 控件，包括编辑、转交、释放、重开或再次取消。继续承担责任只能
创建新 Task。

## 8. Version conflict 与草稿恢复

每次 Inspector save 都携带打开/最近确认版本的 `expectedVersion`。收到
`task.version_conflict` 时：

1. 刷新并展示最新 Task Detail；
2. 不静默覆盖最新 Task；
3. 保留用户尚未提交的本地草稿；
4. 明确提示“Task 已发生变化，请基于最新内容确认后重新提交”；
5. 用户重新审阅并确认后才以最新 version 发出新请求。

不得自动 replay 旧 patch。若最新 Task 已 terminal，详情转为只读，草稿仍可保留供用户复制或
对照，但不能再次提交。

## 9. Membership 自动释放

CampMembership ending 导致 Task 自动释放时：

- 会话卡原地更新；
- Inspector list/detail 实时更新；
- audit 显示“负责人已离开当前 Camp，Task 已自动释放”，并保留
  `cause = assignee_membership_ended`；
- 不生成 CampMessage；
- 不创建新 Task 卡；
- 不弹成“Agent 主动修改 Task”；
- 不自动打开 Inspector、抢焦点或滚动会话。

Member Presence 变为 `away` 时不做上述释放；当前负责人保留，只更新现有 Presence 辅助状态。

## 10. 永久移除队员

删除入口与确认对话框使用中文产品文案，不用一整段内部英文状态名解释实现。Preview 至少展示
受影响 Camp、未完成 Task、Default Lead Camp 和非终态运行数量。

无非终态运行时，确认摘要使用：

> 将从 N 个 Camp 移除，并释放 M 个未完成 Task。

可在次级说明中补充“受影响 Camp 的默认负责人会按现有规则重新选择”。主危险按钮使用
“永久移除队员”，取消按钮使用“暂不移除”。不要要求用户先逐个 Camp 手工离开。

存在 `queued/running/waiting` AgentRun 时禁止确认，使用可行动的中文提示，例如：

> 该队员还有 N 个未结束的运行。请先等待运行结束，或在运行详情中停止执行后再试。

不得只显示 `agent_profile.non_terminal_runs`、`queued/running/waiting` 或英文数据库字段。
已经接受但尚未产生 AgentRun 的 Delivery 不计入该阻塞数量；删除后若它因 recipient identity
失效停止物化，由现有执行/审计表面解释，不伪装成 Task cancellation。

## 11. Arctic Dawn、适配与无障碍

- 复用 Arctic Dawn 状态、危险操作、列表、表单、Dialog、Inspector 与 Focus token，不新增
  卡片墙、UI framework 或散落颜色；
- 最小窗口 `1040×700` 不丢失任何 Task 或删除操作；Inspector 内容允许纵向滚动，页面不得
  横向溢出；
- 200% Zoom 下 list/detail/editor/Related execution/delete dialog 均可访问，底部操作不能被
  viewport 截断；
- 所有关键操作可通过键盘发现和完成，`focus-visible` 不被 overflow/sticky 区域裁切；
- 危险操作、编辑、Run 详情入口和 conflict 恢复不能只在 hover 出现；
- Dialog 保持 Focus Trap、`Escape` 和 Focus Return；非模态更新不抢焦点；
- status、自动释放和 conflict 使用合并后的可访问播报，不逐字或对每个后台刷新重复播报；
- 状态文字与语义色共同表达，不能只靠颜色。

## 12. 明确非目标

- 不在会话卡显示 description、Criteria、blocker、closure、audit 或 execution；
- 不让 Inspector list 成为完整 TaskRecord 的镜像；
- 不把 Related execution 写入 TaskRecord、Task state 或 Task mutation；
- 不把取消 Task 当成停止执行，也不在 Run success/failure 后自动更新 Task；
- 不新增独立 cancel/claim/complete/block operation；
- 不以 Presence/Runtime readiness 自动释放或改派责任；
- 不为兼容四态 UI 保留旧 component、旧状态映射或 dual rendering。

## 13. 验收场景

- pending → blocked：卡片原地变“已阻塞”，list preview 显示一行原因，detail 显示完整原因；
- blocked → completed：同一 update 要求完成说明，Core 清 blocker；卡片不移动，detail terminal
  只读；
- completed Task + running linked Run：detail 同时显示“已完成”和“运行中”，Run 不被停止；
- ordinary Agent claim：只能认领自己且 final 非 terminal；取消入口不可见；
- Default Lead cancel：要求原因并显示“不会取消 AgentRun”警告；
- version conflict：最新 detail 更新，本地草稿保留，无自动 replay；
- member away：Assignee 保留；member leave：Task 原子释放且无新消息/卡片；
- RemoveMember across Camps：preview 中文，任一步失败 UI 保持删除前状态；
- 1040×700、200% Zoom、键盘-only：所有详情、滚动、提交、取消、Run 入口和删除确认可达。
