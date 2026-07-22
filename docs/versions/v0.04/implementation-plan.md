---
document_type: implementation-plan
version: v0.04
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-22
---

# Lumen AI v0.04 实施计划与验收清单

> 状态：实施中；检查点 1～3 已完成
>
> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0008](../../adr/0008-collaboration-v2.md)
>
> 文档规则：[文档导航](../../README.md)

## 开工时基线

以下是 v0.04 开工时的差距清单；已经完成的检查点会逐步替代这些事实。代码当下状态以各检查点的“实施状态”和测试结果为准。

开工时代码已经具备 Camp、CampMember、Conversation、CampMessage、CampTurn、AgentRun、Task、Inbox、Action/Approval、Snapshot/增量事件与多 Runtime Adapter，但产品主路径仍是 legacy Project/Task：

- `camp.repository_scope_id` 仍为非空唯一，无法在同一 Git Project 下建立多个 Camp。
- 一个 legacy Project 仍物化一个 compatibility Camp，Task 继续充当侧栏对话入口。
- `CreateCamp`、成员加入和首条执行分为多个命令，不能保证新对话首次发送的原子性。
- Camp 没有标题、成员顺序、Rename/Delete 命令和导航未读水位；Default Lead 仍存在沐瓦兼容优先路径。
- `camps.list` 只返回扁平 Camp 列表，Renderer 仍自行拼接 Project、Task 与 Camp。
- 顶栏、侧栏、项目概览、诊断和全局刷新仍是 v0.01/v0.03 布局。

因此 v0.04 不是纯 Renderer 重排；必须先切换写入真源和读取模型，再替换导航。

## 实施原则

- 分为五个可独立验证的检查点；每个检查点完成代码、迁移、测试和文档状态更新后形成一次独立提交。
- 先完成 Schema、Core 命令与 Read Side，再切 Renderer；不得先用前端临时映射掩盖一项目一 Camp、Task-as-conversation 或多命令半创建问题。
- Project 永远是 Camp 的读取分组。新代码不得恢复 Project CRUD、空 Project 或 Project 生命周期。
- 点击“新对话”不写数据库；首条消息的完整创建链只有一个幂等事务入口。
- 永久删除只能作用于静止 Camp，且必须事务级完整；不引入 Archive、Trash 或后台删除状态。
- legacy 数据只做确定性导入。无法验证的数据按 ADR-0008 丢弃，不拖累当前模型。

## 检查点 1：v11 Schema、迁移与 Camp 命令

> 实施状态：已完成（2026-07-22）。v11、强类型命令、Core RPC/Contracts 与迁移/破坏性测试均已落地。

目标：先让数据库能够表达 v0.04，不改变主界面。

实施内容：

- 增加 Camp `title`、AgentProfile `member_order` 及必要导航已读水位；移除 `repository_scope_id` 的 Camp 级唯一约束，增加普通查询索引，并保持 Camp 私有 Git Ref 唯一。
- 停止新 Camp 使用 `status/archived_at`；迁移期可以读取旧列，但新领域 API 不再暴露 Archive 状态。
- 增加强类型 `CreateCampFromFirstMessage`、`RenameCamp`、`ChangeDefaultLead`、`ReorderMembers` 和 `DeleteCamp`。
- `CreateCampFromFirstMessage` 在一个事务中完成 Repository Binding 复用、全体活跃成员快照、Conversation、Runtime Ready Lead、首条 CampMessage、CampTurn 和 AgentRun。
- `DeleteCamp` 实现静止门、结构化 blocker、从属记录事务删除、最小命令幂等结果与受管 Blob GC Root 清理。
- v11 Migration 将有效 legacy Task 工作区按 Task 导入 Camp；无效关系集丢弃并写迁移诊断。重复启动不得重复导入。

完成门：

- 两个 Camp 可以共享一个 `repositoryScopeId`，但仍拥有独立成员、消息、Conversation 与内部 Git Ref。
- 创建命令任一步失败时数据库中不存在半 Camp；相同 `commandId` 重试只返回原结果。
- 运行中、待审批或未知副作用 Camp 删除被拒绝；静止 Camp 删除后不存在孤立从属行。
- 新库、有效旧库与脏数据 fixture 的 v11 迁移均幂等通过。

## 检查点 2：Navigation Read Side 与增量协议

