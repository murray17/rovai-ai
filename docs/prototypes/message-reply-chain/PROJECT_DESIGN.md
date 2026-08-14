---
document_type: ui-prototype-design
authority: directional-input
status: accepted
implementation_status: prototype
target_surface: camp-message-reply-chain
target_version: v0.77
design_direction: porcelain-day-steel-night
last_updated: 2026-08-14
---

# Camp 消息回复链与安全接收者选择

## 1. Job 与用户

- 用户正在 Camp 公共时间线中继续一段已存在的协作，主要风险是忘记结构化 Mention，导致消息被
  Default Lead 接收，而不是交给用户眼前正在回应的 Agent。
- 主任务是在不离开时间线的情况下，确定“引用哪条消息”并看清“实际交给谁执行”。
- 成功不是显示一个回复图标，而是引用边、可见 Mention、接收者摘要和 Core 最终校验始终一致。
- Surface 模式为 `Operate`：优先保证责任可见、失败可修复和键盘可达，不增加装饰性聊天树。

## 2. 交互命题

引用与寻址是两条正交事实，但一次明确的“回复 Agent 消息”用户手势可以同时产生两个可审阅动作：

1. 把消息稳定 ID 写入当前 Draft 的 `replyToCampMessageId`；
2. 若原作者当前可接收且尚未被 Structured Content 覆盖，在正文开头插入一个原子
   `member_mention(agentId)`。

历史消息作者、reply relation、展示名、旧收件人和 Default Lead 都不能在 Core 内隐式增加收件人。
Renderer 只是把用户点击转换为可见、可删除且由 Draft 持久化的结构化输入。

## 3. 时间线入口与父引用

- user/agent 公共消息在内容列右上角提供“回复”和既有“复制”；鼠标悬停、消息内键盘聚焦或粗指针
  环境下可见。
- 乐观消息在稳定 Message ID 返回前不显示回复入口。
- 带 `replyToCampMessageId` 的消息在正文之前显示一层紧凑父引用：原作者与有界摘要共用一个可视行，
  超出可用宽度用省略号截断，并保留折线引用标记。
- 点击父引用定位同 Camp 原消息并把焦点转移到消息节点；父消息不在当前窗口时进入有界 anchor load，
  不静默落到最近消息。
- 父消息已不可用时显示“引用的消息当前不可用”，保留当前消息正文，不暴露内部 ID。
- 不递归展开祖先、不缩进整条时间线、不把 reply edge 当成私密 thread。

## 4. Composer 回复条

- 回复条位于附件队列之上、正文编辑器之内，和 Composer 共用一个开放工作面。
- 采用已确认的方案 C“轻量无框”：正常回复条不绘制独立边框、底色或阴影；“回复 @成员”和原文
  摘要仍放在同一个可视行，超出宽度使用 `text-overflow: ellipsis`。接收者摘要始终单独展示完整集合。
- `@所有队员` 已经覆盖作者时不重复插入 Member Mention；已有其他 Member Mention 时，新增作者后必须
  显示完整 fanout，例如“发送给 @洛可、@沐瓦”。
- 回复当前用户消息只显示“引用你的消息”，不从历史 `addressedAgentIds`、原消息 Default Lead 或
  reply edge 推导接收者；没有 Mention 时明确显示当前 Default Lead。
- 关闭回复条只移除 reply intent；正文中的 Mention 是可见草稿内容，保持不变。

## 5. 原作者不可接收

- 点击时已经 `away / left / removed / unresolved`：保留引用，不插入 Member Mention；回复条改写为
  “引用 {作者} 的消息”，并原位显示“原作者当前不可接收，请选择其他成员”。
- 错误状态提供当前可提及成员的显式选择；选中后才写入对应 Structured Mention 并解除发送阻断。
- 用户可以选择一个或多个成员，也可以显式选择 `@所有队员`；最终接收者摘要不得省略 fanout。
- 失效作者不能留在 Structured Content 中，否则 Core 仍会原子拒绝。若作者在点击后才失效，Renderer
  标记该 token，并在用户选择替代成员时以明确的 replace 操作移除该失效 token。
