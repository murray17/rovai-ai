---
document_type: ui-prototype-design
authority: directional-input
status: review-draft
implementation_status: prototype
target_surface: camp-member-management
design_direction: porcelain-day-steel-night
last_updated: 2026-08-25
---

# Camp 增减队员

## 1. Product Context

- **Product:** Rovai AI，一套证据优先的本地 Agent 协作桌面工作区。
- **Target user:** 正在一个长期 Camp 中调整实际协作名册的用户。
- **Target surface:** `CampWorkspace` 右侧 Inspector 的“队员”页签，以及受该动作影响的 Composer 路由状态。
- **Primary job:** 在不混淆全局队员身份的前提下，把一个现有队员加入当前会话，或安全地把一个当前成员移出。
- **Success:** 用户始终看清作用域、Lead 变化、Runtime 配置、未结工作与下一步；UI 不把 cancel request 伪装成可靠终态，也不允许有效 Camp 进入零成员状态。

## 2. Existing UI Read

- 保留 310px / compact 260px Inspector、sticky summary、现有队长 picker、头像、身份色和开放分隔列表；成员行内“Runtime · 状态”作为静态摘要，成员级操作统一进入右侧 `•••`。
- 添加选择复用 `NewConversationDialog` 的头像、checkbox、Runtime readiness 与列表密度。
- Dialog 使用 raised surface、strong boundary 和 3px Steel/Danger 顶边；普通列表不增加卡片墙或阴影。
- Camp Header 继续只承载审批摘要和 Inspector 显隐，不新增执行入口或 `•••`。

## 3. Interaction Model

### 添加

- 用户界面只有“添加队员”，不暴露首次加入、历史离开或 membership reactivation 的区别。
- 非空 Camp 可以一次选择多位；Renderer 以稳定顺序提交独立幂等命令，并展示逐项结果。
- 全部成功后关闭；部分失败保留 Dialog、成功事实和失败行，不回滚已经接受的命令。
- Camp 创建与后续名册操作都保证至少一位队员，因此添加保持统一的多选交互，不设计“添加第一位队员”分支。

### 移出

- 每次只移出一位，确认前必须读取 Core 权威 impact preview。
- Preview 明确下一任 Lead、释放 Task、Run cancel request 与 Delivery/Gather 收敛；只渲染计数大于零或确实发生的影响，不用“没有需要处理”的行填满确认框。
- “历史继续保留”属于稳定产品事实，不在每次成员移出时重复展示；确认框只保留本次需要用户确认的变化。
- cutover 成功后成员立即退出当前名册；未结 reconciliation 使用 Inspector 顶部持久状态轨，不依赖 Toast。
- 版本冲突保留当前 Dialog 和焦点，刷新 preview 后才允许再次确认。
- 最后一位队员的“移出当前会话”保留可见但不可执行，并就地说明“会话至少保留 1 位队员”；Core 提交边界仍重复校验该不变量。

### 成员操作菜单

- “Codex · 可用”等状态只表达当前事实，不再与右侧 `•••` 形成两个并列操作入口。
- 菜单先放“查看/收起模型信息”，分隔线后再放“移出当前会话”；普通查看与危险动作保持清楚分区。
- 本轮 HTML 同时提供三种入口供选择：横向三点常显、竖向三点常显、横向三点行内渐显。三者常态都不画边框，只在 hover、focus 或菜单展开时出现轻底色；当前推荐横向常显，最终选择待用户确认。
- 模型信息仍在成员行下方展开，只显示当前模型、推理/思考强度和模型策略；不把 Runtime 配置编辑塞进 Camp Inspector。
- 最后一位队员仍可从同一菜单查看 Runtime 详情；只有移出动作受名册不变量限制。

## 4. Visual Direction

- **Direction:** 在既有 Porcelain Day / Steel Night 内做安静、精确的操作增强，不创造新的视觉世界。
- **Distinctive:** 作用域标签、条件式权威 impact preview 和 cutover/reconciliation 分层反馈。
- **Quiet:** Runtime 元数据、历史 membership epoch 和内部命令编排不进入普通名册。
- **Avoid:** 卡片墙、角色色状态、渐变、装饰性进度、全局 Header 菜单及第三方设计语言。

## 5. Accessibility and State Matrix

- 支持键盘、可见 `focus-visible`、Dialog focus trap/Esc/返回焦点和至少 28px 点击目标。
- 状态通过文字、图标和稳定位置共同表达，不只靠颜色。
- Day/Night 使用同一 DOM；支持 Loading、Submitting、Partial、Conflict、Error、Recovery、Runtime 展开和最后一位队员保护。
- 评审覆盖 1440×920、1040×700、窄 Inspector、长中文角色名与 reduced motion。

## 6. Production Mapping

- Renderer：`CampWorkspace.tsx`、`styles.css`、相关 App/Renderer tests；
- 可复用组件：`MemberAvatar`、现有 Camp Lead menu、New Conversation member picker、Radix Dialog/Menu；
- Read model：当前 active roster、eligible global profiles、authoritative removal preview、reconciliation projection；
- Core：逐项 add、remove cutover、exact-run fence、membership-version delivery admission 与持久化 reconciliation；
- UI 合同：`DESIGN.md`、`docs/ui/components/conversation-workspace.md`、accessibility/theme matrix。

## 7. Prototype Evaluation

- 三种成员操作入口可在同一名册中切换比较，菜单内容和点击目标保持一致；
- 添加、移出有影响、移出无在途、部分失败、版本冲突、收敛中、Runtime 展开和最后一位队员保护场景可重复切换；
- 移出确认中，Run、Task、Delivery/Gather 与 Lead 只在实际受影响时出现；空影响不渲染占位行，也不渲染“继续保留”；
- 普通路径中不出现“重新加入”或“永久移除”；
- 移出 Dialog 不在 preview 完成前开放危险提交；
- cutover 后名册、Lead、Composer 与 reconciliation 状态同步；
- 有效交互路径不能把名册减到零；
- Day/Night 与 1040px 宽度不出现横向页面溢出、截断主要操作或不可见焦点。
