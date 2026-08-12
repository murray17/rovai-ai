---
document_type: production-design
version: v0.28
authority: version-design
status: frozen
last_updated: 2026-08-01
---

# v0.28 应用内通知生产设计

## 权威与渠道边界

本设计细化 [ADR-0087](../../adr/0087-core-owned-durable-in-app-notification-inbox.md)。Core
SQLite 是 In-App Notification 的唯一持久真源；Renderer 只呈现通知中心和临时浮层；
Electron Main 不保存通知数据，也不创建 macOS 系统通知。

生产界面继续遵守 [Arctic Dawn V3](../../ui/README.md)。通知抽屉和浮层使用现有
React、Radix Dialog 与 CSS Token，不引入 UI、图标、动画或状态管理依赖。

本版本只有两个用户事件类别：

| 类别 | 持久通知 Kind | 来源边界 |
|---|---|---|
| 待审批 | `runtime_permission_attention` | 一个 Camp 的 Runtime Permission Attention Episode |
| 执行结束 | `camp_turn_completed` / `camp_turn_incomplete` | 一个 CampTurn 首次进入合格终态 |

通知是注意力投影，不是 Approval、CampTurn、Navigation 未读或审计记录的替代品。清除、
已读、自动淘汰和浮层偏好都不能修改来源业务状态。

## 明确非目标

- macOS、Windows、Linux 系统通知；
- 应用退出后的后台提醒、菜单栏常驻、LaunchAgent 或远程 Push；
- “等待回复”、Runtime 可用性、人工重试、Task、Memory 或更新通知；
- 通知中的批准、拒绝、停止或重试快捷操作；
- 通知搜索、导出、跨设备同步、永久归档或自定义保留期；
- 按 Camp、队员、成功/失败分别关闭持久通知；
- 声音、免打扰时段或系统通知权限设置。

## 持久模型

Migration v43 新增 `in_app_notification`。字段语义冻结如下；具体 SQLite DDL 可以按仓库
辅助函数书写，但不能改变关闭集合、外键和唯一性：

| 字段 | 合同 |
|---|---|
| `sequence` | 单调递增整数，供稳定倒序分页、浮层增量游标和竞态边界使用 |
| `id` | 不透明稳定 ID，不能从标题、正文或时间拼接 |
| `recipient_user_id` | 首版固定为当前本地用户，所有 Read Side 与命令按该范围过滤 |
| `kind` | `runtime_permission_attention`、`camp_turn_completed`、`camp_turn_incomplete` |
| `camp_id` | 必填来源 Camp；Camp 永久删除时 `ON DELETE CASCADE` |
| `camp_turn_id` | 仅执行结果使用；来源 Turn 单独删除时置空，通知安全退回 Camp |
| `resolved_at` | 仅待审批使用；该 Attention Episode 的合格 Pending 数量归零时写入 |
| `read_at` | `null` 表示未读；首次标记已读后保持原时间，不因重复命令改写 |
| `cleared_at` | 非空后立即退出普通列表和未读计数，等待有界物理清理 |
| `version` | 生命周期乐观并发版本；只在真实状态变化时递增 |
| `created_at` / `updated_at` | Core 生成的 UTC 时间 |

约束与索引：

- `camp_turn_id` 对执行结果通知唯一，一个 CampTurn 永远不能有第二项结果通知；
- 未结束的 `runtime_permission_attention` 在同一用户、同一 Camp 下至多一项；
- 执行结果创建时必须有 `camp_turn_id`，来源 Turn 后续单独删除才允许由外键置空；待审批
  不得伪造 CampTurn 关联；
- `cleared_at` 非空的记录不进入任何用户列表或未读计数；
- `(recipient_user_id, cleared_at, read_at, sequence DESC)` 支持未读与全量分页；
- `(camp_id, sequence)` 支持 Camp 呈现后的有界已读；
- 表中不允许标题、成员、Prompt、摘要、命令、路径、附件、错误或 Runtime 内容字段。

通知标题和正文不是持久字段。Read Side 只关联当前 Camp 标题与 Camp 状态；Renderer 按
关闭的 `kind` 和待审批 `resolved_at` 映射固定文案。

### 浮层偏好

Migration v43 同时新增单例 `in_app_notification_preference`：

