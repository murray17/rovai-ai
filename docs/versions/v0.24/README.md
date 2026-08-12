---
document_type: version-overview
version: v0.24
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai v0.24 Arctic Dawn V3

> 状态：v7 导航、设置覆盖与空 Camp 欢迎状态已完成生产实现与本地打包验收
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.23 普通目录工作区与动态 Git 能力](../v0.23/README.md)
>
> 当前设计权威：[Arctic Dawn V3](../../ui/README.md)
>
> 跨版本决策：[ADR-0073](../../adr/0073-agent-authored-a2a-conversation-messages.md) ·
> [ADR-0074](../../adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md) ·
> [ADR-0075](../../adr/0075-runtime-integrity-at-change-and-execution-boundaries.md) ·
> [ADR-0076](../../adr/0076-message-first-agent-run-dispatch-boundary.md) ·
> [ADR-0077](../../adr/0077-responsive-camp-turn-cancellation-boundary.md) ·
> [ADR-0078](../../adr/0078-navigation-projection-and-sidebar-wordmark-boundary.md) ·
> [ADR-0079](../../adr/0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.24 以 `rovai-arctic-dawn-v3-package` 为 Renderer 新一轮视觉与信息架构输入，
以 `rovai-arctic-dawn-members-v4.html` 定向更新成员页和身份编辑 Dialog，并以
`rovai-navigation-settings-empty-v7-package` 后续更新导航投影、设置覆盖与空 Camp
欢迎状态。版本通过逐项设计访谈把原型转化为可实施、可测试且符合现有领域合同的
生产规范；进入设计阶段后，v0.23 冻结为历史快照。

## 已确认决策

### 设计权威

- Arctic Dawn V3 是 v0.24 新的 Renderer 设计权威，可以替代 Meridian 中冲突的
  视觉与信息架构。
- 成员 v4 是后续局部权威，只覆盖成员页排列与身份编辑 Dialog；其中的旧 App Shell、
  “大厅”、演示路径/版本、WebP 和 Data URL 不覆盖已确认的全局词汇与安全合同。
- 导航 v7 是后续局部权威，只覆盖统一侧栏、设置导航投影与空 Camp 欢迎状态；其中
  把 Quick Chat 画成文件夹只改变 Renderer 排列，不把它变成 Project；审批进入
  时间线的演示文案无效。
- 外部 HTML 是设计稿，不是可直接复制的生产代码；实现仍使用现有 React、Radix、
  CSS Variables 和测试结构。
- 有效 ADR、`CONTEXT.md` 领域词汇、Core 行为与安全边界高于视觉原型。原型中的
  静态数据、演示跳转、内部词汇或与现有合同冲突的交互不自动成为产品需求。
- 旧 UI 规范在必要约束迁入 Arctic Dawn 后删除或收敛，不长期维持两套当前设计
  真源。

### 全界面版本范围

- v0.24 在同一版本内完成 Arctic Dawn V3 全界面收敛，不把新旧设计长期并置。
- 范围包括 Quick Chat、Camp 对话工作区、成员、长期记忆、技能、MCP、执行引擎、外观、
  诊断和创建新对话 Dialog。
- 实施可以按检查点分阶段推进，但版本完成定义必须覆盖上述全部界面及其共享 Shell、
  状态和浮层。
- 原型顶部的页面/运行态切换器属于设计稿导航，不进入生产范围。

### 主题分阶段

- 保留现有 `system | day | night` 主题偏好合同，不删除用户已有偏好或 Night 能力
  扩展位。
- 当前先把 Arctic Dawn V3 作为 Day 设计基准并优先实现全部页面。
- Night 等待用户后续提供单独设计稿；本轮不得根据 Day 自行推导最终 Night 视觉，
  也不得把现有 Meridian Night 当成新的 Arctic Dawn Night 规范。
- v0.24 期间三种偏好都解析并渲染 Arctic Dawn Day。选择 `night` 或在深色系统下
  选择 `system` 也不回退到旧 Meridian Night。
- 偏好值仍可保存，供未来 Night 实现恢复对应语义；本版本不承担旧 Night 的视觉
  兼容。
- v0.24 在全界面 Day 完成并通过验收后即可完成，Night 不阻塞本版本。

### Project 与 Camp 置顶

- 原型中的“置顶”是 v0.24 真实产品能力，不是设计稿装饰。
- 用户可以分别置顶 Project 和 Camp；统一侧栏提供稳定的置顶入口与置顶分区。
- 置顶是应用级、跨重启的 UI 偏好，由 Electron Main 原子持久化到
  `userData/navigation.json`。
- 置顶不进入 Core SQLite，不产生 Camp 事件或审计记录，也不把 Project 提升为领域
  实体。
- 置顶目标从普通分组移到统一侧栏顶部的置顶分区，不重复显示；取消置顶后返回按
  当前 Navigation Read Side 计算的原分组。
- 置顶 Project 作为完整分组展示其 Camp 列表。
- 置顶区固定先显示 Camp、后显示 Project；两类内部按置顶时间正序排列，不提供
  拖拽排序。取消后重新置顶会排到对应类型末尾。
- 读取 Navigation 时自动清理无法解析的置顶：Camp 永久删除后移除 Camp 置顶；
  canonical Project 已无任何 Camp 后移除 Project 置顶。清理结果原子写回
  `navigation.json`。
- Camp 重命名或 Project 展示名变化只刷新最新显示文字，不改变置顶身份。

### 统一侧栏

- 所有一级页面常驻同一条 270px 统一侧栏，包括成员、长期记忆和全部设置页。
- 设置页复用同一 270px 侧栏槽位，由“返回 App / 技能 / MCP / 执行引擎 / 外观 /
  诊断”覆盖普通导航；内容区不再增加 188px 二级导航。
- “返回 App”恢复进入设置前的一级页面和 Camp；再次进入设置时保留上次分类。
- 侧栏品牌区不保留原型中的 `•••`“个人菜单”；当前没有对应账号、资料或命令，不能
  出现无功能入口。
- 普通与设置侧栏可见字标统一为 `Rovai AI`，不显示“北极晨光 · Workspace”；
  正式产品名、窗口、安装包、应用数据和内部 namespace 继续使用 `Rovai-ai`，遵守
  ADR-0048/ADR-0078，不构成第二次产品迁移。
- 侧栏底部只保留“设置”，删除 Core 健康入口；原 Health Snapshot、探测、诊断页和
  导出能力继续保留。
- 删除现有 52/176px 图标轨、224px 对话列、宽度拖拽/双击/键盘调节以及对应持久化
  偏好。
- v0.24 的统一侧栏固定为 270px，不提供折叠、缩放或旧布局兼容。

### Quick Chat 与新对话入口

- 统一侧栏“新对话”单击直接打开创建新对话 Dialog，不先切换到一个可发送的全屏
  Draft。
- Quick Chat 保留为品牌落地页和“继续未完成的事”入口，但不提供直接发送 Composer。
- 用户必须先通过 New Conversation Draft 完成原子 Camp Creation，进入已持久化
  Camp 后才能提交第一条消息。
- 删除原型中落地页 Composer 的直接“发送”演示行为，不提供双击“新对话”才打开
  Dialog 的隐藏交互。

### 快速对话分组与命名

- 产品中文名称是“快速对话”，英文名称是 `Quick Chat`。
- 统一侧栏普通导航只有“置顶 / 项目”两个会话分区。“项目”先显示绑定 canonical
  用户目录的 directory Projects，最后显示文件夹样式的“快速对话”投影。
- “快速对话”只在 Renderer 中采用项目式外观；底层继续使用独立
  `NavigationSnapshot.quickChat` 与 `quick_chat` binding，不进入
  `ProjectNavigationGroup`，不能作为 Project 置顶；其 Camp 可以分别置顶。
- 按 [ADR-0074](../../adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md)
  完成全栈语言迁移：Rust `QuickChat`、序列化 `quick_chat`、契约 `quickChat`、
  CSS/test `quick-chat`、受管目录 `quick-chat/`。
- 不保留旧值、别名、双读或数据迁移；未发布协作数据直接重置，并永久删除精确旧
  受管目录 `<userData>/lobby/` 的全部内容，不备份或导入。
- 删除必须验证目标是权威 `userData` 的直属 `lobby` 子目录且不得跟随 symlink；
  删除失败时切换失败关闭，不进入半迁移状态。
- 历史版本快照保留当时文字，当前代码、测试和规范只使用新语言。

### Camp 执行过程呈现

- Camp 主阅读流改为同向左对齐；用户消息、Agent 消息与 A2A 消息按持久顺序连续
  阅读，以头像、名称、时间和消息表面区分身份与类型。
- 删除 Meridian 点状竖向时间轨及其节点体系，包括 EXEC 菱形节点；日期改用横向
  分隔。Task 等非审批结构化内容仍按发生位置嵌入阅读流；Approval 固定在 Composer
  上方，不进入阅读流。
- Camp 时间线采用 Codex 风格的顺序叙述，不再把公开过程拆成
  `Thinking / Progress / Steps / Tool` 分区，也不显示分区计数或 `DONE` 标签。
- 运行中的公开叙述与 Tool Call 摘要按发生顺序平铺在同一 Run 的处理过程中。
  文件读取、命令执行及其错误都属于 Tool Call，不作为独立时间线卡。
- Tool Call 默认只显示图标与“读取文件”“运行命令”等紧凑动作摘要；命令、
  文件、退出码、输出和失败证据仍须结构化保留，并可按需展开查看。
- Approval 与 Task 不降级为普通 Tool Call。Task 保留消息区内的独立边界事件；
  Approval 不进入消息区，所有 pending 请求固定在 Composer 正上方的非模态停靠式
  审批弹框。单项直接展示，多项聚合为“N 项待审批”并逐项处理。
- Approval 的成员身份、Runtime、选项、范围和后果必须来自发起请求的 Agent
  Runtime 实际合同，不提供跨 Runtime 虚构的统一审批档位。
- 执行终态把过程收敛为一个折叠入口，文案格式为
  `处理过程 · {本地化耗时}`，例如“处理过程 · 2分18秒”；不使用原型中的英文
  `Worked for …`。
- Agent 最终回复独立显示在折叠过程之外，不因收起过程而隐藏。

### 空 Camp 欢迎状态

- 没有公共/A2A 消息、AgentRun 或其他时间线内容时，完整欢迎状态替换单行
  “这段 Camp 还没有消息。”；第一项权威内容出现后退出欢迎状态。
- 欢迎状态保留既有 Camp Header、Composer、Approval Dock 与 Inspector，只增加
  Arctic Dawn 图形、真实 Project/Quick Chat、Lead、成员和 Runtime 摘要。
- “先了解项目 / 整理成任务 / 检查工作区”三个建议只填入并聚焦现有 Composer，
  不自动发送、不创建领域记录。
- Inspector Approval 空状态继续说明 Composer 上方固定审批入口；原型中“同时出现
  在时间线”的文字不进入生产。

### Camp Composer 快捷键

- Pending Approval 使用 Composer 正上方的固定审批面板；多个成员的请求共享一个
  聚合队列，例如“2 项待审批”，但每项仍保留独立原生选项和决定状态。
- Camp Composer 使用 `Enter` 发送，不要求 `Command` 或 `Ctrl` 修饰键；
  `Shift+Enter` 插入换行。
- 输入法组合态和 `@` 候选选择优先于提交，不得误发。
- 当前发送位置切换为“停止”时，`Enter` 不触发停止；停止仍要求用户明确点击。
- 删除原型中的 `⌘↵` 提示，不提供并行的 `Command/Ctrl+Enter` 兼容提交路径。

### Camp 右侧详情栏（Inspector）

- Camp 右侧详情栏保留五个独立页签：
  “活动 / 任务 / 上下文 / 审批 / 审计”。
- “活动”呈现运行过程与当前状态；“审计”呈现时间、操作者、动作、目标、结果和
  证据。两者不能合并为一种普通活动列表。
- “上下文”只投影生产数据与权威状态，不复制原型中的 Project、Design route、
  约束等静态演示内容。
- 窗口宽度不低于 1180px 时详情栏为 310px；在应用最小宽度区间
  `1040–1179px` 收窄为 260px。五页签始终可见，不转换为抽屉或折叠栏。
- 详情栏不提供用户拖拽调宽；270px 统一侧栏在两个区间内都保持固定。

### Camp 顶栏与停止入口

- Camp 顶栏右侧只显示当前 Run 与待审批等状态摘要，不显示“停止”按钮，也不显示
  `•••` 操作菜单。
- 停止只出现在 Composer 的发送位置，作用于当前 CampTurn 整棵执行树。
- Camp 的置顶、取消置顶、重命名和删除只从统一侧栏对应 Camp 行进入；不在顶栏
  提供重复入口。

### A2A 消息语义修正

- 用户已独立确认 `team.post_message` 是发送 Agent 主动写入会话的定向消息，显示
  `发送者 → @接收者`与正文，不显示为系统消息。
- 成功路径不补造“已送达”“执行中”或“已返回”；回复本身就是回复者的新消息。
- InboxMessage 继续拥有私有 A2A 正文；Renderer 的用户可见投影不把它扩权为公共
  CampMessage、摘要、检索或 Agent 共享上下文。
- 这是一项领域/Read Side 语义修正，可独立于 Arctic Dawn 全界面视觉实施落地，
  不表示 Arctic Dawn 生产实现已经开始。

### Runtime 完整性校验边界

- [ADR-0075](../../adr/0075-runtime-integrity-at-change-and-execution-boundaries.md)
  将完整 SHA-256 移出消息发送热路径。
- 成功探测持久保存文件大小、修改时间和平台文件标识；实际 Runtime 启动先比较轻量
  身份，只有身份变化或旧记录缺失时才重新完整哈希。
- 校验发生在公开消息持久化之后。Runtime 变化或校验失败会阻止 Agent 启动并使执行
  失败/进入修复状态，不撤回已经保存的用户消息。
- 该领域与执行边界修正独立于 Arctic Dawn 全界面视觉实施，不表示 UI 生产实现已经
  开始。

### 消息优先与 AgentRun 调度边界

- [ADR-0076](../../adr/0076-message-first-agent-run-dispatch-boundary.md)
  要求用户点击发送后先由 Renderer 乐观投影消息，Core 随后用一次短事务保存
  CampMessage、CampTurn 和 queued AgentRun。
- `camp.messages.send` 不再创建 Pending Execution Intent，也不执行完整
  `execution_preflight()`；事件轮询只作为对账和跨进程刷新兜底。
- AgentRun 调度按“轻量工作区安全检查 → Runtime 当前状态与完整性检查 → starting Git
  observation → claim/start”执行。实际开始后的终态再采集 ending Git observation。
- Pre-launch 失败保留用户消息，把尚未启动的 Run 标记为失败，并让 Turn 失败或等待
  修复/重试；不写伪造的 `started_at` 或 Git observation。

### 即时停止与取消协调边界

- [ADR-0077](../../adr/0077-responsive-camp-turn-cancellation-boundary.md)
  要求 Renderer 点击停止后立即显示本地“正在停止…”，取消请求只完成 SQLite
  权威落库和 fence 后返回，不同步刷新 Navigation 或重新激活 Camp。
- 成功请求通过 Notify 立即唤醒取消协调器；500ms 扫描只作为恢复兜底。Runtime
  interrupt 完成后先写 `cancelled` 并主动发送 `agent_run.cancelled`，Renderer
  立即刷新一次当前 Camp Snapshot。
- ending Git observation 在取消事件之后后台采集和追加，仍属于 AgentRun 证据，
  但不再阻塞停止 ACK、取消终态或 Composer 恢复。
- [ADR-0079](../../adr/0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md)
  将本地 `cancelling` 投影扩展到全部相关 Run 卡和 Activity，并在停止阶段取消运行
  动画；草稿保持可编辑，但新 Turn 继续由本地/权威执行状态共同阻止。
- 同一批 AgentRun 的 Runtime interrupt 并行发送，使用独立的短 deadline；超时或
  失败后通过有界 Runtime detach 与持久 fence 收敛，不复用普通请求长超时。

### 其余页面与浮层

- 成员页按后续 v4 输入使用 272px（窄窗口 250px）名册与自适应详情；名册始终按
  “在队/暂时离队”分组并直接提供 Member Order 拖拽把手及键盘等价操作。
- 成员详情同时显示 `4:5` 完整半身 portrait 与 50px 圆形 icon；编辑身份从同一受管
  源图生成两种 rendition，并支持圆形取景拖拽、缩放、方向键微调、重置和
  28/32/34/44px 预览。内部 handle、Installation ID、路径和虚构统计不进入普通 UI。
- 长期记忆保留 Scope、治理过滤、四项摘要、伙伴写入策略、Hearth Proposal Drawer
  和 310/390px 最小双栏 Workbench；旧 Memory 领域合同不被视觉稿改写。
- 设置分类覆盖统一侧栏，内容区不再使用 188px 二级导航；技能/MCP/Runtime 继续
  遵守各自 Library、Projection、凭据、权限和探测边界。
- 外观页改为“跟随系统 / 日间 / 夜间”；Night 显示“视觉待设计”，不能展示或加载
  伪造的旧暗色 miniature。
- 创建新对话 Dialog 固定 Header/Footer、滚动 Body，按“工作目录 / 成员与 Lead /
  协作方式 / 对话名称”提交完整 New Conversation Draft；失败原子保留 Draft。
- Loading、Empty、Partial、Error、Disabled、Submitting、Recovery、键盘、
  Reduced Motion、200% Zoom 与 `1440×920 / 1040×700` 全部进入版本验收。

精确 Token、页面信息架构、文案、状态和适配以
[Arctic Dawn V3](../../ui/README.md)为准，不在版本概览复制第二套详规。

## 实施门禁

- v7 导航、设置覆盖和空 Camp 欢迎状态已经收敛；Quick Chat 与正式产品身份边界由
  ADR-0078 封顶。
- 用户已于 2026-07-30 明确授权首轮及 v7 Arctic Dawn 生产实现；两轮证据均记录在
  [实施计划](implementation-plan.md)。
- Night 设计不是本门禁的一部分；后续由用户提供独立设计后另开版本。
