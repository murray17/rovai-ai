---
document_type: version-overview
version: v0.28
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-01
---

# Rovai-ai v0.28 In-App Notifications

> 状态：持久应用内通知生产设计已经确认并冻结；生产实施与验收已完成
>
> 前置版本：[v0.27 Partner Identity Six Fields](../v0.27/README.md)
>
> 跨版本决策：[ADR-0087](decisions.md#adr-0087)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本意图

在 Rovai-ai 内建立一个可持久查看的通知中心，并在新事项到达时显示不抢焦点的临时浮层，
让用户能够发现需要处理的 Runtime Permission Request，以及此前发起且已经结束的协作。

初始决策报告及本轮早期形成的 macOS 系统通知方案只作为设计过程输入，不构成当前合同。
通知的持久化权威、生成事务、未读语义、生命周期、保留策略、内容、偏好与 UI 已按新的
应用内渠道冻结并实现。

## 已完成的实施事实

- Migration v43 创建空通知收件箱、默认开启的浮层偏好、外键、唯一约束、索引与原子生成
  Trigger；升级不回填旧事实。
- Core 实现通知分页、创建增量、动态 Camp 标题、未读、Camp/全部已读、单项/已读清除、
  乐观并发偏好以及 90 天/1,000 项保留维护；SQLite 是唯一持久真源。
- Runtime Permission Attention Episode 与 CampTurn 首次合格终态在来源事务创建通知；
  主动 Stop 保持静默，inbox delivery failure 补齐通用 `camp_turn.status_changed`。
- Renderer 实现品牌行全局入口、精确/`99+` 徽标、右侧 Radix 通知抽屉、筛选与分页、
  单槽浮层队列、显式阅读/清除、通知设置、当前 Camp 自动已读及安全退化导航。
- Electron Main 只允许并转发通知 Core 方法，没有通知副本、设备 JSON 或系统通知投影。
- Core、Renderer、非模型 Smoke、macOS 打包与隔离成品 App 验收均已通过；证据见
  [实施与验收](implementation-plan.md)。

## 已确认并继续有效的领域范围

- v0.28 不提供“等待回复”通知，也不顺带实现 `waiting(user_input)` 的暂停、回复、输入
  物化与 AgentRun 恢复协议；不得扫描 Agent 文本猜测它正在提问。
- “待审批”只覆盖 Runtime 真实提出并由 Rovai-ai 完整持久化的 Runtime Permission
  Request：关联 Action 为 `intercepted`，保留完整原生请求身份和原生 options，目标是
  当前本地用户，且 Approval 仍为 `pending`。未来其他业务 Approval、Core-mediated 或
  Rovai-ai 合成的请求不自动取得资格。
- 待审批以 Camp 级 Runtime Permission Attention Episode 聚合：合格 Pending Request
  从零变为非零时开始，全部归零时结束；同一 Episode 内新增请求不重复创建同类通知。
- “执行结束”以 CampTurn 为唯一聚合单位，一个 Turn 至多产生一项结果通知，不按
  AgentRun 或成员拆分，也不跨 CampTurn 合并。
- `completed` 表达执行完成，`failed` 表达执行未完成；`cancelled` 且
  `cancelRequestedAt != null` 表示用户已主动停止，不产生结果通知。未来若出现没有用户
  Stop 记录的 `cancelled`，仍按执行未完成处理。
- Runtime Availability、Readiness、Discovery、后台检查、登录、安装、版本、路径、配置
  和能力变化不直接产生通知。Runtime 问题只有在具体 CampTurn 进入合格未完成终态时才
  间接体现。
- `manual_retry_allowed` 与泛化 `waiting` 没有完整重试/放弃交互闭环，不产生通知；只有
  CampTurn 后续真正进入合格终态时才可产生结果通知。
- 所有生产路径的 CampTurn 状态变化都应在修改权威对象的同一事务追加
  `camp_turn.status_changed`，包括 inbox delivery failure 聚合路径。这是通用领域
  可观察性不变式，不是通知专用事件。

## 已确认的新渠道方向

- v0.28 不再创建 macOS 系统通知，改为 Rovai-ai 内部的持久通知中心。
- App 侧栏或顶层 Shell 提供通知入口、未读数量和可持久查看的通知列表。
- 新通知到达时可显示不抢焦点的临时浮层；浮层消失或被错过后，通知仍可在通知中心读取。
- 点击通知继续复用精确内部导航：待审批打开来源 Camp 并定位仍可操作的 Approval Dock；
  执行结果打开来源 Camp 并定位对应 CampTurn 的最后可见时间线结果，缺失目标按 Camp、
  时间线底部和当前安全页面逐级退化。
- 应用退出期间不承诺弹出提醒；不使用 Electron `Notification`、macOS 通知授权、系统
  Notification Center、通知签名验收、LaunchAgent、菜单栏常驻或独立后台服务。
- Core SQLite 是 In-App Notification 的唯一持久化真源。Core 在来源领域事实提交的同一
  事务创建具有稳定 ID、类型、来源关联、创建时间、已读和清除状态的通知项；通知项只
  投影用户注意力，绝不反向决定 Approval 或 CampTurn。Core 提供分页 Read Side 与标记
  已读、全部已读、清除命令，持久事件只提示客户端刷新，不能通过重放 `event_log` 重建
  通知历史。Renderer 负责通知中心、未读徽标、临时浮层和内部导航；Electron Main 不
  持有通知数据或设备 JSON 副本。完整所有权边界见 ADR-0087。
- 首次升级到 v0.28 时通知中心从空白开始，不回填旧 CampTurn、既有 Pending Approval
  或 Navigation 未读，也不为 Migration 的兼容修正创建通知。通知能力启用后，新发生的
  合格领域事务才原子创建通知项。关闭最后一个窗口但 App/Core 仍运行时继续记录，重新
  打开后可以查看；整个 App 退出期间不产生新领域事实或通知。
- App 再次启动时，单纯重读、重投影或重复提交旧状态不创建通知；恢复流程若真正把此前
  非终态的 CampTurn 新提交为失败或没有主动 Stop 证据的取消，则创建一项“执行未完成”。
  App 退出本身不伪造 `cancelRequestedAt`，只有用户明确 Stop 才按主动停止排除。
- 新创建的通知默认未读。浮层仅仅出现不改变阅读状态；点击浮层或通知列表项时先标记
  已读，再执行内部导航。用户从其他入口打开来源 Camp 时，只有匹配的权威快照已经提交
  到界面后，才把该 Camp 在本次呈现边界之前的通知标记已读，不能误伤随后到达的新通知。
- 通知产生时若来源 Camp 已经真实呈现在当前聚焦窗口中，Renderer 不显示浮层，并在确认
  最新来源内容已经呈现后把该通知标记已读；通知项仍保留在列表中。仅打开通知中心不自动
  清空未读，用户可以显式执行“全部已读”。
- 通知中心是有限期注意力收件箱，不是永久审计档案：通知最多保留 90 天且最多保留最近
  1,000 项，任一边界超出时删除最旧项，不因未读而无限保留。用户可以清除单项或“一键
  清除已读”，首版不提供容易误删的“一键清空全部”。
- 清除待审批通知只移除注意力项，不批准、拒绝或取消 Runtime Permission Request；同一
  Attention Episode 内不会因后续重读或新增请求重新创建，全部归零后未来的新 Episode
  仍可产生新通知。所有清除和自动淘汰都不改变来源领域记录。
- 永久删除 Camp 时同事务删除其通知；归档 Camp 的通知继续保留且可导航。来源 Approval
  或 CampTurn 单独失效而 Camp 仍存在时，通知保留至正常清除/淘汰边界，并在点击时退化
  为打开 Camp。
- 两类合格通知始终进入通知中心并参与未读计数，首版不提供关闭持久记录或未读徽标的
  开关。用户只控制不抢焦点的临时浮层：设置提供浮层总开关及“待审批”“执行结束”两个
  子开关，默认全部开启；总开关关闭时保留子选择。
- 浮层关闭期间新通知仍正常持久化；重新开启只影响之后新到达的通知，不补弹列表中的旧
  通知。浮层偏好不改变已读、清除、保留与导航语义。v0.28 不再提供通知启用邀请、系统
  权限、测试通知或关闭整个通知中心的设置。
- 持久通知只保存类型、来源稳定 ID、生命周期状态与时间，不复制 Camp 标题、成员名称或
  业务正文。Read Side 在读取时关联当前 Camp 标题；Camp 改名后通知显示新名称，永久
  删除 Camp 时通知随之删除。
- 通知中心和浮层只展示当前 Camp 标题与固定提示：“有操作等待你确认”“一次协作已经
  完成”“一次协作未完成，请返回查看”。不得显示或持久化成员名称、Prompt、回复摘要、
  审批命令/选项/数量、路径、附件、错误详情或 Runtime 信息；详细内容只在点击后从来源
  Camp 的权威界面读取。

## 已撤销的系统通知方案

以下早期决定只服务于操作系统通知，已退出 v0.28 当前合同：

- Electron Main 拥有的最佳努力系统通知投影与仅内存消费游标；
- macOS 权限邀请、系统设置入口、测试系统通知和签名失败状态；
- `Notification.getHistory()`、`launchInfo`、系统通知稳定标识、跨 App 进程点击重绑；
- 因系统通知投递而定义的关窗后台监控、操作系统撤回和 Focus/免打扰语义；
- “不保存通知历史”、只在当前 App 进程去重以及设备本地通知偏好文件；
- 为锁屏与共享屏幕限定的固定系统通知文案。应用内内容仍需独立确认隐私边界。

早期系统通知 ADR 已在尚未实施时撤下；当前 ADR-0087 只记录重新确认的 Core 持久
通知收件箱边界，不继承 Electron Main 系统投影语义。

## 实现与验收状态

用户已确认 [生产设计](production-design.md)、ADR-0087、非目标、Migration 与验收矩阵，
并另行授权代码实施。v0.28 的生产实现和本地验收现已完成；精确命令、测试数量、打包范围
与截图矩阵以 [实施与验收](implementation-plan.md) 为准。