```ts
type InAppNotificationPreference = {
  headsUpEnabled: boolean
  approvalHeadsUpEnabled: boolean
  executionHeadsUpEnabled: boolean
  version: number
  updatedAt: string
}
```

三个布尔值在新装和升级时均为 `true`。总开关关闭时保留两个子开关。该偏好只控制
Renderer 浮层，不参与通知生成、已读、清除、未读计数或保留。

## 事务生成合同

### Runtime Permission Attention Episode

合格请求必须同时满足：

- Runtime 原生提出且 Action `controlMode = intercepted`；
- Core 已持久化完整 fenced 原生请求身份、Permission Semantics 和原生 options；
- `requestedForUserId` 是当前本地用户；
- Approval 在提交后的状态是 `pending`；
- 不是 Core-mediated、observed、合成请求或未来其他业务 Approval。

创建 Approval 的事务在插入前后计算同一 Camp 的合格 Pending 数量：

1. `0 → >=1`：创建一项未读 `runtime_permission_attention`，该通知 ID 同时标识本次
   Attention Episode；
2. `>=1 → >=1`：仍属于当前 Episode，不创建第二项；
3. `>=1 → 0`：把仍保留的当前 Episode 通知写为 `resolved_at`；
4. `0 → 0`：无通知变化。

Approval 的 approved、denied、cancelled、expired 和 Runtime request resolved 等所有
生产状态变化路径都必须在同一事务调用 Episode reconcile。浮层到达前已经归零时，列表
保留历史通知并显示“相关操作已处理”，但不再显示待处理浮层。

Migration 不为既有 Pending Request 创建通知。迁移后的新请求若加入一个已有 Pending 的
Camp，前态仍非零，因此不会错误开启新 Episode；全部归零后未来的 `0 → >=1` 才创建首项。

### CampTurn 结果

所有生产 CampTurn 状态变化收敛到一个事务辅助边界。该边界必须同时：

1. 更新权威 CampTurn；
2. 追加通用 `camp_turn.status_changed`；
3. 首次进入合格终态时按下表创建通知；
4. 在同一事务提交，任一步失败都不产生半提交结果。

| 最终状态 | 附加条件 | 通知 |
|---|---|---|
| `completed` | — | `camp_turn_completed` |
| `failed` | — | `camp_turn_incomplete` |
| `cancelled` | `cancelRequestedAt != null` | 不创建；用户已经明确 Stop |
| `cancelled` | `cancelRequestedAt == null` | `camp_turn_incomplete` |

inbox delivery failure 当前绕过通用状态事件的路径必须改用该边界。CampTurn 唯一约束、
CommandResult 幂等和状态版本共同保证 Runtime 重发、命令重试与恢复重试不会重复创建。

首次 v43 Migration 对旧状态的直接修正不调用生成边界，也不回填通知。Migration 完成后，
启动恢复若真正把此前非终态 Turn 新提交为合格终态，则按普通生产事务创建通知；单纯重读
或重复投影旧终态不创建。

### 事件边界

每次通知创建、Episode resolved、已读和清除在同一事务追加不含业务正文的
`in_app_notification.*` 事件。事件可提示 Renderer 刷新，但不用于重建通知表。Core 可在
提交后发送最佳努力 `in_app_notification.changed` Wake；Wake 丢失由通知 Read Side 的
有界轮询恢复。

## Core 合同

### Read Side 类型

```ts
type InAppNotificationKind =
  | 'runtime_permission_attention'
  | 'camp_turn_completed'
  | 'camp_turn_incomplete'

type InAppNotificationView = {
  id: string
  sequence: number
  kind: InAppNotificationKind
  camp: {
    id: string
    title: string
    status: 'active' | 'archived'
  }
  campTurnId: string | null
  sourceAvailable: boolean
  attentionState: 'pending' | 'resolved' | null
  readAt: string | null
  createdAt: string
  updatedAt: string
}

type InAppNotificationInbox = {
  schemaVersion: 1
  throughSequence: number
  unreadCount: number
  items: InAppNotificationView[]
  nextCursor: string | null
}
```

`camp.title` 是查询时的当前值，不是通知快照。分页按 `(sequence DESC, id DESC)` 使用不透明
Keyset Cursor；默认 50 项，调用方最大 100 项。过滤只允许 `all | unread`。已清除项永不
返回，未知 Kind 或 Schema 必须 fail closed，不能显示猜测文案。