- 不提供“仍然发送”“改交负责人”或任何无确认 fallback。

## 6. 发送与竞态

- 发送前以最新 Camp Snapshot 检查 reply target、所有 Member Mention 和 replacement requirement；
  本地不满足时不发 IPC，并把焦点移到接收者选择。
- 提交携带同一 Core Draft 的精确 revision 与持久 reply target；调用方不重复提交正文或接收者数组。
- Snapshot 后 Agent 仍可能失效。Core 的 `mention_target_unavailable` 必须原子拒绝，不能写消息、消费 Draft、
  创建 CampTurn/AgentRun 或改投 Default Lead。
- Renderer 收到该拒绝后保留正文、附件、reply target 和可见错误，刷新 Draft/Snapshot 后返回同一选择面。
- 只有 accepted 后才清空 Draft 与回复条。乐观消息使用已冻结 reply target 展示父引用，但不能被继续回复。

## 7. 持久化与状态范围

- `CampComposerDraftView` 增加可空 `replyToCampMessageId` 及足以渲染当前引用预览的 Core read projection；
  reply target 变化推进 Draft revision，与内容和附件共享串行 mutation 队列。
- 同一 Camp 最多一个 Draft，因此最多一个 pending reply intent；切换 Camp、窗口重载和 App 重启后恢复。
- 目标消息删除或跨 Camp 不一致时，Draft 保留正文与附件但把 reply 状态投影为不可发送的可恢复错误；
  用户可以取消引用或重新选择时间线消息。
- Optimistic projection、DOM Selection 和临时作者可用性不是持久事实。

## 8. 可访问性、文案与布局

- 回复按钮有可见或屏幕阅读器名称“回复 {作者} 的消息”；Enter/Space 与点击行为一致。
- 回复条使用普通 DOM 顺序，关闭按钮之后自然进入接收者选择与正文；不创建 focus trap。
- 鼠标点击“回复”后把插入光标送进正文编辑器，但不得触发 Composer 边框、阴影或额外包围框；键盘
  激活“回复”或通过 Tab 进入编辑器时，保留只作用于编辑器的可见 `focus-visible` 提示。
- 动态错误由 `aria-live=polite` 宣告，并以图标、文字、结构位置共同表达，不只依赖颜色。
- 200% zoom、1040×700 和长中文名下，作者与回复摘要始终只占一个可视行并允许省略；错误与选择动作
  独立展开，不得被单行规则裁切。
- Day/Night 使用同一 DOM；组件只消费现有 semantic tokens，不增加主题分支、渐变或角色气泡底色。

## 9. 生产映射

- Renderer：`CampWorkspace.tsx`、`StructuredMentionComposer.tsx`、`styles.css`、对应测试；
- Shared contracts：`CampComposerDraftView` 与 Draft mutation/send 参数；
- Core：Draft schema/migration、Camp Attachment/Draft store、user send validation 与 Read Model；
- UI 合同：`conversation-workspace.md`、`structured-mentions.md`；
- 长期边界：[ADR-0185](../../adr/0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md)
  已冻结 durable reply intent 与显式换人；ADR-0128 的 Draft-only user send、ADR-0163 的
  reply/recipient orthogonality 继续有效，原型本身不创造架构权威。

## 10. 原型验收

- 用户已确认“轻量无框（方案 C）”作为生产方向，并要求 Composer reply dock 与时间线父引用只占一行、
  超出显示省略号；“平衡型”和“接收者优先”仅作为原型对照，三者共享同一状态机与安全边界；
- 点击“回复”后编辑器获得焦点和插入光标，但 Composer 外观不增加焦点框；键盘焦点提示仍可见；
- 五个场景按钮可重复切换，正文、引用、接收者摘要与发送阻断同步变化；
- away 场景不出现失效 Mention，选择替代者后才可发送；
- race 场景第一次发送原位失败，引用与正文保留，显式换人后第二次可成功；
- 成功发送在时间线新增带父引用的用户消息，并清空 Draft；
- 取消引用保留已经可见的 Mention；
- Day/Night、1440×920、1040×700、736px 与 360px 不出现横向溢出或遮挡。