> 实施状态：已完成（2026-07-22）。Navigation Snapshot/分组分页、权威活动序列派生、loading/未读完成标记与单调查看水位均已落地。

目标：由 Core 一次提供 Renderer 所需的大厅、Project/Camp 树和标记，不建立 Project 真源。

实施内容：

- 增加版本化 Navigation Snapshot DTO：大厅、按最新 Camp 排序的 Project 分组、每组最近 5 个 Camp、总数、展开查询游标及 `throughGlobalSequence`。
- Camp 行返回持久标题、Project Binding、最后活动时间、`loading / unread_completed / none` 标记和 Default Lead 摘要；不返回伪 Camp 状态机或审批/失败聚合角标。
- 最后活动只由用户 CampMessage、Agent 最终回复和 AgentRun 有效终态推进；查看、重命名、流式片段和动画不改变排序。
- 增加查看水位 ACK；当前可见 Camp 的完成活动视为已读，重启后蓝点保持一致。
- 增量事件只用于失效通知和时间线；序列缺口或 Schema 不兼容时 Renderer 重新获取 Snapshot。

完成门：

- 大厅固定在前，Project 按最新 Camp 排序；每组恰好在超过 5 个 Camp 时出现“查看全部”。
- loading 优先于旧蓝点；运行结束后非当前 Camp 出现蓝点，进入 Camp 后消失。
- 删除最后一个 Camp 后 Project 从同一权威快照消失。
- Renderer 不读取 legacy Project/Task 列表即可构造完整导航树。

## 检查点 3：新对话 Intake 与 Camp 工作区切换

> 实施状态：已完成（2026-07-22）。目录选择零写入、Runtime Ready 创建门、首消息原子建 Camp、Camp 主工作区、同 Conversation 连续运行与重启恢复均已落地。

目标：把主路径从 Project/Task 切到 Camp，并保持 Runtime 执行闭环。

实施内容：

- “新对话”只建立 Renderer 临时输入态；当前项目 Camp 预选其 Project Binding，大厅/成员/设置预选大厅，发送前允许切换。
- 所有成员均未 Runtime Ready 时阻止进入新对话；首次发送前再次执行 Core Preflight，失败时保留输入文本且不持久化半成品。
- “打开本地项目”只选择并验证 Git 目录，然后进入绑定该目录的临时输入态；不再先写 Project。
- 首条消息和后续主 Composer 默认请求当前 Default Lead 执行；显式 `@Agent` 继续使用结构化多目标地址。
- Camp 主工作区直接消费 Camp Snapshot；Task 只在 Camp 内按需展示，不再决定主路由或 Native Session 所属。

完成门：

- 只点击或取消“新对话”后 SQLite 无新增记录；首次发送成功后完整 Camp 主链同时可见。
- 当前 Project、新选 Git Project 与大厅三种入口分别获得正确 Binding。
- 初始 Lead严格遵循 Member Order 中首个 Runtime Ready 成员；不存在沐瓦/名称/头像隐藏 fallback。
- 至少完成一次真实 Adapter AgentRun，并在重启后继续打开同一 Camp/Conversation。

## 检查点 4：固定侧栏、上下文栏与 Camp 操作

目标：落地最终导航布局和 Camp 管理交互。

实施内容：

- 左侧顶部固定“新对话、成员”，中部滚动展示大厅与 Project/Camp 树，底部固定“设置”；删除大厅/项目/任务/诊断顶级页面入口。
- 侧栏维持当前 220px 基线。Camp 标题使用弹性剩余宽度和像素级单行省略，不按固定字符截断。
- Project 名称和箭头统一展开/折叠；不提供项目概览。“查看全部”只在侧栏内展开与收起。
- Camp 行只显示运行 loading、未读完成蓝点或无标记；三点菜单只提供重命名、删除。
- Default Lead 在 Camp 工作区可显式调整；未就绪成员允许被选中但必须提示后续默认执行会被阻止。
- 顶栏改为当前 Camp 上下文与就地操作，删除“仅本地执行记录”“新对话”和“刷新”。设置正常无状态点，只有 Core 不可用时显示红点；诊断并入设置。

完成门：