### 方法

| 方法 | 合同 |
|---|---|
| `notifications.inbox` | 按 `all/unread` 与游标返回页面、未读总数和 `throughSequence` |
| `notifications.createdSince` | 返回创建序号之后的有界批次；用于当前 Renderer 的新浮层 |
| `notifications.markRead` | 幂等标记一项；已清除或不存在返回安全 No-op |
| `notifications.markCampRead` | 只标记指定 Camp 且 `sequence <= throughSequence` 的现有项 |
| `notifications.markAllRead` | 在事务捕获的边界内标记全部，随后并发创建的项保持未读 |
| `notifications.clear` | 幂等清除一项，不改变来源对象 |
| `notifications.clearRead` | 只清除命令边界内已经已读的项，新未读永不被批量清除 |
| `notifications.preference.get` | 返回浮层偏好快照 |
| `notifications.preference.update` | 以 `expectedVersion` 原子替换三个布尔值 |

所有 mutation 都要求 `commandId`，遵守 ADR-0001 的永久 CommandResult 幂等。标记已读与
清除不要求来源对象仍存在；Preference 冲突返回当前快照供 Renderer 对账。

`notifications.createdSince` 返回 `requestedAfterSequence`、`nextSequence`、
`throughSequence`、`resetRequired`、`hasMore` 和当前仍可解析的 items。游标落后于保留窗口
或大于当前高水位时 `resetRequired = true`；Renderer 静默重建当前高水位，不把列表旧项
补成浮层。

## 阅读与清除

- 新项以 `read_at = null` 创建；浮层被展示或自动消失都不算已读。
- 点击浮层或列表项时发起 `markRead` 并执行导航；标记失败不得阻塞打开来源，列表保持
  未读并可重试。
- 普通 Camp 导航在请求 CampSnapshot 前捕获当前通知 `throughSequence`。只有匹配快照
  已经提交到 DOM 后才调用 `markCampRead`，因此随后并发到达的新项不会被误读。
- 通知产生时来源 Camp 已在当前聚焦窗口真实呈现：Renderer 先重读并提交最新
  CampSnapshot，成功后标记该通知已读且不显示浮层；读取失败时保留未读并允许浮层提示。
- 窗口未聚焦、文档隐藏或通知抽屉覆盖内容时，旧 Camp DOM 不构成“已经看见”。
- 打开通知抽屉不自动已读；“全部已读”是显式命令。
- 单项清除和“清除已读”立即从 UI 移除。清除一个仍待处理的 Episode 不解决审批，同一
  Episode 也不会重新创建；真实请求继续由 Approval Dock 呈现。

## 保留与来源生命周期

通知按两个独立硬上限维护：`created_at` 不超过 90 天，并且只保留最新 1,000 项。超过
任一上限都从最旧项开始物理删除，未读不是无限保留例外。清除项先写 `cleared_at` 保持
幂等生命周期，随后进入同一有界清理；它们不进入列表和未读计数。

清理在 v43 Migration 后的 Core 启动以及通知创建/清除后的有界维护点运行。保留清理
失败只记录脱敏诊断并在下一个维护点重试，不回滚已经成功提交的来源业务事务。

- Camp 永久删除：同一事务级联删除全部关联通知；
- Camp 归档：通知保留，列表标记“已归档”，点击允许只读打开但不激活 Camp；
- CampTurn 单独缺失：通知保留，`sourceAvailable = false`，点击只打开 Camp；
- Approval 全部解决：通知保留并显示已处理，直到用户清除或正常淘汰；
- 通知清除/淘汰：不删除 `event_log`、Approval、Action、CampTurn 或 Camp。

## Renderer 刷新与浮层

Renderer 首次 ready 或重载时读取 `notifications.inbox`，把返回的 `throughSequence` 作为
浮层基线；既有未读只进入徽标和列表，不补弹。之后提交后的 Wake 只用于提前刷新，
`notifications.createdSince` 的单飞轮询承担恢复正确性：

- 一次只允许一个请求，`hasMore` 时有界排空并主动让出事件循环；
- 请求失败使用有上限的退避，不清空现有列表，也不忙轮询；
- retention gap、Core 替换或游标异常时静默重建基线，不补弹不确定历史；
- Renderer 隐藏或窗口关闭期间的新项只保留在 Core，重新呈现时进入列表而不补弹；
- 浮层关闭期间仍推进创建游标，重新开启不回放旧项。

