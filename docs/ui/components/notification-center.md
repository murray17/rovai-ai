---
document_type: ui-component
authority: notification-attention-presentation
status: accepted
target_version: cross-version
last_updated: 2026-09-20
---

# 应用内提醒与会话未读

生产界面暂时隐藏持久 Notification Center、品牌行铃铛和全局未读总数。Core Notification Episode 仍是
唯一持久注意力真源；隐藏 surface 不删除历史，不改变 admission、acknowledgement、clear、retention 或
Change Journal。Renderer 只呈现短暂应用内提醒和 Camp 行“有新回复”状态。

## 应用内提醒

设置侧栏使用用户语言“提醒”。总开关下按“会话 / 使命 / 任务”分开：会话包含待审批、提到你、
本轮完成、单聊回复、执行未完成；使命包含使命需要你、使命状态变更；任务包含任务状态变更。
任务状态默认关闭，预选已完成、受阻、已取消；使命状态默认开启且只选已完成。各状态筛选内联展开，
总开关或分类关闭时保留选择，保存失败回读当前值并允许重试。宽屏会话组占左侧两行，使命和任务各占右侧一组；
窄屏依次堆叠。普通队员消息没有浮层类别。

本轮完成等待该消息引发的全部关联分支与投递成功，单聊回复独立控制。使命需要你只来自实际状态转换；
只有显式 sourceMessageId 才显示该消息正文，没有关联时只显示使命名和“需要你”。任务受阻不等同用户待办。
使命需要你与同消息提及、使命完成与同关联轮完成，在两类都开启时优先保留使命卡片；不靠正文猜测重复。

启动或 reload 先建立当前 Journal high-water，不补弹历史。运行中只有新的 exact `headsUpSignal` 可加入
内存队列；同时最多显示一条，同来源同轮的新高优先级 signal 原地更新，并保留其他精确 Occurrence。浮层标题、摘要、点击和精确确认全部
使用 signal，不读取 Episode 当前 primary semantic/action 替代。内部 `open_camp` action 在界面统一呈现
为“打开会话”，不得暴露领域对象名。

当前普通或 Mission Camp workspace 可见且窗口有焦点时，同 Camp 的全部 signal 不加入临时队列；进入该 Camp
前已排队的同 Camp 项也撤下且离开后不重放。该 quiet scope 不写 acknowledgement，精确来源尚未可见时持久未读
仍保留。应用失焦、隐藏或在后台时，队列可以接收新 signal，但浮层隐藏且剩余 8 秒计时暂停；重新获得前台注意
后先收敛失效与可见来源，再显示当前一条。Hover、focus 和动作提交期间暂停剩余时间，不重置。关闭或超时只移除本次临时呈现，不
acknowledge、不 clear。关闭当前卡片后的剩余项以“还有 N 条提醒 / 查看下一条”轻入口按需推进，不跳转到已隐藏的通知中心。

队列 signal 由 Journal 的 exact acknowledgement、Clear revision、source resolved 或 Episode remove invalidation 失效；当前 Camp quiet scope 或精确内容已读也会抑制并撤下临时呈现。
resolved Approval 的旧 pending signal 必须删除，即使该 Occurrence 仍未确认；reset/重新建立 baseline
直接清空队列，不从历史或 Episode 推荐动作恢复。

## 会话未读点

Camp 与使命行以非撤回 Agent 消息首次发布水位判断新回复；Run 终态本身不生成新回复。
Camp 行只用小点提示“有新回复”，不显示跨会话总数。小点使用 attention 语义色，并同时通过整行
`aria-label` 与 title 表达“有新回复”，不能只靠颜色。它位于固定的 12×12px 右侧状态槽内，Desktop / 宽屏 Web
为 7px，Mobile 为 6px；正在打开或运行时同槽优先显示 loading，未读事实不因此清除，loading 结束后仍按真实状态显示小点。
状态槽无内容时保持尺寸，左侧不渲染未读占位，状态切换不得移动标题。

Camp Snapshot 加载、后台刷新、停留在设置/记忆/队员页或应用失焦都不能消除小点。只有目标 Camp 已是
当前“会话”页面、Snapshot identity 匹配、文档可见且窗口拥有焦点时，Renderer 才提交该 Camp 的
`navigation.campViewed`；失败保持小点并有界重试。打开 Camp 后无需再点击某个“查看本轮”按钮。

Camp 行未读点与 Notification Episode acknowledgement 是两条独立 seam：前者表示会话导航需要注意，
后者仍需精确消息/本轮/审批来源真实进入可见视口后确认。不得用 Camp 级 viewed 顺带批量确认屏幕外
Occurrence。

## 精确可见确认与错误

会话区只在前台“会话”视图采集当前时间线视口内的 `messageId/campTurnId`、实际展开且进入执行视口的
`agentRunId` 和可见 pending `approvalId`。Core 只确认已观察 Journal 边界内匹配的 Active Attention；普通打开会话因此可以自然
读掉已经看到的来源，但屏幕外历史与稍后新到达的来源保持未读。

浮层动作先持久化其 exact acknowledgement，再导航。保存失败保留注意力；保存成功但定位失败不恢复
未读，并通过 App 全局 toast 说明“已标记为已读，但未能定位”，不在已隐藏 surface 中留下孤立行内
错误。

## 视觉与无障碍

浮层沿用 Porcelain Day / Steel Night 的 raised overlay、Steel edge 和开放行，不增加渐变、glow 或独立
卡片世界。长会话名和 CJK/emoji 摘要允许收缩/换行；支持键盘操作、`aria-live=polite`、reduced motion、
最小窗口与 200% zoom，出现和更新都不得抢走当前键盘焦点。

## References

- [Notification Episode v9](../../contracts/notification-episode-v9.md)
- [Current User Attention v8](../../contracts/current-user-attention-v8.md)
- [App Shell 与统一侧栏](app-shell-navigation.md)
- [DESIGN.md](../../../DESIGN.md)


## 卡片与单聊

卡片宽 340px，只展示“会话来源 + 一条信息”，正文最多两行。公屏采用含渠道来源的会话名；单聊采用
“会话名 · 与成员单聊”，优先保留私有来源标识，完整来源可悬停查看。没有重复类型标题、时间或技术页脚。
本轮完成文案为“本轮已完成”，不推断必然有最终回复。Delivery-first batch AgentRun 使用 exact
`open_agent_run` 动作打开对应成员的执行记录并定位到该 Run；历史 CampTurn 继续使用 `open_camp_turn`。

公屏与每段单聊仍分别判断精确已读来源，但临时浮层以当前 Camp 为 quiet scope：只要该 Camp workspace 在前台，
审批 / 失败 / 未完成 / Mention / 完成都不弹；这不把同 Camp 的另一段单聊或屏幕外来源当成已读。
单聊共用四类偏好。点击原始 Conversation / Run 或审批详情，绝不创建 successor；关闭、超时和查看下一条
都不代表已读或批准。