- 220px 侧栏中中英文长标题均按真实可用宽度省略，菜单、loading 和蓝点不挤出布局。
- 键盘可以访问新对话、成员、Project 折叠、Camp、三点菜单、重命名、删除和设置；菜单操作不会误打开 Camp。
- 删除存在 blocker 时先引导停止；静止后确认删除，最后一个 Camp 删除时 Project 同步消失。
- 1040×700 与 1440×920 下主路径、错误态和焦点可见性符合 `docs/UI_STYLE.md`。

## 检查点 5：legacy 切除、恢复与打包 APP 验收

目标：删除兼容主路径并证明新导航能跨重启可靠运行。

实施内容：

- Renderer、Contracts 与 Core 主路径停止调用 `projects.list`、legacy Task 工作区和 compatibility Camp 物化；只保留迁移读取所需的最小旧结构。
- 清理硬编码沐瓦、默认大厅 Project、Task-as-conversation、手动全局刷新和 Project 概览分支。
- 增加创建中断、双 Camp 同 Project、多 Agent 并行、运行完成未读、删除门禁、脏数据迁移和 Snapshot 序列缺口测试。
- 完成真实 Electron APP 测试：目录选择、首条发送、运行、蓝点、重命名、Lead 调整、停止后删除、Project 消失、设置诊断和应用重启。
- 完成生产构建与 macOS 打包；版本文档只在实际通过后更新实施状态。

完成门：

- 新安装和迁移安装都不再产生新的 Project 真源或 compatibility Camp。
- 杀死 Electron、Rust Core 或 Runtime Host 后，Camp 树、未读标记和已提交消息恢复一致；未提交临时输入允许丢失。
- 旧脏数据不会阻塞启动，也不会生成半 Camp、空 Project 或重复导入。
- 全量 Rust、TypeScript、Renderer、Smoke、生产构建和打包 APP 验收通过。

## 产品验收矩阵

| 编号 | 场景 | 预期结果 |
|---|---|---|
| AC-01 | 点击后取消新对话 | 不写入任何 Camp 相关记录 |
| AC-02 | 所有成员 Runtime 未就绪 | 阻止新对话并引导成员配置 |
| AC-03 | 项目 Camp 中新建对话 | 临时输入预选同一 Project Binding |
| AC-04 | 同一 Git Repository 创建两个 Camp | 一个 Project 下显示两个独立 Camp |
| AC-05 | 首条消息提交失败 | 输入保留，数据库无半 Camp |
| AC-06 | 标题很长 | 完整持久标题不变，侧栏按像素显示省略号 |
| AC-07 | 后台 Camp 运行结束 | loading 消失并出现蓝点，打开后蓝点清除 |
| AC-08 | 重命名 Camp | 仅标题变化，不改变排序时间、Binding 或运行 |
| AC-09 | 删除运行中 Camp | Core 返回 blocker，不删除任何数据 |
| AC-10 | 停止后删除静止 Camp | Camp 从属记录永久删除，不出现归档入口 |
| AC-11 | 删除 Project 最后一个 Camp | Project 分组立即消失，Repository 不受影响 |
| AC-12 | legacy Task 导入 | 每个有效 Task 形成独立 Camp，脏关系被丢弃并记录 |
| AC-13 | Core 正常/异常 | 正常无状态点，Core 不可用时设置显示红点与诊断 |
| AC-14 | 应用重启 | Camp 树、排序、选择和未读水位恢复一致 |

## 每个检查点的验证基线

```text
cargo fmt --check
cargo test -p lumen-core
cargo clippy -p lumen-core --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
```

涉及 Intake、Runtime、Action/Approval 或恢复时追加相应 Smoke；涉及 Renderer 时必须启动真实 Electron App，验证 1040×700 与 1440×920、键盘焦点、错误态和重启。最终检查点执行 `pnpm build` 与 `pnpm package:mac`。

## v0.04 完成定义

- 五个检查点分别通过完成门并形成独立提交。
- Project 完全由 Camp 派生；Task、legacy Project 和 Renderer 本地状态不再冒充对话真源。
- 首条消息原子创建 Camp，成员、Lead、Conversation、Turn 和 Run 不出现半状态。
- 侧栏状态只有 loading、未读蓝点和默认无标记；标题按真实宽度省略。
- Rename/Delete、Lead 调整、Core 异常诊断和迁移失败路径均有可操作 UI。
- 永久删除保持静止门、事务完整性和外部资源边界，不留下归档或孤立记录。
- 全量测试、真实 APP 验收、生产构建与 macOS 打包通过，文档状态与代码事实一致。