浮层只在当前窗口聚焦、文档可见、通知抽屉关闭、来源 Camp 未真实呈现且对应偏好开启时
显示。一个浮层槽位一次显示一项，持续 8 秒；悬停或键盘聚焦时暂停。最多顺序等待三项，
更多新项收敛为“还有 N 条新通知”，点击只打开通知中心，不批量标记已读。

浮层关闭按钮只关闭本次呈现，不标记已读或清除。浮层不取得自动焦点，使用
`aria-live="polite"` 播报；`prefers-reduced-motion` 下取消位移动画。已经 resolved、
read 或 cleared 的待显示项在真正呈现前跳过。

## 通知中心 UI

### 全局入口

统一侧栏顶部品牌行右侧增加一个全局通知按钮，因此普通页面和设置模式都可访问。按钮
不改变一级页面 `view`，而是打开右侧通知抽屉。未读为零时不显示徽标；`1..99` 显示准确
数字，更多显示 `99+`。可访问名称使用“通知，N 条未读”。

### 抽屉

抽屉使用 Radix Dialog，从右侧覆盖而不重排 Camp/Inspector。基准宽 400px，最小窗口下
不超过 `min(400px, calc(100vw - 48px))`。它具备 Overlay、Focus Trap、Escape、关闭按钮
和触发器 Focus Return。

```text
通知                                      ×
12 条未读                    全部已读 · 清除已读

[全部] [未读]
──────────────────────────────────────────
● 待审批
  有操作等待你确认
  Camp 标题                         2 分钟前
──────────────────────────────────────────
  执行完成
  一次协作已经完成
  Camp 标题                         1 小时前
──────────────────────────────────────────
                         [加载更多]
```

列表按创建序号倒序，使用分隔行而不是卡片墙。每行包含文字 Kind、固定提示、当前 Camp
标题、时间、未读形状和可访问的单项清除按钮；状态不能只靠颜色。待审批已解决时显示
“相关操作已处理”，归档 Camp 显示“已归档”。时间视觉可相对显示，但可访问名称和 title
提供完整本地时间。

“全部/未读”是同一抽屉内的筛选按钮；打开抽屉、切筛选和加载更多均不改变已读。空态分别
为“还没有通知”和“没有未读通知”。首次加载失败显示保留上下文的重试状态；加载更多失败
保留已加载行。列表不使用无限滚动，用户显式选择“加载更多”。

### 点击导航

待审批项：关闭抽屉并打开来源 Camp，重读权威快照；仍有合格 Pending Request 时定位
Approval Dock 并聚焦第一项原生选项，已全部解决时只打开 Camp。

执行结果项：打开来源 Camp，定位该 CampTurn 最后一个可见时间线结果，给予临时高亮和
可访问性焦点；没有可见结果时滚到时间线底部，Turn 缺失时只打开 Camp。Camp 已被删除时
通知已级联删除；归档 Camp 只读打开，不自动恢复 Active。通知导航焦点优先于 Composer
的通用自动聚焦。

列表行与浮层点击都先乐观移除未读样式，再提交 `markRead`。导航使用稳定 ID，不能根据
标题或数组位置寻找目标；任何目标失效都不显示错误弹窗，也不创建合成时间线内容。

## 设置 UI

设置侧栏在“外观”和“诊断”之间增加“通知”：

```text
技能
MCP
Agent 运行时
外观
通知
诊断
```

页面标题为“通知”，说明为“待审批和执行结果始终保存在通知中心；这里只控制新通知的
临时浮层。”页面只有一个“浮层提醒”Section：总开关、待审批子开关、执行结束子开关。
子开关值在总开关关闭时保留；UI 明确显示“重新开启后仅提醒新通知”。

切换以 `expectedVersion` 保存完整三字段快照。保存期间禁用重复提交；冲突读取当前快照，
失败恢复服务端值并显示就地错误。页面不包含系统权限、声音、内容模式、测试通知、通知
历史开关或启用邀请。

## 固定内容与数据最小化

Renderer 的关闭映射为：

| 状态 | 类型文字 | 固定提示 |
|---|---|---|
| 待审批、仍 Pending | 待审批 | 有操作等待你确认 |
| 待审批、已归零 | 待审批 · 已处理 | 相关操作已处理 |
| CampTurn completed | 执行完成 | 一次协作已经完成 |
| CampTurn failed / 非主动 cancelled | 执行未完成 | 一次协作未完成，请返回查看 |

唯一动态业务文字是当前 Camp 标题。成员名称、Prompt、回复、审批命令/选项/数量、路径、
附件、错误详情和 Runtime 信息既不进入表，也不进入 Read Side 或浮层。诊断只记录 Kind、
稳定 ID 的不可逆摘要、错误码和时间，不记录 Camp 标题。

## 并发与失败语义

- SQLite 写事务和唯一索引裁决并发生成；Renderer 本地去重不能替代数据库约束。
- 来源事务中的通知创建失败会使同一事务失败，不能提交“来源成功、通知未知”的状态。
- 保留清理、提交后 Wake、Renderer 轮询、浮层或已读命令失败不回滚来源业务事实。
- 重复 mark/read/clear、目标已经删除和旧 Command retry 都返回稳定结果，不弹错误。
- Renderer 崩溃或重载后从 Read Side 恢复徽标与列表；浮层是可丢失提示，不持久排队。
- Core 重启保留 SQLite 通知；首次查询建立浮层基线，不重弹旧通知。
- 未知 Schema/Kind、约束损坏或分页 Cursor 非法时 fail closed，保留应用其他功能并显示
  通知中心局部错误；不得扫描业务正文进行补救。

## Migration v43

v43 只创建通知表、偏好单例、索引与约束；不扫描旧 Approval、CampTurn、Navigation
未读或 `event_log` 生成通知。Migration 使用空表证明“从升级后开始记录”，且不会修改
既有 Camp、Action、Approval、Turn 或消息内容。CampTurn 通用转换辅助边界属于同版本
生产代码重构，不是 Migration 数据改写。

Fresh database 与 v42 upgrade 都创建三个默认开启的浮层偏好。Migration 测试必须以含有
历史 terminal Turn、Pending Approval、归档 Camp 和 Navigation 未读的 v42 fixture 验证
通知表仍为空；升级后首个真实新事务才创建通知。

## 验收矩阵

### Core

- 三个 Kind 的 CHECK、外键、序号、唯一约束和无业务内容列；
- Runtime Permission Request 合格/不合格组合、`0 → >=1 → 0 → >=1` Episode；
- 同 Episode 多请求、部分解决、全部解决、清除后新增、并发创建与 Command retry；
- CampTurn completed、failed、主动 Stop、非主动 cancelled、inbox failure 与启动恢复；
- 分页、筛选、游标、mark one/Camp/all、clear one/read、并发边界和 No-op；
- 90 天、1,000 项、清除 tombstone、Camp cascade、归档与来源缺失；
- v42 → v43 空收件箱和 fresh database 默认偏好；
- 所有事件和诊断 payload 不含禁止内容。

### Renderer

- 全局入口、`0 / 1 / 99 / 99+` 徽标与设置模式可访问；
- 全部/未读、分页、加载/空/局部错误、全部已读、清除与动态 Camp 标题；
- 浮层总开关和子开关、无补弹、单槽队列、溢出摘要、暂停与关闭语义；
- 同 Camp 真正呈现后自动已读，快照失败保留未读，并发新项不被误读；
- Pending/resolved Approval、终态结果、归档、Turn 缺失的导航与 Focus；
- Dialog Focus Trap/Return、键盘顺序、Icon accessible name、`aria-live`、200% Zoom、
  `1040×700` 与 `1440×920`、reduced-motion。

### 集成与真实 App

- Renderer 重载、Core 重启、关闭最后窗口后重新打开和完整 App 重启；
- 窗口隐藏/失焦期间只积累列表，重新聚焦不补弹；
- 升级不回填，恢复的新终态正常创建；
- 构建、类型检查、Rust/Renderer 测试和打包 App 截图；
- 不要求 macOS 通知授权、Developer ID 通知验收或新增依赖。

## 实施状态

无未决设计分支。共同理解与代码授权均已取得，生产实现和验收已经完成；完成证据见
[实施与验收](implementation-plan.md)。
